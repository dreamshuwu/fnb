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
      (org_id, store_id, order_no, type, table_id, customer_name, phone, items, subtotal, discount, service_charge, tax, total, status, hold_label, held_at, created_by, shift_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, orderNo(), p.type, p.tableId ? Number(p.tableId) : null,
      p.customerName ?? null, p.phone ?? null, stringifyJSON(items),
      subtotal, discount, serviceCharge, tax, total, held ? 'hold' : 'open',
      held ? (p.holdLabel || `Hold ${Date.now()}`) : null, held ? new Date() : null,
      req.user.id, openShift?.id ?? null,
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
  if (req.query.status) { sql += ' AND status=?'; params.push(req.query.status); }
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
  const paidSum = p.payments.reduce((s, x) => s + x.amount, 0);
  if (paidSum + (p.tip || 0) < Number(row.total || 0)) return res.status(400).json({ error: 'amount not covered' });
  for (const pm of normalizePayments(p.payments, Number(row.total || 0))) {
    await insert(
      `INSERT INTO payments (org_id, store_id, order_id, method, amount, tip, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [orgId, storeId, row.id, pm.method, pm.amount, 0, req.user.id]
    );
  }
  const settings = await loadSettings(orgId, storeId);
  const invCount = await getRow('SELECT COUNT(*) AS c FROM invoices WHERE org_id=? AND store_id=?', [orgId, storeId]);
  const invoiceNo = `${settings.invoicePrefix || 'INV'}-${new Date().getFullYear()}-${String(Number(invCount?.c || 0) + 1).padStart(5, '0')}`;
  await query('UPDATE orders SET status=?, invoice_no=? WHERE id=?', ['paid', invoiceNo, row.id]);
  await insert('INSERT INTO invoices (org_id,store_id,order_id,invoice_no,amount,tax) VALUES (?,?,?,?,?,?)', [orgId, storeId, row.id, invoiceNo, Number(row.total || 0), Number(row.tax || 0)]);
  const io = req.app.get('io');
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  await deductInventory(order, req.user, io);
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
    receipt: {
      storeName: settings.companyName || 'Store',
      address: settings.address || '', phone: settings.phone || '', gstNo: settings.gstNo || '',
      orderNo: order.orderNo, invoiceNo, items: order.items,
      subtotal: order.subtotal, discount: order.discount, serviceCharge: order.serviceCharge,
      tax: order.tax, taxRate: settings.taxRate, taxInclusive: settings.taxInclusive, total: order.total,
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
