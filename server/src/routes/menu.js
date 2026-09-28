import { Router } from 'express';
import { query, getRow, insert, toMenuCategory, toMenuItem, stringifyJSON } from '../db.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { categorySchema, itemSchema } from '../validators.js';

const router = Router();
router.use(authenticate);

router.get('/categories', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const list = await query(
    'SELECT * FROM menu_categories WHERE org_id=? AND store_id=? ORDER BY sort_order',
    [orgId, storeId]
  );
  res.json(list.map(toMenuCategory));
});

router.post('/categories', rbac('admin', 'manager'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO menu_categories (org_id, store_id, name, sort_order, is_active) VALUES (?,?,?,?,?)',
    [orgId, storeId, p.name, p.sortOrder ?? null, p.isActive === false ? 0 : 1]
  );
  res.status(201).json(toMenuCategory(await getRow('SELECT * FROM menu_categories WHERE id=?', [id])));
});

router.put('/categories/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
  if (p.sortOrder !== undefined) { sets.push('sort_order=?'); params.push(p.sortOrder); }
  if (p.isActive !== undefined) { sets.push('is_active=?'); params.push(p.isActive ? 1 : 0); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE menu_categories SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toMenuCategory(await getRow('SELECT * FROM menu_categories WHERE id=?', [req.params.id])));
});

router.delete('/categories/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  await query('DELETE FROM menu_categories WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

router.get('/items', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM menu_items WHERE org_id=? AND store_id=?';
  if (req.query.category) { sql += ' AND category_id=?'; params.push(Number(req.query.category)); }
  const list = await query(sql, params);
  res.json(list.map(toMenuItem));
});

router.post('/items', rbac('admin', 'manager'), async (req, res) => {
  const p = itemSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    `INSERT INTO menu_items
      (org_id, store_id, category_id, name, price, image_url, modifier_groups, track_inventory, inventory_item_id, is_sold_out, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, p.categoryId ? Number(p.categoryId) : null, p.name, p.price ?? 0, p.imageUrl ?? null,
      stringifyJSON(p.modifierGroups ?? []), p.trackInventory ? 1 : 0, p.inventoryItemId ? Number(p.inventoryItemId) : null,
      p.isSoldOut ? 1 : 0, p.isActive === false ? 0 : 1,
    ]
  );
  res.status(201).json(toMenuItem(await getRow('SELECT * FROM menu_items WHERE id=?', [id])));
});

router.put('/items/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = itemSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
  if (p.price !== undefined) { sets.push('price=?'); params.push(p.price); }
  if (p.imageUrl !== undefined) { sets.push('image_url=?'); params.push(p.imageUrl); }
  if (p.modifierGroups !== undefined) { sets.push('modifier_groups=?'); params.push(stringifyJSON(p.modifierGroups)); }
  if (p.trackInventory !== undefined) { sets.push('track_inventory=?'); params.push(p.trackInventory ? 1 : 0); }
  if (p.inventoryItemId !== undefined) { sets.push('inventory_item_id=?'); params.push(p.inventoryItemId ? Number(p.inventoryItemId) : null); }
  if (p.isSoldOut !== undefined) { sets.push('is_sold_out=?'); params.push(p.isSoldOut ? 1 : 0); }
  if (p.isActive !== undefined) { sets.push('is_active=?'); params.push(p.isActive ? 1 : 0); }
  if (p.categoryId !== undefined) { sets.push('category_id=?'); params.push(p.categoryId ? Number(p.categoryId) : null); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE menu_items SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toMenuItem(await getRow('SELECT * FROM menu_items WHERE id=?', [req.params.id])));
});

router.delete('/items/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  await query('DELETE FROM menu_items WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

export default router;
