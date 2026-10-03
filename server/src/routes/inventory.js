import { Router } from 'express';
import { query, getRow, insert, toInventoryItem, toStockMovement } from '../db.js';
import { authenticate, tenant, requirePermission } from '../middleware/auth.js';
import { inventoryItemSchema, adjustSchema, stockAdjustBatchSchema } from '../validators.js';
import { emitToStore } from '../sockets.js';
import { applyMovements, valuationOf } from '../inventoryEngine.js';
import { inventoryAdapter } from '../inventoryStore.js';

const router = Router();
router.use(authenticate);

/** 落库后统一检查是否跌破安全库存并广播。 */
async function notifyLow(io, orgId, storeId, itemIds) {
  if (!itemIds.length) return;
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT id, name, quantity, threshold FROM inventory_items
     WHERE org_id=? AND store_id=? AND id IN (${placeholders}) AND quantity < threshold`,
    [orgId, storeId, ...itemIds],
  );
  if (rows.length) {
    emitToStore(io, storeId, 'inventory:low', rows.map((r) => ({
      itemId: String(r.id), name: r.name, quantity: Number(r.quantity),
    })));
  }
}

// ---- 库存主档：支持 分类 / 库位 / 供应商 / 低库存 / 关键词 过滤 ----
router.get('/items', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM inventory_items WHERE org_id=? AND store_id=?';
  if (req.query.category) { sql += ' AND category=?'; params.push(req.query.category); }
  if (req.query.location) { sql += ' AND location=?'; params.push(req.query.location); }
  if (req.query.supplierId) { sql += ' AND supplier_id=?'; params.push(Number(req.query.supplierId)); }
  if (req.query.low === '1' || req.query.low === 'true') sql += ' AND quantity < threshold';
  if (req.query.q) {
    sql += ' AND (name LIKE ? OR code LIKE ? OR barcode LIKE ?)';
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY code IS NULL, code, name';
  const list = await query(sql, params);
  res.json(list.map(toInventoryItem));
});

router.get('/items/:id', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM inventory_items WHERE id=? AND org_id=? AND store_id=?',
    [Number(req.params.id), orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const movements = await query(
    'SELECT * FROM stock_movements WHERE org_id=? AND store_id=? AND item_id=? ORDER BY created_at DESC, id DESC LIMIT 50',
    [orgId, storeId, Number(req.params.id)],
  );
  res.json({ ...toInventoryItem(row), movements: movements.map(toStockMovement) });
});

router.post('/items', requirePermission('stock.take'), async (req, res) => {
  const p = inventoryItemSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const avgCost = p.avgCost != null ? p.avgCost : (p.costPrice ?? 0);
  const id = await insert(
    `INSERT INTO inventory_items
       (org_id, store_id, code, name, category, barcode, unit, quantity, threshold,
        cost_price, avg_cost, last_cost, location, supplier_id, note, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orgId, storeId, p.code ?? null, p.name, p.category ?? null, p.barcode ?? null, p.unit ?? null,
      0, p.threshold ?? 0, p.costPrice ?? null, avgCost,
      p.lastCost != null ? p.lastCost : avgCost, p.location ?? null,
      p.supplierId == null || p.supplierId === '' ? null : Number(p.supplierId),
      p.note ?? null, p.isActive === false ? 0 : 1],
  );
  // 期初数量也走引擎,保证 quantity / avg_cost / 台账三者永远一致
  const qty = Number(p.quantity ?? 0);
  if (qty !== 0) {
    const r = await applyMovements(inventoryAdapter, [{
      itemId: id, type: 'opening', qty, unitCost: avgCost, note: '新建物料期初',
    }], { orgId, storeId, createdBy: req.user.id, createdByName: req.user.name });
    if (!r.ok) return res.status(400).json({ error: r.errors[0].error, detail: r.errors[0] });
  }
  res.status(201).json(toInventoryItem(await getRow('SELECT * FROM inventory_items WHERE id=?', [id])));
});

router.put('/items/:id', requirePermission('stock.take'), async (req, res) => {
  // partial():这是「只改传了的字段」语义,name 不该是必填
  const p = inventoryItemSchema.partial().parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  const put = (col, v) => { sets.push(`${col}=?`); params.push(v); };
  if (p.code !== undefined) put('code', p.code);
  if (p.name !== undefined) put('name', p.name);
  if (p.category !== undefined) put('category', p.category);
  if (p.barcode !== undefined) put('barcode', p.barcode);
  if (p.unit !== undefined) put('unit', p.unit);
  if (p.threshold !== undefined) put('threshold', p.threshold);
  if (p.costPrice !== undefined) put('cost_price', p.costPrice);
  if (p.avgCost !== undefined) put('avg_cost', p.avgCost);
  if (p.lastCost !== undefined) put('last_cost', p.lastCost);
  if (p.location !== undefined) put('location', p.location);
  if (p.note !== undefined) put('note', p.note);
  if (p.isActive !== undefined) put('is_active', p.isActive ? 1 : 0);
  if (p.supplierId !== undefined) put('supplier_id', p.supplierId == null || p.supplierId === '' ? null : Number(p.supplierId));
  // quantity 不在此改:必须走 /inventory/adjust,否则台账会缺行
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE inventory_items SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toInventoryItem(await getRow('SELECT * FROM inventory_items WHERE id=?', [req.params.id])));
});

// ---- 单笔库存变动(调整 / 损耗 / 退供应商 / 盘点) ----
router.post('/adjust', requirePermission('stock.take'), async (req, res) => {
  const p = adjustSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const itemId = p.itemId ?? req.body.itemId;
  if (itemId == null) return res.status(400).json({ error: 'itemId required' });
  const r = await applyMovements(inventoryAdapter, [{
    itemId, type: p.type,
    // count 传绝对值,其余传增量 —— 由引擎按 type 解释,这里原样透传
    qty: p.delta,
    unitCost: p.unitCost,
    note: p.note || p.reason,
    location: p.location,
    refType: p.type, refNo: p.refNo,
  }], { orgId, storeId, createdBy: req.user.id, createdByName: req.user.name });
  if (!r.ok) {
    const e = r.errors[0];
    return res.status(e.error === 'item_not_found' ? 404 : 400).json({ error: e.error, detail: e });
  }
  await notifyLow(req.app.get('io'), orgId, storeId, [Number(itemId)]);
  const row = await getRow('SELECT * FROM inventory_items WHERE id=?', [Number(itemId)]);
  res.json({ ...toInventoryItem(row), movement: r.movements[0] });
});

// ---- 批量库存变动(盘点表一次提交多行,全通过才落库) ----
router.post('/adjust/batch', requirePermission('stock.take'), async (req, res) => {
  const p = stockAdjustBatchSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const lines = p.lines.map((l) => ({
    itemId: l.itemId,
    type: p.type,
    qty: l.qty != null ? l.qty : l.delta,
    unitCost: l.unitCost,
    note: l.note || p.reason,
    location: p.location,
    refType: p.type,
  }));
  const r = await applyMovements(inventoryAdapter, lines, {
    orgId, storeId, createdBy: req.user.id, createdByName: req.user.name,
  });
  if (!r.ok) return res.status(400).json({ error: 'batch_failed', errors: r.errors });
  await notifyLow(req.app.get('io'), orgId, storeId, r.items.map((i) => Number(i.item.id)));
  res.json({ ok: true, count: r.movements.length, movements: r.movements });
});

router.get('/movements', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM stock_movements WHERE org_id=? AND store_id=?';
  if (req.query.itemId) { sql += ' AND item_id=?'; params.push(Number(req.query.itemId)); }
  if (req.query.type) { sql += ' AND type=?'; params.push(req.query.type); }
  if (req.query.refType) { sql += ' AND ref_type=?'; params.push(req.query.refType); }
  if (req.query.refId) { sql += ' AND ref_id=?'; params.push(Number(req.query.refId)); }
  if (req.query.from) { sql += ' AND DATE(created_at) >= ?'; params.push(req.query.from); }
  if (req.query.to) { sql += ' AND DATE(created_at) <= ?'; params.push(req.query.to); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(Math.min(Number(req.query.limit || 200), 1000));
  const list = await query(sql, params);
  res.json(list.map(toStockMovement));
});

// ---- 库存估值(以移动加权成本计价) ----
router.get('/valuation', requirePermission('stock.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const rows = await query('SELECT * FROM inventory_items WHERE org_id=? AND store_id=?', [orgId, storeId]);
  res.json(valuationOf(rows.map(toInventoryItem)));
});

export default router;
