// ---------------------------------------------------------------------------
// 计量单位换算 —— 把「卖出去的数量」折算成「库存单位上的数量」
// ---------------------------------------------------------------------------
// 为什么需要:商品主档里 SKU 有 uom(销售单位)和 packUom/packFactor(进货/库存单位)。
// 整箱进货、按罐零售时,卖 3 罐不能从库存里扣 3 箱 —— 这是实打实的账目错误。
// 以前扣减直接写 `stock_qty - qty`,两个单位不同就静默算错。
//
// 换算系数(1 个销售单位 = factor 个库存单位)来源优先级:
//   1) SKU 上的 packFactor —— 语义是「1 packUom = packFactor × uom」,所以 factor = 1/packFactor
//   2) uoms 主数据的 factor 推导 —— factor(uom) / factor(packUom)
//      (factor 的定义是「1 个本单位 = N 个该量纲的基准单位」)
//   3) 拿不到 → factor = 1 且 converted=false,等价于旧行为,**绝不因此报错**
//
// 量纲不一致(如 uom=KG、packUom=BOX)时也不猜,退回 factor=1 并给出 mismatch 原因,
// 由商品主档界面提示,而不是让库存悄悄算错。
//
// 本模块与存储无关,devMode(内存)与 routes(MySQL)共用同一份。

const num = (v) => Number(v || 0);
const r3 = (v) => Math.round(num(v) * 1000) / 1000;

/** 单位编码统一成大写去空白;空值返回 null。 */
export function normCode(code) {
  const s = String(code == null ? '' : code).trim().toUpperCase();
  return s || null;
}

/** 在 uoms 主数据里按编码找单位(大小写不敏感)。 */
export function findUom(uoms, code) {
  const c = normCode(code);
  if (!c) return null;
  return (uoms || []).find((u) => normCode(u.code) === c) || null;
}

/** 单位换算系数;单位不存在返回 null(区别于「系数恰好是 1」)。 */
export function uomFactor(uoms, code) {
  const u = findUom(uoms, code);
  if (!u) return null;
  const f = num(u.factor);
  return f > 0 ? f : null;
}

/**
 * 任意两个单位之间的换算。
 * @returns {{qty:number, factor:number, ok:boolean, reason:string}}
 */
export function convertQty(qty, from, to, uoms) {
  const a = normCode(from);
  const b = normCode(to);
  if (!a || !b || a === b) return { qty: r3(qty), factor: 1, ok: true, reason: 'same_uom' };
  const ua = findUom(uoms, a);
  const ub = findUom(uoms, b);
  if (!ua || !ub) return { qty: r3(qty), factor: 1, ok: false, reason: 'unknown_uom' };
  if ((ua.dimension || 'count') !== (ub.dimension || 'count')) {
    return { qty: r3(qty), factor: 1, ok: false, reason: 'dimension_mismatch' };
  }
  const fa = uomFactor(uoms, a);
  const fb = uomFactor(uoms, b);
  if (!fa || !fb) return { qty: r3(qty), factor: 1, ok: false, reason: 'unknown_uom' };
  const factor = fa / fb;
  return { qty: r3(num(qty) * factor), factor, ok: true, reason: 'uom_factor' };
}

/**
 * 解析一个 SKU 的「销售单位 → 库存单位」换算。
 * @returns {{sellUom:string|null, stockUom:string|null, factor:number,
 *            converted:boolean, reason:string}}
 *   converted=false 表示不需要/无法换算,factor 恒为 1。
 */
export function resolveVariantStock(variant, uoms) {
  const v = variant || {};
  const sellUom = normCode(v.uom);
  const stockUom = normCode(v.packUom) || sellUom;

  if (!sellUom || !stockUom || sellUom === stockUom) {
    return { sellUom, stockUom, factor: 1, converted: false, reason: sellUom ? 'same_uom' : 'no_uom' };
  }

  // 1) SKU 自己声明的包装换算。packFactor 恰好为 1 视为「没填」——
  //    列默认值就是 1,若当真则等于声称 1 箱 = 1 罐,不如回落到主数据推导。
  const pf = num(v.packFactor);
  if (pf > 0 && pf !== 1) {
    return { sellUom, stockUom, factor: 1 / pf, converted: true, reason: 'pack_factor' };
  }

  // 2) 用主数据的量纲与系数推导
  const ua = findUom(uoms, sellUom);
  const ub = findUom(uoms, stockUom);
  if (ua && ub) {
    if ((ua.dimension || 'count') !== (ub.dimension || 'count')) {
      return { sellUom, stockUom, factor: 1, converted: false, reason: 'dimension_mismatch' };
    }
    const fa = uomFactor(uoms, sellUom);
    const fb = uomFactor(uoms, stockUom);
    if (fa && fb) {
      const factor = fa / fb;
      return {
        sellUom, stockUom, factor,
        converted: Math.abs(factor - 1) > 1e-9,
        reason: Math.abs(factor - 1) > 1e-9 ? 'uom_factor' : 'same_scale',
      };
    }
  }

  // 3) 单位没登记在主数据里 —— 不猜,退回 1:1
  return { sellUom, stockUom, factor: 1, converted: false, reason: 'unknown_uom' };
}

/**
 * 卖 qty 个销售单位,应该从库存里扣多少(库存单位)。
 * @returns {{sellQty:number, stockQty:number, factor:number, converted:boolean,
 *            sellUom:string|null, stockUom:string|null, reason:string}}
 */
export function stockDeltaForSale(variant, qty, uoms) {
  const conv = resolveVariantStock(variant, uoms);
  return { ...conv, sellQty: r3(qty), stockQty: r3(num(qty) * conv.factor) };
}

/** 展示用:把换算说成一句话,给商品主档界面用。 */
export function describeConversion(conv) {
  if (!conv) return '';
  if (!conv.converted) return '';
  const per = conv.factor > 0 ? Math.round((1 / conv.factor) * 1000) / 1000 : 0;
  return `1 ${conv.stockUom} = ${per} ${conv.sellUom}`;
}

/**
 * 回补库存时应该加回多少 —— 优先用结账时写回订单行的 stockQty。
 *
 * 为什么不在退款时重新算:结账之后管理员可能改了商品的包装系数,
 * 按新系数回补会与当初扣掉的数不一致,库存会悄悄漂移。
 * 所以扣减时把结果写回订单行,回补时直接复用同一份数字。
 */
export function stockQtyOfItem(item, variant, uoms) {
  const stored = item && item.stockQty;
  if (stored != null && stored !== '' && Number.isFinite(Number(stored))) return r3(stored);
  return stockDeltaForSale(variant, item && item.qty, uoms).stockQty;
}
