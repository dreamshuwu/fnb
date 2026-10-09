// ---------------------------------------------------------------------------
// Smcin 主数据(商品大类 / 打印分组 / 部门 / 计量单位)的共享规则
// ---------------------------------------------------------------------------
// 两个后端(devMode 内存 / routes/menu.js MySQL)各自提供存储实现,但
// 「编码怎么生成」「哪些引用会阻止删除」这类规则必须只有一份 ——
// 否则预览里能删、生产里删不掉(或反过来),这类漂移最难查。
//
// 引用用「集合名 + 字段名」描述(领域语言),由各后端翻译成
// 内存数组属性 / MySQL 表列,这样规则本身与存储无关。

export const MASTER_TYPES = {
  'main-groups': {
    label: 'Main Group',
    refs: [
      { collection: 'categories', field: 'mainGroupId' },
      { collection: 'variants', field: 'mainGroupId' },
    ],
  },
  'print-groups': {
    label: 'Print Group',
    refs: [{ collection: 'variants', field: 'printGroupId' }],
  },
  departments: {
    label: 'Department',
    refs: [
      { collection: 'categories', field: 'departmentId' },
      { collection: 'variants', field: 'departmentId' },
    ],
  },
  uoms: {
    label: 'UOM',
    // 商品上的 uom / packUom 存的是单位**编码**而不是 id
    refs: [
      { collection: 'variants', field: 'uom', byCode: true },
      { collection: 'variants', field: 'packUom', byCode: true },
    ],
  },
};

export const MASTER_PATHS = Object.keys(MASTER_TYPES);

/** 由名称派生编码:大写、非字母数字转 -、截 24 位;重复则追加 -2/-3… */
export function makeMasterCode(name, existing = []) {
  const base = String(name || 'CODE').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'CODE';
  if (!existing.some((c) => String(c).toUpperCase() === base)) return base;
  let i = 2;
  while (existing.some((c) => String(c).toUpperCase() === `${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/** 编码查重(大小写不敏感);excludeId 用于更新时排除自己。 */
export function isDuplicateCode(rows, code, excludeId = null) {
  const target = String(code || '').toUpperCase();
  return rows.some((r) => String(r.code || '').toUpperCase() === target && String(r.id) !== String(excludeId));
}

/**
 * 统计引用数:删除主数据前先看有没有分类/商品在用,避免留下悬空引用。
 * @param {{[collection: string]: any[]}} collections 例:{ categories: [...], variants: [...] }
 */
export function countRefs(collections, refs, row) {
  const counts = {};
  for (const r of refs) {
    const val = r.byCode ? row.code : row.id;
    if (val == null) continue;
    const n = (collections[r.collection] || []).filter((x) => {
      const v = x[r.field];
      return v != null && String(v) === String(val);
    }).length;
    if (n) counts[`${r.collection}.${r.field}`] = n;
  }
  return counts;
}

/**
 * 每个量纲只能有一个基准单位。写入前把同量纲其它单位降级,
 * 并把基准单位自己的换算系数拉回 1(否则「基准」就没有意义)。
 * @returns {{ clearOthers: string|null, forceFactorOne: boolean }}
 */
export function baseUnitRule(payload, existing) {
  const isBase = payload.isBase !== undefined ? !!payload.isBase : !!(existing && existing.isBase);
  if (!isBase) return { clearOthers: null, forceFactorOne: false };
  const dimension = payload.dimension || (existing && existing.dimension) || 'count';
  return { clearOthers: dimension, forceFactorOne: true };
}
