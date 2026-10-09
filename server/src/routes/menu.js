import { Router } from 'express';
import {
  query, getRow, insert, stringifyJSON,
  toMenuCategory, toMenuBase, toModifier, toBaseModifier, toVariant,
  toMainGroup, toPrintGroup, toDepartment, toUom, toSupplier,
} from '../db.js';
import { authenticate, rbac, tenant, requirePermission } from '../middleware/auth.js';
import {
  categorySchema, baseSchema, modifierSchema, baseModifierSchema, variantSchema, variantUpdateSchema,
  mainGroupSchema, mainGroupUpdateSchema, printGroupSchema, printGroupUpdateSchema,
  departmentSchema, departmentUpdateSchema, uomSchema, uomUpdateSchema,
} from '../validators.js';
// 主数据共享规则:与 devMode 用同一份,避免「预览能删、生产删不掉」这类漂移
import { MASTER_TYPES, makeMasterCode, baseUnitRule } from '../masterData.js';
// 产品主档拼装/过滤/批量修改规则:同样与 devMode 共用一份
import { buildProducts, matchProduct, summarizeProducts, buildBulkPatch } from '../productMaster.js';

const router = Router();
router.use(authenticate);

// ---- 分类 ----
router.get('/categories', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const list = await query('SELECT * FROM menu_categories WHERE org_id=? AND store_id=? ORDER BY sort_order', [orgId, storeId]);
  res.json(list.map(toMenuCategory));
});
router.post('/categories', requirePermission('menu.edit'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO menu_categories (org_id, store_id, name, color, sort_order, is_active, main_group_id, department_id) VALUES (?,?,?,?,?,?,?,?)',
    [orgId, storeId, p.name, p.color ?? null, p.sortOrder ?? null, p.isActive === false ? 0 : 1,
      p.mainGroupId ? Number(p.mainGroupId) : null, p.departmentId ? Number(p.departmentId) : null]
  );
  res.status(201).json(toMenuCategory(await getRow('SELECT * FROM menu_categories WHERE id=?', [id])));
});
router.put('/categories/:id', requirePermission('menu.edit'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
  if (p.color !== undefined) { sets.push('color=?'); params.push(p.color); }
  if (p.sortOrder !== undefined) { sets.push('sort_order=?'); params.push(p.sortOrder); }
  if (p.isActive !== undefined) { sets.push('is_active=?'); params.push(p.isActive ? 1 : 0); }
  if (p.mainGroupId !== undefined) { sets.push('main_group_id=?'); params.push(p.mainGroupId ? Number(p.mainGroupId) : null); }
  if (p.departmentId !== undefined) { sets.push('department_id=?'); params.push(p.departmentId ? Number(p.departmentId) : null); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE menu_categories SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toMenuCategory(await getRow('SELECT * FROM menu_categories WHERE id=?', [req.params.id])));
});
router.delete('/categories/:id', requirePermission('menu.edit'), async (req, res) => {
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
router.post('/bases', requirePermission('menu.edit'), async (req, res) => {
  const p = baseSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO menu_bases (org_id, store_id, category_id, name, base_price, sort_order, is_active) VALUES (?,?,?,?,?,?,?)',
    [orgId, storeId, p.categoryId ? Number(p.categoryId) : null, p.name, p.basePrice ?? 0, p.sortOrder ?? null, p.isActive === false ? 0 : 1]
  );
  res.status(201).json(toMenuBase(await getRow('SELECT * FROM menu_bases WHERE id=?', [id])));
});
router.put('/bases/:id', requirePermission('menu.edit'), async (req, res) => {
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
router.delete('/bases/:id', requirePermission('menu.edit'), async (req, res) => {
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
router.post('/modifiers', requirePermission('menu.edit'), async (req, res) => {
  const p = modifierSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO menu_modifiers (org_id, store_id, code, label, default_delta, sort_order, is_active) VALUES (?,?,?,?,?,?,?)',
    [orgId, storeId, p.code, p.label ?? null, p.defaultDelta ?? 0, p.sortOrder ?? null, p.isActive === false ? 0 : 1]
  );
  res.status(201).json(toModifier(await getRow('SELECT * FROM menu_modifiers WHERE id=?', [id])));
});
router.put('/modifiers/:id', requirePermission('menu.edit'), async (req, res) => {
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
router.delete('/modifiers/:id', requirePermission('menu.edit'), async (req, res) => {
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
router.post('/base-modifiers', requirePermission('menu.edit'), async (req, res) => {
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
router.delete('/base-modifiers/:id', requirePermission('menu.edit'), async (req, res) => {
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
router.post('/variants', requirePermission('menu.edit'), async (req, res) => {
  const p = variantSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    `INSERT INTO menu_variants
      (org_id, store_id, base_id, category_id, code, name, modifier_ids, price, cost, stock_qty, stock_threshold, barcode, sort_order, is_active,
       main_group_id, print_group_id, department_id, supplier_id, uom, pack_uom, pack_factor)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, Number(p.baseId), p.categoryId ? Number(p.categoryId) : null,
      p.code, p.name, stringifyJSON(p.modifierIds ?? []), p.price, p.cost ?? 0,
      p.stockQty ?? 0, p.stockThreshold ?? 0, p.barcode ?? null, p.sortOrder ?? null,
      p.isActive === false ? 0 : 1,
      p.mainGroupId ? Number(p.mainGroupId) : null, p.printGroupId ? Number(p.printGroupId) : null,
      p.departmentId ? Number(p.departmentId) : null, p.supplierId ? Number(p.supplierId) : null,
      p.uom || null, p.packUom || null, p.packFactor ?? 1,
    ]
  );
  res.status(201).json(toVariant(await getRow('SELECT * FROM menu_variants WHERE id=?', [id])));
});
router.put('/variants/:id', requirePermission('menu.edit'), async (req, res) => {
  const p = variantUpdateSchema.parse(req.body);
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
  if (p.mainGroupId !== undefined) { sets.push('main_group_id=?'); params.push(p.mainGroupId ? Number(p.mainGroupId) : null); }
  if (p.printGroupId !== undefined) { sets.push('print_group_id=?'); params.push(p.printGroupId ? Number(p.printGroupId) : null); }
  if (p.departmentId !== undefined) { sets.push('department_id=?'); params.push(p.departmentId ? Number(p.departmentId) : null); }
  if (p.supplierId !== undefined) { sets.push('supplier_id=?'); params.push(p.supplierId ? Number(p.supplierId) : null); }
  if (p.uom !== undefined) { sets.push('uom=?'); params.push(p.uom || null); }
  if (p.packUom !== undefined) { sets.push('pack_uom=?'); params.push(p.packUom || null); }
  if (p.packFactor !== undefined) { sets.push('pack_factor=?'); params.push(p.packFactor); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE menu_variants SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toVariant(await getRow('SELECT * FROM menu_variants WHERE id=?', [req.params.id])));
});
router.delete('/variants/:id', requirePermission('menu.edit'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  await query('DELETE FROM menu_variants WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

// ===========================================================================
// Smcin 主数据：商品大类 / 打印分组 / 部门 / 计量单位
// ---------------------------------------------------------------------------
// 前三类结构完全一致(编码 + 名称 + 排序 + 启停 + 备注),用一个工厂生成 CRUD,
// 避免三份复制粘贴;计量单位多出量纲/换算系数/基准标记,单独给 extra 钩子。
// 写操作统一走 settings.edit —— 主数据会改变报表口径与打印路由,属于配置。
// ===========================================================================

// 领域语言(集合/字段) -> MySQL(表/列),让共享规则能直接驱动 SQL
const TABLE_BY_COLLECTION = { categories: 'menu_categories', variants: 'menu_variants' };
const COLUMN_BY_FIELD = {
  mainGroupId: 'main_group_id', printGroupId: 'print_group_id',
  departmentId: 'department_id', uom: 'uom', packUom: 'pack_uom',
};

/** 删除前统计引用:主数据被分类/商品引用时不允许删,否则会留下悬空外键。 */
async function masterRefCounts(orgId, storeId, refs, row) {
  const counts = {};
  for (const r of refs) {
    const val = r.byCode ? row.code : row.id;
    if (val == null) continue;
    const table = TABLE_BY_COLLECTION[r.collection];
    const column = COLUMN_BY_FIELD[r.field];
    if (!table || !column) continue;
    const n = Number((await getRow(
      `SELECT COUNT(*) AS c FROM ${table} WHERE org_id=? AND store_id=? AND ${column}=?`,
      [orgId, storeId, val],
    ))?.c || 0);
    if (n) counts[`${r.collection}.${r.field}`] = n;
  }
  return counts;
}

const MASTER_SPECS = [
  {
    path: 'main-groups', table: 'main_groups', mapper: toMainGroup,
    schema: mainGroupSchema, updateSchema: mainGroupUpdateSchema,
  },
  {
    path: 'print-groups', table: 'print_groups', mapper: toPrintGroup,
    schema: printGroupSchema, updateSchema: printGroupUpdateSchema,
  },
  {
    path: 'departments', table: 'departments', mapper: toDepartment,
    schema: departmentSchema, updateSchema: departmentUpdateSchema,
  },
  {
    path: 'uoms', table: 'uoms', mapper: toUom,
    schema: uomSchema, updateSchema: uomUpdateSchema,
    extra: (p) => {
      const { forceFactorOne } = baseUnitRule(p, null);
      return {
        cols: ['dimension', 'factor', 'is_base'],
        // 基准单位的换算系数恒为 1,否则「基准」就失去意义
        vals: [p.dimension || 'count', forceFactorOne ? 1 : (p.factor ?? 1), p.isBase ? 1 : 0],
      };
    },
    extraUpdate: (p) => {
      const sets = [], vals = [];
      if (p.dimension !== undefined) { sets.push('dimension=?'); vals.push(p.dimension); }
      if (p.factor !== undefined) { sets.push('factor=?'); vals.push(p.factor); }
      if (p.isBase !== undefined) { sets.push('is_base=?'); vals.push(p.isBase ? 1 : 0); }
      return { sets, vals };
    },
    // 每个量纲只能有一个基准单位(与 member_tiers 的「唯一默认等级」同一策略)
    beforeWrite: async (orgId, storeId, p, existing) => {
      const { clearOthers } = baseUnitRule(p, existing);
      if (!clearOthers) return;
      if (existing) await query('UPDATE uoms SET is_base=0 WHERE org_id=? AND store_id=? AND dimension=? AND id<>?', [orgId, storeId, clearOthers, existing.id]);
      else await query('UPDATE uoms SET is_base=0 WHERE org_id=? AND store_id=? AND dimension=?', [orgId, storeId, clearOthers]);
    },
  },
];

for (const spec of MASTER_SPECS) {
  router.get(`/${spec.path}`, async (req, res) => {
    const { orgId, storeId } = tenant(req);
    let sql = `SELECT * FROM ${spec.table} WHERE org_id=? AND store_id=?`;
    const params = [orgId, storeId];
    if (req.query.active === '1') sql += ' AND is_active=1';
    sql += ' ORDER BY sort_order ASC, id ASC';
    res.json((await query(sql, params)).map(spec.mapper));
  });

  router.get(`/${spec.path}/:id`, async (req, res) => {
    const { orgId, storeId } = tenant(req);
    const row = await getRow(`SELECT * FROM ${spec.table} WHERE id=? AND org_id=? AND store_id=?`, [req.params.id, orgId, storeId]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(spec.mapper(row));
  });

  router.post(`/${spec.path}`, requirePermission('settings.edit'), async (req, res) => {
    const p = spec.schema.parse(req.body);
    const { orgId, storeId } = tenant(req);
    const existingCodes = (await query(`SELECT code FROM ${spec.table} WHERE org_id=? AND store_id=?`, [orgId, storeId]))
      .map((r) => r.code).filter(Boolean);
    const code = String(p.code || '').trim() || makeMasterCode(p.name, existingCodes);
    if (existingCodes.some((c) => String(c).toUpperCase() === code.toUpperCase())) {
      return res.status(400).json({ error: 'duplicate_code', code });
    }
    if (spec.beforeWrite) await spec.beforeWrite(orgId, storeId, p, null);
    const extra = spec.extra ? spec.extra(p) : null;
    const cols = ['org_id', 'store_id', 'code', 'name', 'sort_order', 'is_active', 'note', ...(extra ? extra.cols : [])];
    const vals = [orgId, storeId, code, p.name, p.sortOrder ?? 0, p.isActive === false ? 0 : 1, p.note ?? null, ...(extra ? extra.vals : [])];
    const id = await insert(`INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
    res.status(201).json(spec.mapper(await getRow(`SELECT * FROM ${spec.table} WHERE id=?`, [id])));
  });

  router.put(`/${spec.path}/:id`, requirePermission('settings.edit'), async (req, res) => {
    const p = spec.updateSchema.parse(req.body);
    const { orgId, storeId } = tenant(req);
    const row = await getRow(`SELECT * FROM ${spec.table} WHERE id=? AND org_id=? AND store_id=?`, [req.params.id, orgId, storeId]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (p.code != null && p.code !== '') {
      const dup = await getRow(
        `SELECT id FROM ${spec.table} WHERE org_id=? AND store_id=? AND UPPER(code)=UPPER(?) AND id<>?`,
        [orgId, storeId, p.code, req.params.id],
      );
      if (dup) return res.status(400).json({ error: 'duplicate_code', code: p.code });
    }
    if (spec.beforeWrite) await spec.beforeWrite(orgId, storeId, p, row);
    const sets = [], params = [];
    if (p.code !== undefined && p.code !== '') { sets.push('code=?'); params.push(p.code); }
    if (p.name !== undefined) { sets.push('name=?'); params.push(p.name); }
    if (p.sortOrder !== undefined) { sets.push('sort_order=?'); params.push(p.sortOrder); }
    if (p.isActive !== undefined) { sets.push('is_active=?'); params.push(p.isActive ? 1 : 0); }
    if (p.note !== undefined) { sets.push('note=?'); params.push(p.note); }
    if (spec.extraUpdate) { const e = spec.extraUpdate(p); sets.push(...e.sets); params.push(...e.vals); }
    if (sets.length) {
      params.push(req.params.id, orgId, storeId);
      await query(`UPDATE ${spec.table} SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
    }
    res.json(spec.mapper(await getRow(`SELECT * FROM ${spec.table} WHERE id=?`, [req.params.id])));
  });

  router.put(`/${spec.path}/:id/status`, requirePermission('settings.edit'), async (req, res) => {
    const { orgId, storeId } = tenant(req);
    const row = await getRow(`SELECT * FROM ${spec.table} WHERE id=? AND org_id=? AND store_id=?`, [req.params.id, orgId, storeId]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const next = req.body && req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : (row.is_active ? 0 : 1);
    await query(`UPDATE ${spec.table} SET is_active=? WHERE id=? AND org_id=? AND store_id=?`, [next, req.params.id, orgId, storeId]);
    res.json(spec.mapper(await getRow(`SELECT * FROM ${spec.table} WHERE id=?`, [req.params.id])));
  });

  router.delete(`/${spec.path}/:id`, requirePermission('settings.edit'), async (req, res) => {
    const { orgId, storeId } = tenant(req);
    const row = await getRow(`SELECT * FROM ${spec.table} WHERE id=? AND org_id=? AND store_id=?`, [req.params.id, orgId, storeId]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const type = MASTER_TYPES[spec.path];
    const counts = await masterRefCounts(orgId, storeId, type.refs, row);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    if (total > 0) return res.status(409).json({ error: 'master_in_use', label: type.label, counts, hint: 'set isActive=false instead' });
    await query(`DELETE FROM ${spec.table} WHERE id=? AND org_id=? AND store_id=?`, [req.params.id, orgId, storeId]);
    res.json({ ok: true, deleted: String(req.params.id) });
  });
}

// ===========================================================================
// 产品主档（扁平清单）
// ---------------------------------------------------------------------------
// /tree 是给收银端点单用的层级结构；/products 是给后台「产品主数据」列表用的
// 扁平视图：每个 SKU 一行，并把主分组/打印组/部门/供应商/计量单位的名称解析好。
// 主分组与部门在 SKU 未填写时回落到分类默认值，保证报表口径不因漏填而断裂。
// ===========================================================================
async function loadProductContext(orgId, storeId) {
  const [variants, categories, bases, mainGroups, printGroups, departments, suppliers, uoms] = await Promise.all([
    query('SELECT * FROM menu_variants WHERE org_id=? AND store_id=? ORDER BY sort_order', [orgId, storeId]),
    query('SELECT * FROM menu_categories WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM menu_bases WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM main_groups WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM print_groups WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM departments WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM suppliers WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM uoms WHERE org_id=? AND store_id=?', [orgId, storeId]),
  ]);
  return {
    variants: variants.map(toVariant),
    categories: categories.map(toMenuCategory),
    bases: bases.map(toMenuBase),
    mainGroups: mainGroups.map(toMainGroup),
    printGroups: printGroups.map(toPrintGroup),
    departments: departments.map(toDepartment),
    suppliers: suppliers.map(toSupplier),
    uoms: uoms.map(toUom),
  };
}

router.get('/products', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const all = buildProducts(await loadProductContext(orgId, storeId));
  const rows = all.filter((p) => matchProduct(p, req.query));
  res.json({ rows, total: rows.length, summary: summarizeProducts(all) });
});

// 批量修改:启用/停用、批量归口(主分组/打印组/部门/供应商/计量单位)。
// 字段走白名单,价格与成本这类敏感字段不可批量改。
router.post('/products/bulk', requirePermission('menu.edit'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const { ids, patch, error } = buildBulkPatch(req.body || {});
  if (error) return res.status(400).json({ error });

  const sets = [], params = [];
  if (patch.isActive !== undefined) { sets.push('is_active=?'); params.push(patch.isActive ? 1 : 0); }
  if (patch.mainGroupId !== undefined) { sets.push('main_group_id=?'); params.push(patch.mainGroupId ? Number(patch.mainGroupId) : null); }
  if (patch.printGroupId !== undefined) { sets.push('print_group_id=?'); params.push(patch.printGroupId ? Number(patch.printGroupId) : null); }
  if (patch.departmentId !== undefined) { sets.push('department_id=?'); params.push(patch.departmentId ? Number(patch.departmentId) : null); }
  if (patch.supplierId !== undefined) { sets.push('supplier_id=?'); params.push(patch.supplierId ? Number(patch.supplierId) : null); }
  if (patch.uom !== undefined) { sets.push('uom=?'); params.push(patch.uom || null); }

  const ph = ids.map(() => '?').join(',');
  const r = await query(
    `UPDATE menu_variants SET ${sets.join(',')} WHERE org_id=? AND store_id=? AND id IN (${ph})`,
    [...params, orgId, storeId, ...ids],
  );
  res.json({ ok: true, requested: ids.length, updated: Number(r?.affectedRows ?? ids.length), patch });
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
