import { Router } from 'express';
import { query, getRow, insert, toOrder, toStore, toPayment, stringifyJSON, parseJSON } from '../db.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { createOrderSchema, orderItemSchema, checkoutSchema, voidSchema } from '../validators.js';
import { emitToStore } from '../sockets.js';

const router = Router();
router.use(authenticate);

function computeTotals(items, taxRate = 0) {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  return { subtotal, tax, total: subtotal + tax };
}

// 付款行归集：多收的部分视为找零，只记录实际入账金额，避免日报表虚高
function normalizePayments(rows, total) {
  const list = (rows || []).map((r) => ({ ...r, amount: Number(r.amount || 0) }));
  const sum = list.reduce((s, r) => s + r.amount, 0);
  if (sum <= total + 0.001) return list;
  let excess = Math.round((sum - total) * 100) / 100;
  for (let i = list.length - 1; i >= 0 && excess > 0.001; i--) {
    const cut = Math.min(list[i].amount, excess);
    list[i].amount = Math.round((list[i].amount - cut) * 100) / 100;
    excess = Math.round((excess - cut) * 100) / 100;
  }
  return list.filter((r) => r.amount > 0);
}

async function loadSettings(orgId, storeId) {
  const rows = await query('SELECT setting_key,setting_value FROM app_settings WHERE org_id=? AND store_id=?', [orgId, storeId]);
  const s = {};
  for (const r of rows) { try { s[r.setting_key] = JSON.parse(r.setting_value); } catch { s[r.setting_key] = r.setting_value; } }
  return s;
}

// GST 感知的总额计算（含税/未税 + 服务费 + 5 分取整）
function computeGst(items, discount, s) {
  const rate = Number(s.taxRate || 0) / 100;
  const svcRate = Number(s.serviceChargeRate || 0) / 100;
  const gross = items.reduce((x, i) => x + i.unitPrice * i.qty, 0);
  const disc = Math.max(0, Math.min(Number(discount || 0), gross));
  const net = gross - disc;
  const serviceCharge = Math.round(net * svcRate * 100) / 100;
  const base = net + serviceCharge;
  let tax;
  let total;
  if (s.taxInclusive) { tax = Math.round((base - base / (1 + rate)) * 100) / 100; total = base; }
  else { tax = Math.round(base * rate * 100) / 100; total = base + tax; }
  if (s.roundTo5cent) total = Math.round(total * 20) / 20;
  return { subtotal: gross, discount: disc, serviceCharge, tax, total: Math.round(total * 100) / 100 };
}

function orderNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `T${ymd}-${rand}`;
}

async function getOrder(id, orgId, storeId) {
  const r = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  return r ? toOrder(r) : null;
}

router.post('/', async (req, res) => {
  const p = createOrderSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const settings = await loadSettings(orgId, storeId);
  const items = p.items.map((i) => ({ ...i, status: 'pending' }));
  const { subtotal, discount, serviceCharge, tax, total } = computeGst(items, p.discount, settings);
  const openShift = await getRow('SELECT id FROM shifts WHERE org_id=? AND store_id=? AND cashier_id=? AND status=? ORDER BY id DESC LIMIT 1', [orgId, storeId, req.user.id, 'open']);
  const held = !!p.hold;
  const id = await insert(
    `INSERT INTO orders
      (org_id, store_id, order_no, type, table_id, customer_name, phone, items, subtotal, discount, service_charge, tax, total, status, hold_label, held_at, created_by, shift_id, member_id, sales_person_id, discount_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, orderNo(), p.type, p.tableId ? Number(p.tableId) : null,
      p.customerName ?? null, p.phone ?? null, stringifyJSON(items),
      subtotal, discount, serviceCharge, tax, total, held ? 'hold' : 'open',
      held ? (p.holdLabel || `Hold ${Date.now()}`) : null, held ? new Date() : null,
      req.user.id, openShift?.id ?? null,
      p.memberId ? Number(p.memberId) : null,
      p.salesPersonId ? Number(p.salesPersonId) : (held ? null : req.user.id),
      p.discountType ?? null,
    ]
  );
  if (!held && p.type === 'dine_in' && p.tableId) {
    await query(
      'UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?',
      ['occupied', id, Number(p.tableId), orgId, storeId]
    );
  }
  res.status(201).json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [id])));
});

router.get('/', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM orders WHERE org_id=? AND store_id=?';
  if (req.query.status === 'running') {
    sql += " AND status IN ('open','hold','kitchen','preparing','ready','served')";
  } else if (req.query.status) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.type) { sql += ' AND type=?'; params.push(req.query.type); }
  sql += ' ORDER BY created_at DESC';
  const list = await query(sql, params);
  res.json(list.map(toOrder));
});

// 挂单列表必须定义在 /:id 之前，否则会被 /:id 吃掉
router.get('/holds', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const list = await query('SELECT * FROM orders WHERE org_id=? AND store_id=? AND status=? ORDER BY created_at DESC', [orgId, storeId, 'hold']);
  res.json(list.map(toOrder));
});

// 转台 / 并台 / 销售员 —— 字面量路由必须定义在 /:id 之前，否则会被 /:id 吃掉
const RUNNING_STATUS = ['open', 'hold', 'kitchen', 'preparing', 'ready', 'served'];

const transferRow = (r) => ({
  _id: r.id, id: r.id, type: r.type, orderId: r.order_id, orderNo: r.order_no,
  fromTableId: r.from_table_id, fromTableNo: r.from_table_no,
  toTableId: r.to_table_id, toTableNo: r.to_table_no,
  mergedOrderIds: parseJSON(r.merged_order_ids) || [], mergedOrderNos: parseJSON(r.merged_order_nos) || [],
  amount: Number(r.amount || 0), reason: r.reason,
  createdBy: r.created_by, createdByName: r.created_by_name, createdAt: dt(r.created_at),
});

router.get('/transfers', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM order_transfers WHERE org_id=? AND store_id=?';
  if (req.query.type) { sql += ' AND type=?'; params.push(req.query.type); }
  sql += ' ORDER BY id DESC LIMIT 300';
  res.json((await query(sql, params)).map(transferRow));
});

router.get('/sales-persons', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const rows = await query('SELECT id,name,role,phone FROM users WHERE org_id=? AND store_id=? AND is_active=1 ORDER BY id', [orgId, storeId]);
  res.json(rows.map((u) => ({ id: u.id, name: u.name, role: u.role, code: u.phone })));
});

// 并台：把多张进行中的单合并到主单，其余标记 merged 并释放桌位
router.post('/merge', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const ids = (req.body.orderIds || []).map(Number).filter((n) => Number.isFinite(n));
  if (ids.length < 2) return res.status(400).json({ error: 'need at least 2 orders' });
  const list = await query(`SELECT * FROM orders WHERE org_id=? AND store_id=? AND id IN (${ids.map(() => '?').join(',')})`, [orgId, storeId, ...ids]);
  if (list.length !== ids.length) return res.status(404).json({ error: 'some orders not found' });
  for (const o of list) if (!RUNNING_STATUS.includes(o.status)) return res.status(400).json({ error: `order ${o.order_no} is not mergeable` });

  const primary = (req.body.targetOrderId && list.find((o) => String(o.id) === String(req.body.targetOrderId))) || list[0];
  const others = list.filter((o) => o.id !== primary.id);
  if (!others.length) return res.status(400).json({ error: 'nothing to merge' });

  const settings = await loadSettings(orgId, storeId);
  const items = [...parseJSON(primary.items), ...others.flatMap((o) => parseJSON(o.items))];
  const discount = round2(Number(primary.discount || 0) + others.reduce((s, o) => s + Number(o.discount || 0), 0));
  const totals = computeGst(items, discount, settings);

  const targetId = req.body.tableId != null ? Number(req.body.tableId) : (primary.table_id ? Number(primary.table_id) : null);
  const targetTable = targetId ? await getRow('SELECT * FROM tables WHERE id=? AND org_id=? AND store_id=?', [targetId, orgId, storeId]) : null;

  await query(
    'UPDATE orders SET items=?, discount=?, subtotal=?, service_charge=?, tax=?, total=?, table_id=?, type=?, updated_at=NOW() WHERE id=?',
    [stringifyJSON(items), discount, totals.subtotal, totals.serviceCharge, totals.tax, totals.total, targetTable ? targetTable.id : primary.table_id, targetTable ? 'dine_in' : primary.type, primary.id]
  );
  if (targetTable) await query('UPDATE tables SET status=?, current_order_id=? WHERE id=?', ['occupied', primary.id, targetTable.id]);

  for (const o of others) {
    if (o.table_id && (!targetTable || Number(o.table_id) !== Number(targetTable.id))) {
      await query('UPDATE tables SET status=?, current_order_id=NULL WHERE id=? AND org_id=? AND store_id=?', ['free', o.table_id, orgId, storeId]);
    }
    await query('UPDATE orders SET status=?, merged_into_order_id=?, updated_at=NOW() WHERE id=?', ['merged', primary.id, o.id]);
    emitToStore(orgId, storeId, 'order:closed', String(o.id));
  }

  const firstFrom = others[0].table_id ? await getRow('SELECT * FROM tables WHERE id=?', [others[0].table_id]) : null;
  const id = await insert(
    `INSERT INTO order_transfers
      (org_id, store_id, type, order_id, order_no, from_table_id, from_table_no, to_table_id, to_table_no, merged_order_ids, merged_order_nos, amount, reason, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, 'merge', primary.id, primary.order_no,
      firstFrom ? firstFrom.id : null, firstFrom ? firstFrom.number : null,
      targetTable ? targetTable.id : null, targetTable ? targetTable.number : null,
      stringifyJSON(others.map((o) => o.id)), stringifyJSON(others.map((o) => o.order_no)),
      round2(others.reduce((s, o) => s + Number(o.total || 0), 0)), req.body.reason || '',
      req.user.id, req.user.name || null,
    ]
  );
  emitToStore(orgId, storeId, 'order:created', toOrder(await getRow('SELECT * FROM orders WHERE id=?', [primary.id])));
  const mergedRows = await query(`SELECT * FROM orders WHERE id IN (${others.map(() => '?').join(',')})`, others.map((o) => o.id));
  res.json({
    order: toOrder(await getRow('SELECT * FROM orders WHERE id=?', [primary.id])),
    merged: mergedRows.map(toOrder),
    merge: transferRow(await getRow('SELECT * FROM order_transfers WHERE id=?', [id])),
  });
});

router.get('/:id', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const o = await getOrder(req.params.id, orgId, storeId);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

router.post('/:id/items', async (req, res) => {
  const p = orderItemSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'open') return res.status(400).json({ error: 'order not open' });
  const items = parseJSON(row.items);
  items.push({ ...p, status: 'pending' });
  const settings = await loadSettings(orgId, storeId);
  const totals = computeGst(items, row.discount, settings);
  await query(
    'UPDATE orders SET items=?, subtotal=?, discount=?, service_charge=?, tax=?, total=? WHERE id=?',
    [stringifyJSON(items), totals.subtotal, totals.discount, totals.serviceCharge, totals.tax, totals.total, row.id]
  );
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

// 整单替换明细（取单后编辑再送厨房用）
router.put('/:id/items', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!['open', 'hold'].includes(row.status)) return res.status(400).json({ error: 'order not editable' });
  const items = (req.body.items || []).map((i) => ({ ...i, status: 'pending' }));
  if (!items.length) return res.status(400).json({ error: 'items required' });
  const settings = await loadSettings(orgId, storeId);
  const totals = computeGst(items, req.body.discount ?? row.discount, settings);
  await query('UPDATE orders SET items=?, subtotal=?, discount=?, service_charge=?, tax=?, total=? WHERE id=?', [stringifyJSON(items), totals.subtotal, totals.discount, totals.serviceCharge, totals.tax, totals.total, row.id]);
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

router.put('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const transitions = { open: ['kitchen'], kitchen: ['preparing', 'ready'], preparing: ['ready'], ready: ['served'] };
  if (!transitions[row.status]?.includes(status)) return res.status(400).json({ error: 'invalid transition' });
  await query('UPDATE orders SET status=? WHERE id=?', [status, row.id]);
  const io = req.app.get('io');
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  if (status === 'kitchen' || status === 'preparing' || status === 'ready') {
    emitToStore(io, storeId, 'order:created', order);
    emitToStore(io, storeId, 'kds:ticket', order);
  } else if (status === 'served') {
    emitToStore(io, storeId, 'order:closed', String(order.id));
  }
  return res.json(order);
});

async function deductInventory(order, user, io) {
  const low = [];
  for (const it of order.items) {
    const vid = it.variantId || it.itemId;
    if (!vid) continue;
    const v = await getRow('SELECT * FROM menu_variants WHERE id=?', [Number(vid)]);
    if (!v) continue;
    const before = Number(v.stock_qty || 0);
    const after = Math.max(0, before - it.qty);
    await query('UPDATE menu_variants SET stock_qty=? WHERE id=?', [after, v.id]);
    await insert(
      `INSERT INTO stock_movements (org_id, store_id, item_id, type, delta, before, after, ref_order_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [user.orgId, user.storeId, v.id, 'sale', -it.qty, before, after, order.id, user.id]
    );
    if (after < Number(v.stock_threshold || 0)) low.push({ itemId: String(v.id), name: v.name, quantity: after });
  }
  if (low.length) emitToStore(io, user.storeId, 'inventory:low', low);
}

router.post('/:id/checkout', async (req, res) => {
  const p = checkoutSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (['paid', 'void', 'refunded', 'split'].includes(row.status)) return res.status(400).json({ error: 'already closed' });

  // ---- 先校验所有抵扣（礼券 / 返利），任何一项不通过就整体不落账 ----
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const voucherInputs = (p.vouchers || []).map((x) => ({ code: x.code, amount: round2(x.amount) }));
  const rebateAmount = round2(p.rebateAmount || 0);
  const resolved = [];
  let voucherTotal = 0;
  for (const vi of voucherInputs) {
    const vr = await getRow('SELECT * FROM vouchers WHERE org_id=? AND store_id=? AND UPPER(code)=UPPER(?)', [orgId, storeId, String(vi.code || '').trim()]);
    if (!vr) return res.status(400).json({ error: `voucher not found: ${vi.code}` });
    const vst = (vr.status === 'void' || vr.status === 'used') ? vr.status
      : (vr.expires_at && new Date(vr.expires_at).getTime() < Date.now()) ? 'expired'
      : (vr.status === 'active' ? 'active' : vr.status);
    if (vst !== 'active') return res.status(400).json({ error: `voucher ${vr.code} is ${vst}` });
    if (!(vi.amount > 0)) return res.status(400).json({ error: `voucher ${vr.code} amount must be positive` });
    if (vi.amount > Number(vr.balance) + 0.001) return res.status(400).json({ error: `voucher ${vr.code} balance insufficient (${round2(vr.balance)})` });
    resolved.push({ vr, amount: vi.amount });
    voucherTotal = round2(voucherTotal + vi.amount);
  }
  let rebateMember = null;
  if (rebateAmount > 0) {
    if (!row.member_id) return res.status(400).json({ error: 'rebate requires a member on the order' });
    rebateMember = await getRow('SELECT * FROM members WHERE id=? AND org_id=? AND store_id=?', [row.member_id, orgId, storeId]);
    if (!rebateMember) return res.status(400).json({ error: 'member not found' });
    if (rebateAmount > Number(rebateMember.rebate_balance || 0) + 0.001) return res.status(400).json({ error: `rebate balance insufficient (${round2(rebateMember.rebate_balance)})` });
  }
  const discountTotal = round2(voucherTotal + rebateAmount);
  const dueAfterDiscount = Math.max(0, round2(Number(row.total || 0) - discountTotal));
  const paidSum = p.payments.reduce((s, x) => s + x.amount, 0);
  if (paidSum + (p.tip || 0) < dueAfterDiscount) {
    return res.status(400).json({ error: `amount not covered: due ${dueAfterDiscount}` });
  }

  // ---- 校验通过，正式落账 ----
  const appliedVouchers = [];
  for (const r0 of resolved) {
    const newBalance = round2(Number(r0.vr.balance) - r0.amount);
    await query('UPDATE vouchers SET balance=?, status=?, updated_at=NOW() WHERE id=?', [newBalance, newBalance <= 0 ? 'used' : r0.vr.status, r0.vr.id]);
    await insert(
      'INSERT INTO voucher_txns (org_id,store_id,voucher_id,voucher_no,code,type,amount,balance_after,order_id,order_no,member_id,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [orgId, storeId, r0.vr.id, r0.vr.voucher_no, r0.vr.code, 'redeem', r0.amount, newBalance, row.id, row.order_no, row.member_id || null, 'redeemed at checkout', req.user.id, req.user.name || null]
    );
    appliedVouchers.push({ code: r0.vr.code, voucherNo: r0.vr.voucher_no, amount: r0.amount, balanceAfter: newBalance });
    await insert(
      `INSERT INTO payments (org_id, store_id, order_id, method, amount, tip, created_by) VALUES (?,?,?,?,?,?,?)`,
      [orgId, storeId, row.id, 'voucher', r0.amount, 0, req.user.id]
    );
  }
  if (rebateAmount > 0) {
    await query('UPDATE members SET rebate_balance=GREATEST(0, rebate_balance-?) WHERE id=?', [rebateAmount, rebateMember.id]);
    const after = Number((await getRow('SELECT rebate_balance FROM members WHERE id=?', [rebateMember.id])).rebate_balance);
    await insert(
      'INSERT INTO rebates (org_id,store_id,member_id,member_no,member_name,type,amount,balance_after,order_id,order_no,order_total,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [orgId, storeId, rebateMember.id, rebateMember.member_no, rebateMember.name, 'redeem', rebateAmount, after, row.id, row.order_no, Number(row.total || 0), 'rebate redeemed at checkout', req.user.id, req.user.name || null]
    );
    await insert(
      `INSERT INTO payments (org_id, store_id, order_id, method, amount, tip, created_by) VALUES (?,?,?,?,?,?,?)`,
      [orgId, storeId, row.id, 'rebate', rebateAmount, 0, req.user.id]
    );
  }
  for (const pm of normalizePayments(p.payments, dueAfterDiscount)) {
    await insert(
      `INSERT INTO payments (org_id, store_id, order_id, method, amount, tip, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [orgId, storeId, row.id, pm.method, pm.amount, 0, req.user.id]
    );
  }
  await query('UPDATE orders SET voucher_discount=?, rebate_redeemed=? WHERE id=?', [discountTotal, rebateAmount, row.id]);
  const settings = await loadSettings(orgId, storeId);
  const invCount = await getRow('SELECT COUNT(*) AS c FROM invoices WHERE org_id=? AND store_id=?', [orgId, storeId]);
  const invoiceNo = `${settings.invoicePrefix || 'INV'}-${new Date().getFullYear()}-${String(Number(invCount?.c || 0) + 1).padStart(5, '0')}`;
  await query('UPDATE orders SET status=?, invoice_no=? WHERE id=?', ['paid', invoiceNo, row.id]);
  await insert('INSERT INTO invoices (org_id,store_id,order_id,invoice_no,amount,tax) VALUES (?,?,?,?,?,?)', [orgId, storeId, row.id, invoiceNo, Number(row.total || 0), Number(row.tax || 0)]);
  const io = req.app.get('io');
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  await deductInventory(order, req.user, io);

  // ---- 自动返利：按 settings.rebatePercent 对实付金额计返利（会员单才计） ----
  let rebateEarned = null;
  const rebatePct = Number(settings.rebatePercent || 0);
  if (rebatePct > 0 && row.member_id) {
    const em = await getRow('SELECT * FROM members WHERE id=? AND org_id=? AND store_id=?', [row.member_id, orgId, storeId]);
    if (em) {
      const base = Math.max(0, round2(Number(row.total || 0) - discountTotal));
      const earn = round2(base * rebatePct / 100);
      if (earn > 0) {
        const days = Number(settings.rebateExpiryDays || 0);
        const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ') : null;
        await query('UPDATE members SET rebate_balance=rebate_balance+? WHERE id=?', [earn, em.id]);
        const after = Number((await getRow('SELECT rebate_balance FROM members WHERE id=?', [em.id])).rebate_balance);
        const rid = await insert(
          'INSERT INTO rebates (org_id,store_id,member_id,member_no,member_name,type,amount,balance_after,order_id,order_no,order_total,percent,reason,expires_at,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [orgId, storeId, em.id, em.member_no, em.name, 'earn', earn, after, row.id, row.order_no, base, rebatePct, `auto rebate ${rebatePct}%`, expiresAt, req.user.id, req.user.name || null]
        );
        rebateEarned = { id: String(rid), memberId: String(em.id), memberNo: em.member_no, amount: earn, balanceAfter: after, percent: rebatePct };
      }
    }
  }

  emitToStore(io, storeId, 'order:closed', String(order.id));
  if (order.tableId) {
    await query(
      'UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?',
      ['needs_clean', null, Number(order.tableId), orgId, storeId]
    );
  }
  const payments = await query('SELECT * FROM payments WHERE order_id=?', [row.id]);
  res.json({
    order,
    appliedVouchers,
    rebateRedeemed: rebateAmount,
    rebateEarned,
    dueAfterDiscount,
    receipt: {
      storeName: settings.companyName || 'Store',
      address: settings.address || '', phone: settings.phone || '', gstNo: settings.gstNo || '',
      orderNo: order.orderNo, invoiceNo, items: order.items,
      subtotal: order.subtotal, discount: order.discount, serviceCharge: order.serviceCharge,
      tax: order.tax, taxRate: settings.taxRate, taxInclusive: settings.taxInclusive, total: order.total,
      voucherDiscount: discountTotal, rebateRedeemed: rebateAmount,
      rebateEarned: rebateEarned ? Number(rebateEarned.amount || 0) : 0,
      payments: payments.map(toPayment), footer: settings.receiptFooter || '', createdAt: order.createdAt,
    },
  });
});

router.post('/:id/void', async (req, res) => {
  const p = voidSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (['paid', 'void', 'void_pending'].includes(row.status)) return res.status(400).json({ error: 'cannot void this order' });
  await query(
    'UPDATE orders SET status=?, void_requested_by=?, void_reason=? WHERE id=?',
    ['void_pending', req.user.id, p.reason, row.id]
  );
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

router.post('/:id/void/approve', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
  await query('UPDATE orders SET status=?, void_approved_by=? WHERE id=?', ['void', req.user.id, row.id]);
  emitToStore(req.app.get('io'), storeId, 'order:closed', String(row.id));
  if (row.table_id) {
    await query(
      'UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?',
      ['free', null, row.table_id, orgId, storeId]
    );
  }
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

router.post('/:id/void/reject', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
  await query('UPDATE orders SET status=?, void_requested_by=NULL, void_reason=NULL WHERE id=?', ['open', row.id]);
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  emitToStore(req.app.get('io'), storeId, 'order:created', order);
  res.json(order);
});

// ---- 挂单 / 取单 ----
router.post('/:id/hold', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!['open', 'hold'].includes(row.status)) return res.status(400).json({ error: 'only open orders can be held' });
  await query('UPDATE orders SET status=?, hold_label=COALESCE(?,hold_label), held_at=NOW() WHERE id=?', ['hold', req.body?.label || null, row.id]);
  if (row.table_id) await query('UPDATE tables SET status=?, current_order_id=NULL WHERE id=? AND org_id=? AND store_id=?', ['free', row.table_id, orgId, storeId]);
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  emitToStore(req.app.get('io'), storeId, 'order:closed', String(row.id));
  res.json(order);
});

router.post('/:id/recall', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'hold') return res.status(400).json({ error: 'order is not on hold' });
  await query('UPDATE orders SET status=?, held_at=NULL WHERE id=?', ['open', row.id]);
  if (row.type === 'dine_in' && row.table_id) await query('UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?', ['occupied', row.id, row.table_id, orgId, storeId]);
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

// ---- 转台 / 销售员指派 ----
router.post('/:id/transfer', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const o = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (!RUNNING_STATUS.includes(o.status)) return res.status(400).json({ error: 'only running orders can be transferred' });
  const targetId = Number(req.body.tableId);
  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'tableId required' });
  const target = await getRow('SELECT * FROM tables WHERE id=? AND org_id=? AND store_id=?', [targetId, orgId, storeId]);
  if (!target) return res.status(404).json({ error: 'target table not found' });
  if (Number(o.table_id) === targetId) return res.status(400).json({ error: 'already on this table' });
  if (target.status === 'occupied' && String(target.current_order_id) !== String(o.id)) return res.status(400).json({ error: 'target table is occupied' });

  const from = o.table_id ? await getRow('SELECT * FROM tables WHERE id=?', [o.table_id]) : null;
  if (from) await query('UPDATE tables SET status=?, current_order_id=NULL WHERE id=?', ['free', from.id]);
  await query('UPDATE tables SET status=?, current_order_id=? WHERE id=?', ['occupied', o.id, target.id]);
  await query('UPDATE orders SET table_id=?, type=?, updated_at=NOW() WHERE id=?', [target.id, 'dine_in', o.id]);

  const id = await insert(
    `INSERT INTO order_transfers
      (org_id, store_id, type, order_id, order_no, from_table_id, from_table_no, to_table_id, to_table_no, merged_order_ids, merged_order_nos, amount, reason, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, 'transfer', o.id, o.order_no,
      from ? from.id : null, from ? from.number : null, target.id, target.number,
      stringifyJSON([]), stringifyJSON([]), Number(o.total || 0), req.body.reason || '',
      req.user.id, req.user.name || null,
    ]
  );
  const updated = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [o.id]));
  emitToStore(orgId, storeId, 'order:created', updated);
  res.json({ order: updated, transfer: transferRow(await getRow('SELECT * FROM order_transfers WHERE id=?', [id])) });
});

router.put('/:id/sales-person', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const sp = req.body.salesPersonId ? Number(req.body.salesPersonId) : null;
  await query('UPDATE orders SET sales_person_id=?, updated_at=NOW() WHERE id=?', [sp, row.id]);
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

// 结账前挂/换会员:返利抵扣必须基于订单上的会员,所以允许在 Payment 之前补挂。
router.put('/:id/member', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status === 'paid' || row.status === 'void') return res.status(400).json({ error: 'cannot change member on a closed order' });
  const mid = req.body.memberId ? Number(req.body.memberId) : null;
  if (mid) {
    const m = await getRow('SELECT id FROM members WHERE id=? AND org_id=? AND store_id=?', [mid, orgId, storeId]);
    if (!m) return res.status(400).json({ error: 'member not found' });
  }
  await query('UPDATE orders SET member_id=?, updated_at=NOW() WHERE id=?', [mid, row.id]);
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

// ---- 反结算 ----
router.get('/unsettles/list', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const rows = await query('SELECT * FROM unsettles WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId]);
  res.json(rows.map((r) => ({ _id: r.id, id: r.id, orderId: r.order_id, orderNo: r.order_no, invoiceNo: r.invoice_no, amount: Number(r.amount || 0), payments: parseJSON(r.payments), reason: r.reason, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at })));
});

router.post('/:id/unsettle', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!['paid', 'refunded'].includes(row.status)) return res.status(400).json({ error: 'only settled orders can be unsettled' });
  for (const it of parseJSON(row.items)) {
    await query('UPDATE menu_variants SET stock_qty=stock_qty+? WHERE id=? AND org_id=? AND store_id=?', [Number(it.qty), Number(it.variantId || it.itemId), orgId, storeId]);
  }
  const payments = await query('SELECT method,amount FROM payments WHERE order_id=?', [row.id]);
  await query('DELETE FROM payments WHERE order_id=?', [row.id]);
  await query('DELETE FROM invoices WHERE order_id=?', [row.id]);
  await insert('INSERT INTO unsettles (org_id,store_id,order_id,order_no,invoice_no,amount,payments,reason,created_by) VALUES (?,?,?,?,?,?,?,?,?)', [orgId, storeId, row.id, row.order_no, row.invoice_no, Number(row.total || 0), stringifyJSON(payments), req.body?.reason || 'unsettle', req.user.id]);
  await query('UPDATE orders SET status=?, invoice_no=NULL, refunded_amount=0, unsettled_at=NOW() WHERE id=?', ['open', row.id]);
  if (row.table_id) await query('UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?', ['occupied', row.id, row.table_id, orgId, storeId]);
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  emitToStore(req.app.get('io'), storeId, 'order:created', order);
  res.json({ order });
});

// ---- 单据内容（重打用） ----
function buildDocument(order, settings, tableNo, cashierName, payments, kind) {
  const isKitchen = kind === 'kitchen' || kind === 'bar';
  const titles = { bill: 'Bill / Tax Invoice', receipt: 'Receipt', order: 'Order Slip', kitchen: 'Kitchen Order', bar: 'Bar Order' };
  return {
    kind, title: titles[kind] || 'Bill',
    header: isKitchen ? { name: settings.companyName || 'Store' } : { name: settings.companyName || 'Store', address: settings.address || '', phone: settings.phone || '', gstNo: settings.gstNo || '' },
    orderNo: order.orderNo, invoiceNo: order.invoiceNo || null, date: order.createdAt, status: order.status,
    table: tableNo, cashier: cashierName, customerName: order.customerName || null,
    items: isKitchen ? order.items.map((i) => ({ qty: i.qty, code: i.code, name: i.name })) : order.items,
    subtotal: order.subtotal, discount: order.discount, serviceCharge: order.serviceCharge, tax: order.tax,
    taxRate: settings.taxRate || 0, taxInclusive: !!settings.taxInclusive, total: order.total,
    refundedAmount: order.refundedAmount || 0,
    payments: isKitchen ? [] : payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
    footer: isKitchen ? '' : (settings.receiptFooter || ''), reprintCount: order.reprintCount || 0,
  };
}

router.get('/:id/document', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const settings = await loadSettings(orgId, storeId);
  const order = toOrder(row);
  const table = row.table_id ? await getRow('SELECT number FROM tables WHERE id=?', [row.table_id]) : null;
  const cashier = row.created_by ? await getRow('SELECT name FROM users WHERE id=?', [row.created_by]) : null;
  const payments = await query('SELECT method,amount FROM payments WHERE order_id=?', [row.id]);
  res.json(buildDocument(order, settings, table?.number || null, cashier?.name || null, payments, req.query.kind || 'bill'));
});

router.post('/:id/reprint', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const kind = req.body?.kind || 'bill';
  await query('UPDATE orders SET reprint_count=reprint_count+1 WHERE id=?', [row.id]);
  await insert('INSERT INTO reprint_logs (org_id,store_id,order_id,order_no,kind,created_by) VALUES (?,?,?,?,?,?)', [orgId, storeId, row.id, row.order_no, kind, req.user.id]);
  const settings = await loadSettings(orgId, storeId);
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  const table = row.table_id ? await getRow('SELECT number FROM tables WHERE id=?', [row.table_id]) : null;
  const cashier = row.created_by ? await getRow('SELECT name FROM users WHERE id=?', [row.created_by]) : null;
  const payments = await query('SELECT method,amount FROM payments WHERE order_id=?', [row.id]);
  res.json({ document: buildDocument(order, settings, table?.number || null, cashier?.name || null, payments, kind) });
});

export default router;
