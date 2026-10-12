// ---------------------------------------------------------------------------
// Smcin 产品主档:把「变体 + 分类 + 基底 + 主数据 + 供应商」拼成一张扁平清单
// ---------------------------------------------------------------------------
// 与 masterData.js 同样思路:两个后端只负责把各自的集合取出来(内存数组 /
// SQL 结果),「怎么拼名字」「怎么过滤」「批量改哪些字段合法」这些规则只有一份。
//
// 关键口径:主分组 / 部门在 SKU 上没填时,**回落到所属分类的默认值**。
// 这样老商品即使没逐个归口,报表口径依然完整;后台用 *Inherited 标记提示
// 「这是继承来的,不是这个 SKU 自己设的」。
//
// 同时把「销售单位 → 库存单位」的换算与价格覆盖行数一并算好,让后台清单、
// 报表、收银端三处看到的是同一个口径。

import { resolveVariantStock } from './uomConvert.js';

const byId = (rows) => {
  const m = new Map();
  for (const r of rows || []) if (r && r.id != null) m.set(String(r.id), r);
  return m;
};
const byCode = (rows) => {
  const m = new Map();
  for (const r of rows || []) if (r && r.code) m.set(String(r.code).toUpperCase(), r);
  return m;
};
const nameOf = (m, id) => (id == null || id === '' ? null : (m.get(String(id))?.name ?? null));
const codeOf = (m, id) => (id == null || id === '' ? null : (m.get(String(id))?.code ?? null));
const uomNameOf = (m, code) => (code ? (m.get(String(code).toUpperCase())?.name ?? null) : null);

/**
 * 把原始集合拼成扁平产品主档。
 * @param {{variants:any[],categories:any[],bases:any[],mainGroups:any[],
 *          printGroups:any[],departments:any[],suppliers:any[],uoms:any[]}} ctx
 */
export function buildProducts(ctx = {}) {
  const catMap = byId(ctx.categories);
  const baseMap = byId(ctx.bases);
  const mgMap = byId(ctx.mainGroups);
  const pgMap = byId(ctx.printGroups);
  const dpMap = byId(ctx.departments);
  const spMap = byId(ctx.suppliers);
  const uomMap = byCode(ctx.uoms);

  // 每个 SKU 有几个非默认价格级别的覆盖行 —— 后台用它标「有专属价目」
  const priceCount = new Map();
  for (const p of ctx.variantPrices || []) {
    if (!p || p.variantId == null) continue;
    const k = String(p.variantId);
    priceCount.set(k, (priceCount.get(k) || 0) + 1);
  }

  return (ctx.variants || []).map((v) => {
    const c = catMap.get(String(v.categoryId)) || {};
    const b = baseMap.get(String(v.baseId)) || {};

    // 有效主分组/部门 = SKU 自己的值,没有则继承分类默认
    const mgOwn = v.mainGroupId == null || v.mainGroupId === '';
    const dpOwn = v.departmentId == null || v.departmentId === '';
    const mgId = mgOwn ? (c.mainGroupId ?? null) : v.mainGroupId;
    const dpId = dpOwn ? (c.departmentId ?? null) : v.departmentId;
    const pgId = v.printGroupId == null || v.printGroupId === '' ? null : v.printGroupId;
    const spId = v.supplierId == null || v.supplierId === '' ? null : v.supplierId;

    // 销售单位 → 库存单位换算(整箱进货、按罐零售)
    const conv = resolveVariantStock(v, ctx.uoms);

    return {
      id: v.id,
      code: v.code,
      name: v.name,
      barcode: v.barcode || null,
      // 归属
      categoryId: v.categoryId == null ? null : String(v.categoryId),
      categoryName: c.name || null,
      baseId: v.baseId == null ? null : String(v.baseId),
      baseName: b.name || null,
      // 主分组(有效值 + 是否继承)
      mainGroupId: mgId == null ? null : String(mgId),
      mainGroupCode: codeOf(mgMap, mgId),
      mainGroupName: nameOf(mgMap, mgId),
      mainGroupInherited: mgOwn && mgId != null,
      // 打印分组
      printGroupId: pgId == null ? null : String(pgId),
      printGroupCode: codeOf(pgMap, pgId),
      printGroupName: nameOf(pgMap, pgId),
      // 部门(有效值 + 是否继承)
      departmentId: dpId == null ? null : String(dpId),
      departmentCode: codeOf(dpMap, dpId),
      departmentName: nameOf(dpMap, dpId),
      departmentInherited: dpOwn && dpId != null,
      // 供应商
      supplierId: spId == null ? null : String(spId),
      supplierName: nameOf(spMap, spId),
      // 计量单位
      uom: v.uom || null,
      uomName: uomNameOf(uomMap, v.uom),
      packUom: v.packUom || null,
      packUomName: uomNameOf(uomMap, v.packUom),
      packFactor: Number(v.packFactor == null ? 1 : v.packFactor),
      // 换算结果:库存以 stockUom 计数,卖 1 个 uom 扣 factor 个 stockUom。
      // unitsPerStock = 1 个库存单位等于多少个销售单位(给「1 箱 = 24 罐」这类展示用)。
      stockUom: conv.stockUom,
      stockUomName: uomNameOf(uomMap, conv.stockUom),
      uomFactor: conv.factor,
      uomConverted: conv.converted,
      uomConvertReason: conv.reason,
      unitsPerStock: conv.converted && conv.factor > 0 ? Math.round((1 / conv.factor) * 1000) / 1000 : 1,
      // 价格覆盖行数:0 = 各价格级别都回落基础价
      priceLevelCount: priceCount.get(String(v.id)) || 0,
      // 价格与库存
      price: Number(v.price || 0),
      cost: Number(v.cost || 0),
      stockQty: Number(v.stockQty || 0),
      stockThreshold: Number(v.stockThreshold || 0),
      // 其他
      sortOrder: v.sortOrder == null ? null : Number(v.sortOrder),
      isActive: !!v.isActive,
    };
  });
}

/** 支持的过滤条件(全部来自 query string) */
export const PRODUCT_FILTERS = [
  'q', 'categoryId', 'mainGroupId', 'printGroupId', 'departmentId',
  'supplierId', 'uom', 'active', 'unassigned', 'converted',
];

const eq = (a, b) => (a == null ? b == null : String(a) === String(b));

/** 单行是否命中过滤条件。filters 为 query 对象(字符串值)。 */
export function matchProduct(p, filters = {}) {
  const f = filters;
  if (f.q) {
    const q = String(f.q).trim().toLowerCase();
    if (q) {
      const hay = `${p.code || ''} ${p.name || ''} ${p.barcode || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  if (f.categoryId && !eq(p.categoryId, f.categoryId)) return false;
  if (f.mainGroupId && !eq(p.mainGroupId, f.mainGroupId)) return false;
  if (f.printGroupId && !eq(p.printGroupId, f.printGroupId)) return false;
  if (f.departmentId && !eq(p.departmentId, f.departmentId)) return false;
  if (f.supplierId && !eq(p.supplierId, f.supplierId)) return false;
  if (f.uom && String(p.uom || '').toUpperCase() !== String(f.uom).toUpperCase()) return false;
  if (f.active === '1' && !p.isActive) return false;
  if (f.active === '0' && p.isActive) return false;
  // 「未归口」:主分组或部门缺一,用于后台快速找出还没分类的商品
  if (f.unassigned === '1' && p.mainGroupId != null && p.departmentId != null) return false;
  // 「需要单位换算」:销售单位 ≠ 库存单位,卖出时按系数折算
  if (f.converted === '1' && !p.uomConverted) return false;
  return true;
}

/** KPI 汇总:给后台清单顶部的指标条用。 */
export function summarizeProducts(rows = []) {
  let active = 0, inactive = 0, withSupplier = 0, missingUom = 0, unassigned = 0, convertedUom = 0, withPriceLevels = 0;
  for (const p of rows) {
    if (p.isActive) active += 1; else inactive += 1;
    if (p.supplierId != null) withSupplier += 1;
    if (!p.uom) missingUom += 1;
    if (p.mainGroupId == null || p.departmentId == null) unassigned += 1;
    if (p.uomConverted) convertedUom += 1;
    if (p.priceLevelCount > 0) withPriceLevels += 1;
  }
  return { total: rows.length, active, inactive, withSupplier, missingUom, unassigned, convertedUom, withPriceLevels };
}

/** 批量修改允许触碰的字段 —— 白名单,避免误改价格/成本等敏感字段 */
export const PRODUCT_BULK_FIELDS = ['isActive', 'mainGroupId', 'printGroupId', 'departmentId', 'supplierId', 'uom'];
export const PRODUCT_BULK_MAX = 500;

/**
 * 校验并归一化批量修改请求。
 * @returns {{ids:string[],patch:object}|{error:string}}
 */
export function buildBulkPatch(body = {}) {
  const raw = Array.isArray(body.ids) ? body.ids : [];
  const ids = [...new Set(raw.map((x) => String(x)).filter((x) => x !== '' && x !== 'null' && x !== 'undefined'))];
  if (!ids.length) return { error: 'no_ids' };
  if (ids.length > PRODUCT_BULK_MAX) return { error: 'too_many_ids' };

  const src = body.patch && typeof body.patch === 'object' ? body.patch : body;
  const patch = {};
  if (src.isActive !== undefined) patch.isActive = !!src.isActive;
  for (const f of ['mainGroupId', 'printGroupId', 'departmentId', 'supplierId']) {
    if (src[f] !== undefined) patch[f] = src[f] === '' || src[f] === null ? null : String(src[f]);
  }
  if (src.uom !== undefined) patch.uom = src.uom ? String(src.uom) : null;
  if (!Object.keys(patch).length) return { error: 'no_fields' };
  return { ids, patch };
}
