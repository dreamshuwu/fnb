import { Router } from 'express';
import { query, getRow, insert, toMenuCategory, toMenuBase, toModifier, toBaseModifier, toVariant, stringifyJSON } from '../db.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { categorySchema, baseSchema, modifierSchema, baseModifierSchema, variantSchema } from '../validators.js';

const router = Router();
router.use(authenticate);

// ---- 分类 ----
router.get('/categories', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const list = await query('SELECT * FROM menu_categories WHERE org_id=? AND store_id=? ORDER BY sort_order', [orgId, storeId]);
  res.json(list.map(toMenuCategory));
});
router.post('/categories', rbac('admin', 'manager'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO menu_categories (org_id, store_id, name, color, sort_order, is_active) VALUES (?,?,?,?,?,?)',
    [orgId, storeId, p.name, p.color ?? null, p.sortOrder ?? null, p.isActive === false ? 0 : 1]
  );
  res.status(201).json(toMenuCategory(await getRow('SELECT * FROM menu_categories WHERE id=?', [id])));
});
router.put('/categories/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
  if (p.color !== undefined) { sets.push('color=?'); params.push(p.color); }
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

// ---- 基底 ----
router.get('/bases', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  let sql = 'SELECT * FROM menu_bases WHERE org_id=? AND store_id=?';
  const params = [orgId, storeId];
  if (req.query.category) { sql += ' AND category_id=?'; params.push(Number(req.query.category)); }
  sql += ' ORDER BY sort_order';
  res.json((await query(sql, params)).map(toMenuBase));
});
router.post('/bases', rbac('admin', 'manager'), async (req, res) => {
  const p = baseSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO menu_bases (org_id, store_id, category_id, name, base_price, sort_order, is_active) VALUES (?,?,?,?,?,?,?)',
    [orgId, storeId, p.categoryId ? Number(p.categoryId) : null, p.name, p.basePrice ?? 0, p.sortOrder ?? null, p.isActive === false ? 0 : 1]
  );
  res.status(201).json(toMenuBase(await getRow('SELECT * FROM menu_bases WHERE id=?', [id])));
});
router.put('/bases/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = baseSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.categoryId !== undefined) { sets.push('category_id=?'); params.push(p.categoryId ? Number(p.categoryId) : null); }
  if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
  if (p.basePrice !== undefined) { sets.push('base_price=?'); params.push(p.basePrice); }
  if (p.sortOrder !== undefined) { sets.push('sort_order=?'); params.push(p.sortOrder); }
  if (p.isActive !== undefined) { sets.push('is_active=?'); params.push(p.isActive ? 1 : 0); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE menu_bases SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toMenuBase(await getRow('SELECT * FROM menu_bases WHERE id=?', [req.params.id])));
});
router.delete('/bases/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  await query('DELETE FROM menu_bases WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

// ---- 修饰/后缀 ----
router.get('/modifiers', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const list = await query('SELECT * FROM menu_modifiers WHERE org_id=? AND store_id=? ORDER BY sort_order', [orgId, storeId]);
  res.json(list.map(toModifier));
});
router.post('/modifiers', rbac('admin', 'manager'), async (req, res) => {
  const p = modifierSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO menu_modifiers (org_id, store_id, code, label, default_delta, sort_order, is_active) VALUES (?,?,?,?,?,?,?)',
    [orgId, storeId, p.code, p.label ?? null, p.defaultDelta ?? 0, p.sortOrder ?? null, p.isActive === false ? 0 : 1]
  );
  res.status(201).json(toModifier(await getRow('SELECT * FROM menu_modifiers WHERE id=?', [id])));
});
router.put('/modifiers/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = modifierSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.code !== undefined) { sets.push('code=?'); params.push(p.code); }
  if (p.label !== undefined) { sets.push('label=?'); params.push(p.label); }
  if (p.defaultDelta !== undefined) { sets.push('default_delta=?'); params.push(p.defaultDelta); }
  if (p.sortOrder !== undefined) { sets.push('sort_order=?'); params.push(p.sortOrder); }
  if (p.isActive !== undefined) { sets.push('is_active=?'); params.push(p.isActive ? 1 : 0); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE menu_modifiers SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toModifier(await getRow('SELECT * FROM menu_modifiers WHERE id=?', [req.params.id])));
});
router.delete('/modifiers/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  await query('DELETE FROM menu_modifiers WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

// ---- 基底↔修饰 关联 ----
router.get('/base-modifiers', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  let sql = 'SELECT * FROM menu_base_modifiers WHERE org_id=? AND store_id=?';
  const params = [orgId, storeId];
  if (req.query.baseId) { sql += ' AND base_id=?'; params.push(Number(req.query.baseId)); }
  res.json((await query(sql, params)).map(toBaseModifier));
});
router.post('/base-modifiers', rbac('admin', 'manager'), async (req, res) => {
  const p = baseModifierSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  try {
    const id = await insert(
      'INSERT INTO menu_base_modifiers (org_id, store_id, base_id, modifier_id, delta) VALUES (?,?,?,?,?)',
      [orgId, storeId, Number(p.baseId), Number(p.modifierId), p.delta == null ? null : p.delta]
    );
    res.status(201).json(toBaseModifier(await getRow('SELECT * FROM menu_base_modifiers WHERE id=?', [id])));
  } catch {
    res.status(409).json({ error: 'already linked' });
  }
});
router.delete('/base-modifiers/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  await query('DELETE FROM menu_base_modifiers WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

// ---- 成品变体 ----
router.get('/variants', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  let sql = 'SELECT * FROM menu_variants WHERE org_id=? AND store_id=?';
  const params = [orgId, storeId];
  if (req.query.baseId) { sql += ' AND base_id=?'; params.push(Number(req.query.baseId)); }
  if (req.query.categoryId) { sql += ' AND category_id=?'; params.push(Number(req.query.categoryId)); }
  sql += ' ORDER BY sort_order';
  res.json((await query(sql, params)).map(toVariant));
});
router.post('/variants', rbac('admin', 'manager'), async (req, res) => {
  const p = variantSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    `INSERT INTO menu_variants
      (org_id, store_id, base_id, category_id, code, name, modifier_ids, price, cost, stock_qty, stock_threshold, barcode, sort_order, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, Number(p.baseId), p.categoryId ? Number(p.categoryId) : null,
      p.code, p.name, stringifyJSON(p.modifierIds ?? []), p.price, p.cost ?? 0,
      p.stockQty ?? 0, p.stockThreshold ?? 0, p.barcode ?? null, p.sortOrder ?? null,
      p.isActive === false ? 0 : 1,
    ]
  );
  res.status(201).json(toVariant(await getRow('SELECT * FROM menu_variants WHERE id=?', [id])));
});
router.put('/variants/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = variantSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.categoryId !== undefined) { sets.push('category_id=?'); params.push(p.categoryId ? Number(p.categoryId) : null); }
  if (p.code !== undefined) { sets.push('code=?'); params.push(p.code); }
  if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
  if (p.modifierIds !== undefined) { sets.push('modifier_ids=?'); params.push(stringifyJSON(p.modifierIds)); }
  if (p.price !== undefined) { sets.push('price=?'); params.push(p.price); }
  if (p.cost !== undefined) { sets.push('cost=?'); params.push(p.cost); }
  if (p.stockQty !== undefined) { sets.push('stock_qty=?'); params.push(p.stockQty); }
  if (p.stockThreshold !== undefined) { sets.push('stock_threshold=?'); params.push(p.stockThreshold); }
  if (p.barcode !== undefined) { sets.push('barcode=?'); params.push(p.barcode); }
  if (p.sortOrder !== undefined) { sets.push('sort_order=?'); params.push(p.sortOrder); }
  if (p.isActive !== undefined) { sets.push('is_active=?'); params.push(p.isActive ? 1 : 0); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE menu_variants SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toVariant(await getRow('SELECT * FROM menu_variants WHERE id=?', [req.params.id])));
});
router.delete('/variants/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  await query('DELETE FROM menu_variants WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

// ---- 一次性拉取整棵菜单树（收银端用） ----
router.get('/tree', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const [cats, bases, mods, bms, vs] = await Promise.all([
    query('SELECT * FROM menu_categories WHERE org_id=? AND store_id=? ORDER BY sort_order', [orgId, storeId]),
    query('SELECT * FROM menu_bases WHERE org_id=? AND store_id=? ORDER BY sort_order', [orgId, storeId]),
    query('SELECT * FROM menu_modifiers WHERE org_id=? AND store_id=? ORDER BY sort_order', [orgId, storeId]),
    query('SELECT * FROM menu_base_modifiers WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM menu_variants WHERE org_id=? AND store_id=? AND is_active=1 ORDER BY sort_order', [orgId, storeId]),
  ]);
  res.json({
    categories: cats.map(toMenuCategory),
    bases: bases.map(toMenuBase),
    modifiers: mods.map(toModifier),
    baseModifiers: bms.map(toBaseModifier),
    variants: vs.map(toVariant),
  });
});

export default router;
