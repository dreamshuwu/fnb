// ---------------------------------------------------------------------------
// 价目(价格级别)解析 —— 服务端定价的唯一入口
// ---------------------------------------------------------------------------
// 核心不变量:**`menu_variants.price` 永远等于默认价格级别的价格**。
// 非默认级别只在 variant_prices 里存覆盖行;没有覆盖行 = 回落基础价。
// 这样做的理由:
//   - 收据、报表、小票、库存成本全都只读 variant.price,不必到处加分支
//   - 只有一个价格真源,不会出现「改了一处、另一处还是旧价」
//   - 删除/停用某个价格级别不会让商品失去价格
//
// 本模块与存储无关,devMode(内存)与 routes(MySQL)共用同一份。

const num = (v) => Number(v || 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;

export function normCode(code) {
  const s = String(code == null ? '' : code).trim().toUpperCase();
  return s || null;
}

/** 默认价格级别:优先 isDefault 标记,其次取排序最靠前的,最后取第一行。 */
export function pickDefaultLevel(levels = []) {
  const list = (levels || []).filter(Boolean);
  if (!list.length) return null;
  const flagged = list.find((l) => l.isDefault);
  if (flagged) return flagged;
  const sorted = [...list].sort((a, b) => (num(a.sortOrder) - num(b.sortOrder)) || (String(a.id) - String(b.id)));
  return sorted[0] || null;
}

/** 默认级别的编码;没有任何级别时返回 null。 */
export function defaultLevelCode(levels = []) {
  const d = pickDefaultLevel(levels);
  return d ? normCode(d.code) : null;
}

export function findLevel(levels, code) {
  const c = normCode(code);
  if (!c) return null;
  return (levels || []).find((l) => normCode(l.code) === c) || null;
}

/** 价格覆盖行 -> Map(`variantId::LEVEL` -> price)。 */
export function buildPriceMap(variantPrices = []) {
  const m = new Map();
  for (const p of variantPrices || []) {
    if (!p || p.variantId == null) continue;
    const key = `${String(p.variantId)}::${normCode(p.levelCode) || ''}`;
    m.set(key, num(p.price));
  }
  return m;
}

/**
 * 解析某个 SKU 在指定价格级别下的售价。
 * @param variant 变体(至少要有 id / price)
 * @param levelCode 目标级别编码;空/未知/等于默认级别 → 用基础价
 * @param priceMap buildPriceMap 的产物
 * @param levels 价格级别主数据(用于判断哪个是默认级别)
 * @returns {{variantId:string, levelCode:string|null, basePrice:number,
 *            price:number, source:'level'|'base'|'unknown_level'}}
 *   source='level' 表示用了覆盖行;'base' 表示回落基础价;
 *   'unknown_level' 表示传入的级别不存在(已回落基础价,便于前端提示)。
 */
export function resolveVariantPrice(variant, levelCode, priceMap, levels = []) {
  const v = variant || {};
  const basePrice = r2(v.price);
  const want = normCode(levelCode);
  const def = defaultLevelCode(levels);
  const out = { variantId: v.id == null ? null : String(v.id), levelCode: want, basePrice, price: basePrice, source: 'base' };
  if (!want) return { ...out, levelCode: def };
  const known = findLevel(levels, want);
  if (!known) return { ...out, levelCode: def, source: 'unknown_level' };
  if (def && want === def) return out;
  const key = `${String(v.id)}::${want}`;
  if (priceMap && priceMap.has(key)) {
    return { ...out, price: r2(priceMap.get(key)), source: 'level' };
  }
  return out;
}

/**
 * SKU × 价格级别 的完整价目矩阵(后台「价格矩阵」界面用)。
 * 每一格都带 source,前端可直接把「继承/回落基础价」的格子画淡一点。
 */
export function buildPriceMatrix(products = [], levels = [], variantPrices = []) {
  const priceMap = buildPriceMap(variantPrices);
  const list = (levels || []).filter(Boolean);
  const def = defaultLevelCode(list);
  return (products || []).map((p) => {
    const cells = {};
    for (const lv of list) {
      const code = normCode(lv.code);
      const r = resolveVariantPrice(p, code, priceMap, list);
      cells[code] = { price: r.price, source: r.source, isDefault: code === def };
    }
    return {
      variantId: p.id == null ? null : String(p.id),
      code: p.code || null,
      name: p.name || null,
      categoryId: p.categoryId ?? null,
      categoryName: p.categoryName || null,
      basePrice: r2(p.price),
      cost: r2(p.cost),
      isActive: !!p.isActive,
      defaultLevelCode: def,
      cells,
    };
  });
}

/** 价格矩阵的 KPI:有多少格用了覆盖价、多少格在回落基础价。 */
export function summarizePrices(products = [], levels = [], variantPrices = []) {
  const list = (levels || []).filter(Boolean);
  const def = defaultLevelCode(list);
  const priceMap = buildPriceMap(variantPrices);
  const byLevel = {};
  let overrides = 0;
  let fallbacks = 0;
  for (const lv of list) byLevel[normCode(lv.code)] = { overrides: 0, fallbacks: 0, isDefault: normCode(lv.code) === def };
  for (const p of products || []) {
    for (const lv of list) {
      const code = normCode(lv.code);
      const r = resolveVariantPrice(p, code, priceMap, list);
      if (r.source === 'level') { overrides += 1; byLevel[code].overrides += 1; }
      else { fallbacks += 1; byLevel[code].fallbacks += 1; }
    }
  }
  return {
    levels: list.length,
    variants: (products || []).length,
    overrides,
    fallbacks,
    overrideRows: (variantPrices || []).length,
    byLevel,
  };
}

/**
 * 结账/开单定价:按价格级别把订单行的单价重算一遍。
 *
 * 只重算**能解析到真实变体**的行 —— Open Item(自定义名+自定义价)之类
 * 没有 variantId 的行必须保留客户端传的价,否则收银员就开不出临时商品了。
 *
 * @returns {{items:any[], changed:number, unknownLevel:boolean, levelCode:string|null}}
 */
export function applyLevelToItems(items = [], variantById, { levelCode, priceMap, levels } = {}) {
  const def = defaultLevelCode(levels);
  const want = normCode(levelCode);
  const levelKnown = !want || !!findLevel(levels, want);
  const effective = want && levelKnown ? want : def;
  let changed = 0;
  const out = (items || []).map((it) => {
    const vid = it.variantId || it.itemId;
    const v = vid == null || !variantById ? null : variantById.get(String(vid));
    if (!v) return { ...it, priceLevel: effective, priceSource: 'manual' };
    const r = resolveVariantPrice(v, effective, priceMap, levels);
    if (num(it.unitPrice) !== r.price) changed += 1;
    return { ...it, unitPrice: r.price, priceLevel: r.levelCode || effective, priceSource: r.source, basePrice: r.basePrice };
  });
  return { items: out, changed, unknownLevel: !levelKnown, levelCode: effective };
}
