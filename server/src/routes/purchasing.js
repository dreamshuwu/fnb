// ---------------------------------------------------------------------------
// 采购与库存业务路由:供应商主档 / 采购订单 / 收货单 GRN / 库位调拨
// 所有库存数量变动一律经 inventoryEngine + inventoryStore 适配器,
// 保证 avg_cost(移动加权)、quantity、stock_movements 台账三者永远一致。
// ---------------------------------------------------------------------------
import { Router } from 'express';
import {
  query, getRow, insert, toSupplier, toPurchaseOrder, toPurchaseOrderLine,
  toGoodsReceipt, toGoodsReceiptLine, toStockTransfer, toStockTransferLine,
  toInventoryItem, toStockMovement, stringifyJSON,
} from '../db.js';
import { authenticate, tenant, requirePermission } from '../middleware/auth.js';
import { supplierSchema, purchaseOrderSchema, goodsReceiptSchema, stockTransferSchema } from '../validators.js';
import { applyMovements, makeDocNo, derivePoStatus } from '../inventoryEngine.js';
import { inventoryAdapter } from '../inventoryStore.js';
import { emitToStore } from '../sockets.js';

const router = Router();
router.use(authenticate);

const num = (v) => Number(v || 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;
const r3 = (v) => Math.round(num(v) * 1000) / 1000;
const r4 = (v) => Math.round(num(v) * 10000) / 10000;
const dt = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const dtDate = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** 老库可能缺表(如 goods_receipts),读不到就当空,不要让整个报表 500。 */
const safe = async (sql, params) => { try { return await query(sql, params); } catch { return []; } };

/** 统一解析日期区间,默认不限。 */
function range(req, col = 'created_at') {
  const from = req.query.from || null;
  const to = req.query.to || null;
  let sql = '';
  const params = [];
  if (from) { sql += ` AND DATE(${col}) >= ?`; params.push(from); }
  if (to) { sql += ` AND DATE(${col}) <= ?`; params.push(to); }
  return { sql, params, from, to };
}

/** 跌破安全库存就广播,前端库存页/收银页会弹提示。 */
async function notifyLow(io, orgId, storeId, itemIds) {
  const ids = [...new Set(itemIds.map(Number).filter((n) => Number.isFinite(n)))];
  if (!ids.length) return;
  const rows = await query(
    `SELECT id, name, quantity, threshold FROM inventory_items
     WHERE org_id=? AND store_id=? AND id IN (${ids.map(() => '?').join(',')}) AND quantity < threshold`,
    [orgId, storeId, ...ids],
  );
  if (rows.length) {
    emitToStore(io, storeId, 'inventory:low', rows.map((r) => ({
      itemId: String(r.id), name: r.name, quantity: Number(r.quantity),
    })));
  }
}

async function nextSupplierCode(orgId, storeId) {
  const rows = await query(
    "SELECT code FROM suppliers WHERE org_id=? AND store_id=? AND code LIKE 'SUP-%'",
    [orgId, storeId],
  );
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.code || '').replace(/^SUP-/, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `SUP-${String(max + 1).padStart(3, '0')}`;
}

// ===========================================================================
// 供应商主档
// ===========================================================================
router.get('/suppliers', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM suppliers WHERE org_id=? AND store_id=?';
  if (req.query.status) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.q) {
    sql += ' AND (name LIKE ? OR code LIKE ? OR phone LIKE ? OR contact_person LIKE ?)';
    const like = `%${req.query.q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY code IS NULL, code, name';
  res.json((await query(sql, params)).map(toSupplier));
});

router.post('/suppliers', requirePermission('stock.purchase'), async (req, res) => {
  const p = supplierSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const code = p.code || (await nextSupplierCode(orgId, storeId));
  const id = await insert(
    `INSERT INTO suppliers
       (org_id, store_id, code, name, phone, contact, contact_person, email, address,
        tax_no, payment_terms, credit_terms_days, note, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orgId, storeId, code, p.name, p.phone ?? null, p.contactPerson ?? p.contact ?? null,
      p.contactPerson ?? null, p.email ?? null, p.address ?? null, p.taxNo ?? null,
      p.paymentTerms ?? null, p.creditTermsDays ?? 0, p.note ?? null, p.status || 'active'],
  );
  res.status(201).json(toSupplier(await getRow('SELECT * FROM suppliers WHERE id=?', [id])));
});

// 字面量路由必须排在 /suppliers/:id 之前
router.get('/suppliers/next-code', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  res.json({ code: await nextSupplierCode(orgId, storeId) });
});

router.get('/suppliers/:id', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM suppliers WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const pos = await query(
    'SELECT * FROM purchase_orders WHERE org_id=? AND store_id=? AND supplier_id=? ORDER BY created_at DESC LIMIT 50',
    [orgId, storeId, Number(req.params.id)],
  );
  const items = await query(
    'SELECT * FROM inventory_items WHERE org_id=? AND store_id=? AND supplier_id=? ORDER BY name',
    [orgId, storeId, Number(req.params.id)],
  );
  res.json({
    ...toSupplier(row),
    purchaseOrders: pos.map((p) => toPurchaseOrder(p)),
    items: items.map(toInventoryItem),
  });
});

router.put('/suppliers/:id', requirePermission('stock.purchase'), async (req, res) => {
  // partial():只改传了的字段,name 不该是必填
  const p = supplierSchema.partial().parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  const put = (col, v) => { sets.push(`${col}=?`); params.push(v); };
  if (p.code !== undefined) put('code', p.code);
  if (p.name !== undefined) put('name', p.name);
  if (p.phone !== undefined) put('phone', p.phone);
  if (p.contactPerson !== undefined) { put('contact_person', p.contactPerson); put('contact', p.contactPerson); }
  else if (p.contact !== undefined) put('contact', p.contact);
  if (p.email !== undefined) put('email', p.email);
  if (p.address !== undefined) put('address', p.address);
  if (p.taxNo !== undefined) put('tax_no', p.taxNo);
  if (p.paymentTerms !== undefined) put('payment_terms', p.paymentTerms);
  if (p.creditTermsDays !== undefined) put('credit_terms_days', p.creditTermsDays);
  if (p.note !== undefined) put('note', p.note);
  if (p.status !== undefined) put('status', p.status);
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  params.push(Number(req.params.id), orgId, storeId);
  await query(`UPDATE suppliers SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toSupplier(await getRow('SELECT * FROM suppliers WHERE id=?', [Number(req.params.id)])));
});

router.put('/suppliers/:id/status', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const status = req.body?.status === 'inactive' ? 'inactive' : 'active';
  await query('UPDATE suppliers SET status=? WHERE id=? AND org_id=? AND store_id=?',
    [status, Number(req.params.id), orgId, storeId]);
  const row = await getRow('SELECT * FROM suppliers WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(toSupplier(row));
});

// 软删除:有采购单往来的供应商不物理删除,避免历史单据断链
router.delete('/suppliers/:id', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM suppliers WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const used = await getRow(
    'SELECT COUNT(*) AS n FROM purchase_orders WHERE org_id=? AND store_id=? AND supplier_id=?',
    [orgId, storeId, Number(req.params.id)],
  );
  if (Number(used?.n || 0) > 0) {
    await query('UPDATE suppliers SET status=? WHERE id=? AND org_id=? AND store_id=?',
      ['inactive', Number(req.params.id), orgId, storeId]);
    return res.json({ ok: true, softDeleted: true, reason: 'has_purchase_orders' });
  }
  await query('DELETE FROM suppliers WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  res.json({ ok: true, softDeleted: false });
});

// ---- 供应商对账单:采购承诺 vs 实际收货 ----
router.get('/suppliers/:id/statement', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const sup = await getRow('SELECT * FROM suppliers WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!sup) return res.status(404).json({ error: 'not found' });

  const rng = range(req);
  const pos = await query(
    `SELECT * FROM purchase_orders WHERE org_id=? AND store_id=? AND supplier_id=?${rng.sql} ORDER BY created_at`,
    [orgId, storeId, Number(req.params.id), ...rng.params],
  );
  const grns = await safe(
    `SELECT * FROM goods_receipts WHERE org_id=? AND store_id=? AND supplier_id=?${rng.sql} ORDER BY created_at`,
    [orgId, storeId, Number(req.params.id), ...rng.params],
  );

  const activePos = pos.filter((p) => p.status !== 'cancelled');
  const postedGrns = grns.filter((g) => g.status !== 'void');

  const entries = [];
  for (const p of activePos) {
    entries.push({
      date: dt(p.created_at), type: 'po', refNo: p.po_no, poNo: p.po_no,
      status: p.status, ordered: r2(p.total), received: 0, running: 0,
    });
  }
  for (const g of postedGrns) {
    entries.push({
      date: dt(g.created_at), type: 'grn', refNo: g.grn_no, poNo: g.po_no,
      status: g.status, ordered: 0, received: r2(g.total), running: 0,
    });
  }
  entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let running = 0;
  for (const e of entries) { running = r2(running + e.received); e.running = running; }

  const poTotal = r2(activePos.reduce((s, p) => s + num(p.total), 0));
  const receivedTotal = r2(postedGrns.reduce((s, g) => s + num(g.total), 0));
  const lastOrderAt = activePos.length ? dt(activePos[activePos.length - 1].created_at) : null;

  res.json({
    supplier: toSupplier(sup),
    from: rng.from, to: rng.to,
    summary: {
      poCount: activePos.length,
      poTotal,
      grnCount: postedGrns.length,
      receivedTotal,
      // 已下单但还没收货的金额 = 对供应商的未结承诺
      outstanding: r2(poTotal - receivedTotal),
      cancelledCount: pos.length - activePos.length,
      voidedGrnCount: grns.length - postedGrns.length,
      lastOrderAt,
    },
    entries,
    purchaseOrders: activePos.map((p) => toPurchaseOrder(p)),
    goodsReceipts: postedGrns.map((g) => toGoodsReceipt(g)),
  });
});

// ===========================================================================
// 采购订单 Purchase Order —— draft → approved → partial → received / cancelled
// ===========================================================================

/** 读取某张 PO 的行明细。 */
async function loadLines(orgId, storeId, poId) {
  const rows = await query(
    'SELECT * FROM purchase_order_lines WHERE org_id=? AND store_id=? AND po_id=? ORDER BY line_no, id',
    [orgId, storeId, Number(poId)],
  );
  return rows.map(toPurchaseOrderLine);
}

/** 按行重算 小计 / 税额 / 合计。line.taxRate 缺省时回落到单据税率。 */
function computeTotals(lines, defaultTaxRate = 0) {
  let subtotal = 0, taxAmount = 0;
  for (const l of lines) {
    const amount = r2(num(l.qty) * num(l.unitCost));
    subtotal += amount;
    const rate = l.taxRate == null || l.taxRate === '' ? num(defaultTaxRate) : num(l.taxRate);
    taxAmount += (amount * rate) / 100;
  }
  subtotal = r2(subtotal);
  taxAmount = r2(taxAmount);
  return { subtotal, taxAmount, total: r2(subtotal + taxAmount) };
}

async function nextDocNoFor(orgId, storeId, prefix, table, column) {
  const rows = await safe(
    `SELECT ${column} AS no FROM ${table} WHERE org_id=? AND store_id=? AND ${column} LIKE ?`,
    [orgId, storeId, `${prefix}-%`],
  );
  return makeDocNo(prefix, rows.map((r) => r.no));
}

/** 写入行明细(先删后插,保持 line_no 连续)。 */
async function writeLines(orgId, storeId, poId, lines, defaultTaxRate) {
  await query('DELETE FROM purchase_order_lines WHERE org_id=? AND store_id=? AND po_id=?', [orgId, storeId, poId]);
  let lineNo = 1;
  const out = [];
  for (const l of lines) {
    const item = await inventoryAdapter.getItem(orgId, storeId, l.itemId);
    if (!item) { const e = new Error('item_not_found'); e.itemId = l.itemId; throw e; }
    const amount = r2(num(l.qty) * num(l.unitCost));
    const rate = l.taxRate == null || l.taxRate === '' ? num(defaultTaxRate) : num(l.taxRate);
    const id = await insert(
      `INSERT INTO purchase_order_lines
         (org_id, store_id, po_id, line_no, item_id, item_code, item_name, unit,
          qty, received_qty, unit_cost, tax_rate, amount, note)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
      [orgId, storeId, poId, lineNo++, Number(l.itemId), item.code, item.name, item.unit || null,
        r3(l.qty), num(l.unitCost), rate, amount, l.note ?? null],
    );
    out.push(toPurchaseOrderLine(await getRow('SELECT * FROM purchase_order_lines WHERE id=?', [id])));
  }
  return out;
}

router.get('/purchases', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM purchase_orders WHERE org_id=? AND store_id=?';
  if (req.query.status) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.supplierId) { sql += ' AND supplier_id=?'; params.push(Number(req.query.supplierId)); }
  if (req.query.q) { sql += ' AND po_no LIKE ?'; params.push(`%${req.query.q}%`); }
  const rng = range(req);
  sql += rng.sql;
  params.push(...rng.params);
  sql += ' ORDER BY created_at DESC, id DESC LIMIT 500';
  const rows = await query(sql, params);

  // 列表附带行数与已收/未收汇总,前端不必逐单再查一次
  const ids = rows.map((r) => r.id);
  let agg = {};
  if (ids.length) {
    const lines = await safe(
      `SELECT po_id, COUNT(*) AS n, SUM(qty) AS qty, SUM(received_qty) AS received_qty
       FROM purchase_order_lines WHERE po_id IN (${ids.map(() => '?').join(',')}) GROUP BY po_id`,
      ids,
    );
    for (const l of lines) {
      agg[l.po_id] = {
        lineCount: Number(l.n || 0),
        totalQty: r3(l.qty),
        receivedQty: r3(l.received_qty),
      };
    }
  }
  res.json(rows.map((r) => ({
    ...toPurchaseOrder(r),
    ...(agg[r.id] || { lineCount: 0, totalQty: 0, receivedQty: 0 }),
  })));
});

router.post('/purchases', requirePermission('stock.purchase'), async (req, res) => {
  const p = purchaseOrderSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);

  let supplierName = null;
  if (p.supplierId) {
    const sup = await getRow('SELECT * FROM suppliers WHERE id=? AND org_id=? AND store_id=?',
      [Number(p.supplierId), orgId, storeId]);
    if (!sup) return res.status(400).json({ error: 'supplier_not_found' });
    supplierName = sup.name;
  }

  const poNo = await nextDocNoFor(orgId, storeId, 'PO', 'purchase_orders', 'po_no');
  const totals = computeTotals(p.lines, p.taxRate);
  const id = await insert(
    `INSERT INTO purchase_orders
       (org_id, store_id, po_no, supplier_id, supplier_name, subtotal, tax_amount, total,
        status, expected_date, note, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?,?)`,
    [orgId, storeId, poNo, p.supplierId ? Number(p.supplierId) : null, supplierName,
      totals.subtotal, totals.taxAmount, totals.total,
      p.expectedDate || null, p.note ?? null, req.user.id, req.user.name ?? null],
  );

  try {
    await writeLines(orgId, storeId, id, p.lines, p.taxRate);
  } catch (e) {
    // 行写入失败就把单头一起清掉,不留半张空单
    await query('DELETE FROM purchase_order_lines WHERE po_id=?', [id]);
    await query('DELETE FROM purchase_orders WHERE id=?', [id]);
    if (e.message === 'item_not_found') return res.status(400).json({ error: 'item_not_found', itemId: e.itemId });
    throw e;
  }

  const row = await getRow('SELECT * FROM purchase_orders WHERE id=?', [id]);
  res.status(201).json(toPurchaseOrder(row, await loadLines(orgId, storeId, id)));
});

router.get('/purchases/:id', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const lines = await loadLines(orgId, storeId, row.id);
  const receipts = await safe(
    'SELECT * FROM goods_receipts WHERE org_id=? AND store_id=? AND po_id=? ORDER BY created_at DESC',
    [orgId, storeId, row.id],
  );
  res.json({
    ...toPurchaseOrder(row, lines),
    receipts: receipts.map((g) => toGoodsReceipt(g)),
    outstandingQty: r3(lines.reduce((s, l) => s + Math.max(0, l.qty - l.receivedQty), 0)),
  });
});

// 只有 draft 能改行;已审批的单一律拒绝,避免审批后被偷改
router.put('/purchases/:id', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'draft') return res.status(409).json({ error: 'not_editable', status: row.status });

  const b = req.body || {};
  const sets = [], params = [];
  const put = (col, v) => { sets.push(`${col}=?`); params.push(v); };

  if (b.supplierId !== undefined) {
    if (b.supplierId) {
      const sup = await getRow('SELECT * FROM suppliers WHERE id=? AND org_id=? AND store_id=?',
        [Number(b.supplierId), orgId, storeId]);
      if (!sup) return res.status(400).json({ error: 'supplier_not_found' });
      put('supplier_id', Number(b.supplierId));
      put('supplier_name', sup.name);
    } else {
      put('supplier_id', null); put('supplier_name', null);
    }
  }
  if (b.expectedDate !== undefined) put('expected_date', b.expectedDate || null);
  if (b.note !== undefined) put('note', b.note);

  if (Array.isArray(b.lines)) {
    const p = purchaseOrderSchema.parse({ ...b, lines: b.lines });
    const totals = computeTotals(p.lines, p.taxRate);
    put('subtotal', totals.subtotal); put('tax_amount', totals.taxAmount); put('total', totals.total);
    params.push(Number(req.params.id), orgId, storeId);
    await query(`UPDATE purchase_orders SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
    try {
      await writeLines(orgId, storeId, row.id, p.lines, p.taxRate);
    } catch (e) {
      if (e.message === 'item_not_found') return res.status(400).json({ error: 'item_not_found', itemId: e.itemId });
      throw e;
    }
  } else if (sets.length) {
    params.push(Number(req.params.id), orgId, storeId);
    await query(`UPDATE purchase_orders SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  } else {
    return res.status(400).json({ error: 'no fields to update' });
  }

  const updated = await getRow('SELECT * FROM purchase_orders WHERE id=?', [row.id]);
  res.json(toPurchaseOrder(updated, await loadLines(orgId, storeId, row.id)));
});

// ---- 审批 ----
router.post('/purchases/:id/approve', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'draft') return res.status(409).json({ error: 'not_approvable', status: row.status });
  const lines = await loadLines(orgId, storeId, row.id);
  if (!lines.length) return res.status(400).json({ error: 'no_lines' });
  await query(
    "UPDATE purchase_orders SET status='approved', approved_at=NOW(), approved_by=?, approved_by_name=? WHERE id=?",
    [req.user.id, req.user.name ?? null, row.id],
  );
  res.json(toPurchaseOrder(await getRow('SELECT * FROM purchase_orders WHERE id=?', [row.id]), lines));
});

// ---- 取消 ----
router.post('/purchases/:id/cancel', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status === 'cancelled') return res.status(409).json({ error: 'already_cancelled' });
  // 已收货的单不能取消(要走 GRN 作废);部分收货同理
  if (row.status === 'received' || row.status === 'partial') {
    return res.status(409).json({ error: 'has_receipts', status: row.status });
  }
  const lines = await loadLines(orgId, storeId, row.id);
  await query(
    "UPDATE purchase_orders SET status='cancelled', cancelled_at=NOW(), cancel_reason=? WHERE id=?",
    [req.body?.reason ?? null, row.id],
  );
  res.json(toPurchaseOrder(await getRow('SELECT * FROM purchase_orders WHERE id=?', [row.id]), lines));
});

// ---- 删除(仅 draft) ----
router.delete('/purchases/:id', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'draft') return res.status(409).json({ error: 'only_draft_deletable', status: row.status });
  await query('DELETE FROM purchase_order_lines WHERE org_id=? AND store_id=? AND po_id=?', [orgId, storeId, row.id]);
  await query('DELETE FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?', [row.id, orgId, storeId]);
  res.json({ ok: true });
});

// ===========================================================================
// 收货单 GRN —— 支持部分收货,可作废(反向冲销库存)
// ===========================================================================

/**
 * 收货。约定:
 *   - 只有 approved / partial 的采购单能收货
 *   - 不传 lines = 按各行未收数量全额收货
 *   - 超收直接拒绝(要超收请先改单),避免悄悄放大库存与应付
 *   - 库存变动全部经引擎,先全部试算通过再落库
 */
router.post('/purchases/:id/receive', requirePermission('stock.purchase'), async (req, res) => {
  const p = goodsReceiptSchema.parse(req.body || {});
  const { orgId, storeId } = tenant(req);
  const po = await getRow('SELECT * FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!po) return res.status(404).json({ error: 'not found' });
  if (!['approved', 'partial'].includes(po.status)) {
    return res.status(409).json({ error: 'not_receivable', status: po.status });
  }
  const poLines = await loadLines(orgId, storeId, po.id);
  if (!poLines.length) return res.status(400).json({ error: 'no_lines' });

  // ---- pass 1:解析本次收货行,全部校验通过才动库 ----
  const reqLines = (Array.isArray(p.lines) && p.lines.length)
    ? p.lines
    : poLines.filter((l) => l.outstandingQty > 0)
      .map((l) => ({ poLineId: l.id, itemId: l.itemId, qty: l.outstandingQty }));
  if (!reqLines.length) return res.status(400).json({ error: 'nothing_to_receive' });

  const plan = [];
  const errors = [];
  const used = new Map(); // poLineId -> 本次已分配数量(同一行出现多次时累计)
  for (let i = 0; i < reqLines.length; i++) {
    const rl = reqLines[i];
    const line = rl.poLineId
      ? poLines.find((l) => String(l.id) === String(rl.poLineId))
      : poLines.find((l) => String(l.itemId) === String(rl.itemId) && l.outstandingQty > 0);
    if (!line) { errors.push({ index: i, error: 'po_line_not_found', itemId: rl.itemId ?? null }); continue; }
    const qty = r3(rl.qty);
    if (!(qty > 0)) { errors.push({ index: i, error: 'invalid_qty', poLineId: line.id }); continue; }
    const already = used.get(String(line.id)) || 0;
    if (already + qty > line.outstandingQty + 1e-9) {
      errors.push({
        index: i, error: 'over_receipt', poLineId: line.id, itemName: line.itemName,
        requested: qty, outstanding: r3(line.outstandingQty - already),
      });
      continue;
    }
    used.set(String(line.id), r3(already + qty));
    plan.push({
      line, qty,
      unitCost: rl.unitCost != null ? r4(rl.unitCost) : line.unitCost,
      note: rl.note ?? null,
    });
  }
  if (errors.length) return res.status(400).json({ error: 'receive_failed', errors });

  const total = r2(plan.reduce((s, x) => s + x.qty * x.unitCost, 0));
  const grnNo = await nextDocNoFor(orgId, storeId, 'GRN', 'goods_receipts', 'grn_no');
  const grnId = await insert(
    `INSERT INTO goods_receipts
       (org_id, store_id, grn_no, po_id, po_no, supplier_id, supplier_name, total, status, note,
        created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,'posted',?,?,?)`,
    [orgId, storeId, grnNo, po.id, po.po_no, po.supplier_id, po.supplier_name, total,
      p.note ?? null, req.user.id, req.user.name ?? null],
  );

  // 引擎本身是原子的:失败时一行都没落,删掉 GRN 头即可完全回滚
  const mv = await applyMovements(inventoryAdapter, plan.map((x) => ({
    itemId: x.line.itemId, type: 'purchase_receipt', qty: x.qty, unitCost: x.unitCost,
    refType: 'goods_receipt', refId: grnId, refNo: grnNo,
    note: x.note || `收货 ${po.po_no}`,
  })), { orgId, storeId, createdBy: req.user.id, createdByName: req.user.name });

  if (!mv.ok) {
    await query('DELETE FROM goods_receipts WHERE id=?', [grnId]);
    return res.status(400).json({ error: 'receive_failed', errors: mv.errors });
  }

  // 写 GRN 行:before/after/avgCostAfter 直接取引擎返回的同序台账
  for (let i = 0; i < plan.length; i++) {
    const x = plan[i];
    const m = mv.movements[i];
    await insert(
      `INSERT INTO goods_receipt_lines
         (org_id, store_id, grn_id, po_line_id, item_id, item_code, item_name, unit,
          qty, unit_cost, amount, before_qty, after_qty, avg_cost_after, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orgId, storeId, grnId, x.line.id, x.line.itemId, x.line.itemCode, x.line.itemName, x.line.unit,
        x.qty, x.unitCost, r2(x.qty * x.unitCost), m.before, m.after, m.avgCostAfter, x.note],
    );
    await query('UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id=?', [x.qty, x.line.id]);
  }

  // 重新推导 PO 状态:draft → approved → partial → received
  const fresh = await loadLines(orgId, storeId, po.id);
  const newStatus = derivePoStatus(fresh, po.status);
  if (newStatus === 'received') {
    await query("UPDATE purchase_orders SET status=?, received_at=NOW() WHERE id=?", [newStatus, po.id]);
  } else {
    await query('UPDATE purchase_orders SET status=? WHERE id=?', [newStatus, po.id]);
  }

  await notifyLow(req.app.get('io'), orgId, storeId, plan.map((x) => x.line.itemId));
  const grnRow = await getRow('SELECT * FROM goods_receipts WHERE id=?', [grnId]);
  const grnLines = await query('SELECT * FROM goods_receipt_lines WHERE grn_id=? ORDER BY id', [grnId]);
  res.status(201).json({
    ...toGoodsReceipt(grnRow, grnLines),
    poStatus: newStatus,
    movements: mv.movements,
  });
});

router.get('/goods-receipts', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM goods_receipts WHERE org_id=? AND store_id=?';
  if (req.query.status) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.poId) { sql += ' AND po_id=?'; params.push(Number(req.query.poId)); }
  if (req.query.supplierId) { sql += ' AND supplier_id=?'; params.push(Number(req.query.supplierId)); }
  if (req.query.q) { sql += ' AND (grn_no LIKE ? OR po_no LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rng = range(req);
  sql += rng.sql;
  params.push(...rng.params);
  sql += ' ORDER BY created_at DESC, id DESC LIMIT 500';
  res.json((await query(sql, params)).map((r) => toGoodsReceipt(r)));
});

router.get('/goods-receipts/:id', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM goods_receipts WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const lines = await query('SELECT * FROM goods_receipt_lines WHERE grn_id=? ORDER BY id', [row.id]);
  res.json(toGoodsReceipt(row, lines));
});

/**
 * 作废收货单。
 * 冲销按**当前加权成本**出账(不是原收货单价),这样「库存金额 = 数量 × 加权成本」
 * 这个不变式在任何时刻都成立,估值报表才可信。原单金额保留在 GRN 上供审计比对。
 * 允许冲成负库存 —— 货已用掉再作废,拒绝作废只会让账更错。
 */
router.post('/goods-receipts/:id/void', requirePermission('stock.purchase'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const grn = await getRow('SELECT * FROM goods_receipts WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!grn) return res.status(404).json({ error: 'not found' });
  if (grn.status === 'void') return res.status(409).json({ error: 'already_void' });

  const lines = await query('SELECT * FROM goods_receipt_lines WHERE grn_id=? ORDER BY id', [grn.id]);
  if (!lines.length) return res.status(400).json({ error: 'no_lines' });

  const mv = await applyMovements(inventoryAdapter, lines.map((l) => ({
    itemId: l.item_id, type: 'receipt_void', qty: Number(l.qty),
    refType: 'goods_receipt_void', refId: grn.id, refNo: grn.grn_no,
    note: req.body?.reason || `作废收货 ${grn.grn_no}`,
  })), {
    orgId, storeId, allowNegative: true,
    createdBy: req.user.id, createdByName: req.user.name,
  });
  if (!mv.ok) return res.status(400).json({ error: 'void_failed', errors: mv.errors });

  // 回退 PO 行的已收数量(不小于 0)
  for (const l of lines) {
    if (l.po_line_id == null) continue;
    await query('UPDATE purchase_order_lines SET received_qty = GREATEST(0, received_qty - ?) WHERE id=?',
      [Number(l.qty), Number(l.po_line_id)]);
  }

  await query(
    "UPDATE goods_receipts SET status='void', voided_at=NOW(), void_reason=? WHERE id=?",
    [req.body?.reason ?? null, grn.id],
  );

  let poStatus = null;
  if (grn.po_id != null) {
    const po = await getRow('SELECT * FROM purchase_orders WHERE id=?', [Number(grn.po_id)]);
    if (po) {
      const fresh = await loadLines(orgId, storeId, po.id);
      poStatus = derivePoStatus(fresh, po.status === 'received' ? 'approved' : po.status);
      await query('UPDATE purchase_orders SET status=?, received_at=NULL WHERE id=?', [poStatus, po.id]);
    }
  }

  await notifyLow(req.app.get('io'), orgId, storeId, lines.map((l) => l.item_id));
  const row = await getRow('SELECT * FROM goods_receipts WHERE id=?', [grn.id]);
  res.json({
    ...toGoodsReceipt(row, await query('SELECT * FROM goods_receipt_lines WHERE grn_id=? ORDER BY id', [grn.id])),
    poStatus,
    movements: mv.movements,
  });
});

// ===========================================================================
// 库位调拨 —— 按库位拆行:同一物料在不同库位是两行库存
//   调拨 = 源行 transfer_out + 目标行 transfer_in
//   目标库位没有该物料时自动建一行(继承编码/名称/单位/分类/安全库存,数量 0)
//   两条台账都用同一个单价,所以「总库存金额」严格守恒
// ===========================================================================

/** 找目标库位的同物料行:优先按 code 匹配,没有 code 就按 name + unit。 */
async function resolveDestination(orgId, storeId, source, toLocation) {
  const row = source.code
    ? await getRow('SELECT * FROM inventory_items WHERE org_id=? AND store_id=? AND location=? AND code=?',
      [orgId, storeId, toLocation, source.code])
    : await getRow('SELECT * FROM inventory_items WHERE org_id=? AND store_id=? AND location=? AND name=? AND (unit <=> ?)',
      [orgId, storeId, toLocation, source.name, source.unit]);
  return row ? toInventoryItem(row) : null;
}

/** 在目标库位建一行同物料(数量 0,成本继承源行)。 */
async function createDestination(orgId, storeId, source, toLocation) {
  const id = await insert(
    `INSERT INTO inventory_items
       (org_id, store_id, code, name, category, barcode, unit, quantity, threshold,
        cost_price, avg_cost, last_cost, location, supplier_id, note, is_active)
     VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,1)`,
    [orgId, storeId, source.code, source.name, source.category, source.barcode, source.unit,
      source.threshold, source.costPrice, source.avgCost, source.lastCost, toLocation,
      source.supplierId == null ? null : Number(source.supplierId),
      `库位调拨自动创建(来自 ${source.location || '-'})`],
  );
  return toInventoryItem(await getRow('SELECT * FROM inventory_items WHERE id=?', [id]));
}

router.post('/stock-transfers', requirePermission('stock.take'), async (req, res) => {
  const p = stockTransferSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  if (p.fromLocation === p.toLocation) return res.status(400).json({ error: 'same_location' });

  // ---- pass 1:校验源行与可用量,全部通过才动库 ----
  const plan = [];
  const errors = [];
  const used = new Map();
  for (let i = 0; i < p.lines.length; i++) {
    const l = p.lines[i];
    const srcRow = await getRow('SELECT * FROM inventory_items WHERE id=? AND org_id=? AND store_id=?',
      [Number(l.itemId), orgId, storeId]);
    if (!srcRow) { errors.push({ index: i, error: 'item_not_found', itemId: l.itemId }); continue; }
    const source = toInventoryItem(srcRow);
    if ((source.location || '') !== p.fromLocation) {
      errors.push({
        index: i, error: 'location_mismatch', itemId: source.id, itemName: source.name,
        expected: p.fromLocation, actual: source.location,
      });
      continue;
    }
    const qty = r3(l.qty);
    if (!(qty > 0)) { errors.push({ index: i, error: 'invalid_qty', itemId: source.id }); continue; }
    const already = used.get(String(source.id)) || 0;
    if (already + qty > source.quantity + 1e-9) {
      errors.push({
        index: i, error: 'insufficient', itemId: source.id, itemName: source.name,
        requested: qty, available: r3(source.quantity - already),
      });
      continue;
    }
    used.set(String(source.id), r3(already + qty));
    plan.push({ source, qty, note: l.note ?? null, dest: null });
  }
  if (errors.length) return res.status(400).json({ error: 'transfer_failed', errors });

  // ---- 目标行:先确保存在,引擎需要 id ----
  const createdIds = [];
  for (const x of plan) {
    let dest = await resolveDestination(orgId, storeId, x.source, p.toLocation);
    if (!dest) {
      dest = await createDestination(orgId, storeId, x.source, p.toLocation);
      createdIds.push(dest.id);
    }
    x.dest = dest;
  }

  const trNo = await nextDocNoFor(orgId, storeId, 'TR', 'stock_transfers', 'transfer_no');
  const totalCost = r2(plan.reduce((s, x) => s + x.qty * x.source.avgCost, 0));
  const trId = await insert(
    `INSERT INTO stock_transfers
       (org_id, store_id, transfer_no, from_location, to_location, status, total_cost, note,
        created_by, created_by_name)
     VALUES (?,?,?,?,?,'posted',?,?,?,?)`,
    [orgId, storeId, trNo, p.fromLocation, p.toLocation, totalCost, p.note ?? null,
      req.user.id, req.user.name ?? null],
  );

  // 每行两条台账:源行出、目标行入。都用源行当时的加权成本 → 总金额守恒。
  const lines = [];
  for (const x of plan) {
    lines.push({ itemId: x.source.id, type: 'transfer_out', qty: x.qty, refType: 'stock_transfer', note: x.note });
    lines.push({ itemId: x.dest.id, type: 'transfer_in', qty: x.qty, unitCost: x.source.avgCost, refType: 'stock_transfer', note: x.note });
  }
  const mv = await applyMovements(inventoryAdapter, lines.map((l) => ({ ...l, refId: trId, refNo: trNo })),
    { orgId, storeId, createdBy: req.user.id, createdByName: req.user.name });

  if (!mv.ok) {
    // 引擎原子失败 → 什么都没落;把表头和可能新建的目标行一并清掉即可完全回滚
    await query('DELETE FROM stock_transfers WHERE id=?', [trId]);
    if (createdIds.length) {
      await query(`DELETE FROM inventory_items WHERE id IN (${createdIds.map(() => '?').join(',')})`, createdIds.map(Number));
    }
    return res.status(400).json({ error: 'transfer_failed', errors: mv.errors });
  }

  for (let i = 0; i < plan.length; i++) {
    const x = plan[i];
    const out = mv.movements[i * 2];      // 源行出库
    const inn = mv.movements[i * 2 + 1];  // 目标行入库
    await insert(
      `INSERT INTO stock_transfer_lines
         (transfer_id, org_id, store_id, item_id, to_item_id, item_code, item_name, unit,
          qty, unit_cost, amount, before_qty, after_qty, avg_cost_after, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [trId, orgId, storeId, Number(x.source.id), Number(x.dest.id),
        x.source.code, x.source.name, x.source.unit,
        x.qty, x.source.avgCost, r2(x.qty * x.source.avgCost),
        // before/after 记的是**源行**的数量变化;avg_cost_after 记的是**目标行**调拨后的加权成本
        out.before, out.after, inn.avgCostAfter, x.note],
    );
  }

  await notifyLow(req.app.get('io'), orgId, storeId, plan.map((x) => x.source.id));
  const head = await getRow('SELECT * FROM stock_transfers WHERE id=?', [trId]);
  const lineRows = await query('SELECT * FROM stock_transfer_lines WHERE transfer_id=? ORDER BY id', [trId]);
  res.status(201).json({
    ...toStockTransfer(head, lineRows),
    createdItems: createdIds.length
      ? (await query(`SELECT * FROM inventory_items WHERE id IN (${createdIds.map(() => '?').join(',')})`, createdIds.map(Number))).map(toInventoryItem)
      : [],
    movements: mv.movements,
  });
});

router.get('/stock-transfers', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM stock_transfers WHERE org_id=? AND store_id=?';
  if (req.query.status) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.fromLocation) { sql += ' AND from_location=?'; params.push(req.query.fromLocation); }
  if (req.query.toLocation) { sql += ' AND to_location=?'; params.push(req.query.toLocation); }
  if (req.query.q) { sql += ' AND transfer_no LIKE ?'; params.push(`%${req.query.q}%`); }
  const rng = range(req);
  sql += rng.sql;
  params.push(...rng.params);
  sql += ' ORDER BY created_at DESC, id DESC LIMIT 500';
  res.json((await query(sql, params)).map((r) => toStockTransfer(r)));
});

router.get('/stock-transfers/:id', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const head = await getRow('SELECT * FROM stock_transfers WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!head) return res.status(404).json({ error: 'not found' });
  const lines = await query('SELECT * FROM stock_transfer_lines WHERE transfer_id=? ORDER BY id', [head.id]);
  res.json(toStockTransfer(head, lines));
});

/**
 * 作废调拨:两条腿都按**目标行当前加权成本**反向 ——
 * 目标行 -qty*avgDest,源行 +qty*avgDest,总金额严格守恒。
 */
router.post('/stock-transfers/:id/void', requirePermission('stock.take'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const head = await getRow('SELECT * FROM stock_transfers WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!head) return res.status(404).json({ error: 'not found' });
  if (head.status === 'void') return res.status(409).json({ error: 'already_void' });

  const lines = await query('SELECT * FROM stock_transfer_lines WHERE transfer_id=? ORDER BY id', [head.id]);
  if (!lines.length) return res.status(400).json({ error: 'no_lines' });

  const mvLines = [];
  for (const l of lines) {
    const dest = await inventoryAdapter.getItem(orgId, storeId, l.to_item_id);
    if (!dest) return res.status(400).json({ error: 'dest_item_missing', itemId: l.to_item_id });
    // 用目标行当前成本作为两条腿的共同单价
    mvLines.push({ itemId: l.to_item_id, type: 'transfer_out', qty: Number(l.qty), refType: 'stock_transfer_void', note: req.body?.reason || `作废调拨 ${head.transfer_no}` });
    mvLines.push({ itemId: l.item_id, type: 'transfer_in', qty: Number(l.qty), unitCost: dest.avgCost, refType: 'stock_transfer_void', note: req.body?.reason || `作废调拨 ${head.transfer_no}` });
  }
  const mv = await applyMovements(inventoryAdapter, mvLines.map((l) => ({ ...l, refId: head.id, refNo: head.transfer_no })),
    { orgId, storeId, allowNegative: true, createdBy: req.user.id, createdByName: req.user.name });
  if (!mv.ok) return res.status(400).json({ error: 'void_failed', errors: mv.errors });

  await query("UPDATE stock_transfers SET status='void', voided_at=NOW(), void_reason=? WHERE id=?",
    [req.body?.reason ?? null, head.id]);

  await notifyLow(req.app.get('io'), orgId, storeId, lines.map((l) => l.item_id));
  res.json({
    ...toStockTransfer(await getRow('SELECT * FROM stock_transfers WHERE id=?', [head.id]),
      await query('SELECT * FROM stock_transfer_lines WHERE transfer_id=? ORDER BY id', [head.id])),
    movements: mv.movements,
  });
});

export default router;
