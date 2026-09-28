import { Router } from 'express';
import { query, getRow, insert, toInventoryItem, toStockMovement } from '../db.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { inventoryItemSchema, adjustSchema } from '../validators.js';
import { emitToStore } from '../sockets.js';

const router = Router();
router.use(authenticate);

router.get('/items', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const list = await query('SELECT * FROM inventory_items WHERE org_id=? AND store_id=?', [orgId, storeId]);
  res.json(list.map(toInventoryItem));
});

router.post('/items', rbac('admin', 'manager'), async (req, res) => {
  const p = inventoryItemSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    `INSERT INTO inventory_items (org_id, store_id, name, unit, quantity, threshold, cost_price)
     VALUES (?,?,?,?,?,?,?)`,
    [orgId, storeId, p.name, p.unit ?? null, p.quantity ?? 0, p.threshold ?? 0, p.costPrice ?? null]
  );
  res.status(201).json(toInventoryItem(await getRow('SELECT * FROM inventory_items WHERE id=?', [id])));
});

router.put('/items/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = inventoryItemSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
  if (p.unit !== undefined) { sets.push('unit=?'); params.push(p.unit); }
  if (p.quantity !== undefined) { sets.push('quantity=?'); params.push(p.quantity); }
  if (p.threshold !== undefined) { sets.push('threshold=?'); params.push(p.threshold); }
  if (p.costPrice !== undefined) { sets.push('cost_price=?'); params.push(p.costPrice); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE inventory_items SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toInventoryItem(await getRow('SELECT * FROM inventory_items WHERE id=?', [req.params.id])));
});

router.post('/adjust', rbac('admin', 'manager'), async (req, res) => {
  const p = adjustSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const item = await getRow('SELECT * FROM inventory_items WHERE id=? AND org_id=? AND store_id=?', [Number(req.body.itemId), orgId, storeId]);
  if (!item) return res.status(404).json({ error: 'not found' });
  const before = Number(item.quantity || 0);
  const after = p.type === 'count' ? Math.max(0, p.delta) : Math.max(0, before + p.delta);
  await query('UPDATE inventory_items SET quantity=? WHERE id=?', [after, item.id]);
  await insert(
    `INSERT INTO stock_movements (org_id, store_id, item_id, type, delta, before, after, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [orgId, storeId, item.id, p.type, p.delta, before, after, req.user.id]
  );
  const updated = await getRow('SELECT * FROM inventory_items WHERE id=?', [item.id]);
  const io = req.app.get('io');
  if (Number(updated.quantity || 0) < Number(updated.threshold || 0)) {
    emitToStore(io, storeId, 'inventory:low', [{ itemId: String(updated.id), name: updated.name, quantity: Number(updated.quantity) }]);
  }
  res.json(toInventoryItem(updated));
});

router.get('/movements', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM stock_movements WHERE org_id=? AND store_id=?';
  if (req.query.itemId) { sql += ' AND item_id=?'; params.push(Number(req.query.itemId)); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const list = await query(sql, params);
  res.json(list.map(toStockMovement));
});

export default router;
