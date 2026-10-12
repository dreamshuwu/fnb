// 期间引擎:期间预设解析 / 粒度分桶 / 环比·同比对齐 / 指标对比。
//
// 为什么要单独成一个模块:期间对比的口径最容易前后端各算一套 —— 前端算「本月 1 号到今天」、
// 后端算「本月 1 号到月末」,界面上看到的增幅和导出的 CSV 就对不上。这里把期间解析、
// 分桶、上期推导全部收敛成纯函数,reportEngine、两个后端(devMode / routes)与前端共用,
// 保证「屏幕上看到的」与「导出文件里的」永远是同一份数字。
//
// 设计约定:
// - 所有日期字符串统一用本地日期 'YYYY-MM-DD',与 reportEngine 的 dayKey(ISO 前 10 位)口径一致。
// - 周以**周一**为一周之首(马来西亚/新加坡惯例)。
// - 环比(prev)对「本X」这类进行中的期间采用**同期对齐**:本月 1~13 号对上月 1~13 号,
//   而不是「紧邻的等长前窗」—— 后者会把上月 18~30 号拿来比,受月中促销影响严重误判。
//   对 today / yesterday / 自定义区间这类没有日历锚点的期间,才退回等长前窗。
// - 同比(yoy)把整个窗口整体前移一年,2/29 这类不存在的日期向前夹取。

const MS_DAY = 86400000;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Date → 'YYYY-MM-DD'(本地时区,不走 toISOString 以免被 UTC 偏移带跑)。 */
export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 'YYYY-MM-DD' 或 ISO 字符串 → 本地零点 Date;无法解析返回 null。 */
export function parseYmd(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO 时间戳 → 本地日期键(与 reportEngine.dayKey 同口径)。 */
export const dayKeyOf = (iso) => String(iso || '').slice(0, 10);

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((b - a) / MS_DAY);
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7)); // 周一
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);
/** 某粒度所在的完整日历区间末日(用于判定「这一期是否已经走完」)。 */
const endOfUnit = (kind, d) => {
  if (kind === 'week') return addDays(startOfWeek(d), 6);
  if (kind === 'quarter') return endOfMonth(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 2, 1));
  if (kind === 'year') return new Date(d.getFullYear(), 11, 31);
  if (kind === 'month') return endOfMonth(d);
  return d;
};

/**
 * 自定义区间推断日历锚点。
 * 用户手选 3/1~3/31 时,期望的上期是「整个 2 月」而不是「紧邻的 31 天(1/29~2/28)」;
 * 手选 10/1~10/13 时期望「上月 1~13 号」。所以只要起点落在某个日历单元的起始日、
 * 且终点没跨出该单元,就按那个单元对齐。
 */
function inferAnchorKind(from, to) {
  const same = (a, b) => a.getTime() === b.getTime();
  if (same(from, startOfWeek(from)) && same(to, addDays(from, 6))) return 'week';
  if (same(from, startOfMonth(from)) && to <= endOfMonth(from)) return 'month';
  if (same(from, startOfQuarter(from)) && to <= endOfUnit('quarter', from)) return 'quarter';
  if (same(from, startOfYear(from)) && to <= endOfUnit('year', from)) return 'year';
  return 'custom';
}

/** 上个月的同一天(用于「上月同期」),超出该月长度则夹到月末。 */
const sameDayPrevMonth = (d, back = 1) => {
  const y = d.getFullYear();
  const m = d.getMonth() - back;
  const base = new Date(y, m, 1);
  const last = endOfMonth(base).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(d.getDate(), last));
};

// ------------------------------------------------------------------ 元数据

export const PERIOD_PRESETS = [
  { key: 'today', label: 'Today 今天', kind: 'day' },
  { key: 'yesterday', label: 'Yesterday 昨天', kind: 'day' },
  { key: 'this_week', label: 'This Week 本周', kind: 'week' },
  { key: 'last_week', label: 'Last Week 上周', kind: 'week' },
  { key: 'this_month', label: 'This Month 本月', kind: 'month' },
  { key: 'last_month', label: 'Last Month 上月', kind: 'month' },
  { key: 'this_quarter', label: 'This Quarter 本季', kind: 'quarter' },
  { key: 'last_quarter', label: 'Last Quarter 上季', kind: 'quarter' },
  { key: 'this_year', label: 'This Year 本年', kind: 'year' },
  { key: 'last_year', label: 'Last Year 去年', kind: 'year' },
  { key: 'custom', label: 'Custom 自定义', kind: 'custom' },
];

export const GRAINS = [
  { key: 'day', label: 'Day 日' },
  { key: 'week', label: 'Week 周' },
  { key: 'month', label: 'Month 月' },
];

export const COMPARE_MODES = [
  { key: 'prev', label: 'Previous Period 环比' },
  { key: 'yoy', label: 'Same Period Last Year 同比' },
];

/** 对比指标定义。inverse:该指标上升未必是好事(折扣),前端据此换用中性配色。 */
export const METRICS = [
  { key: 'net', label: 'Net Sales 净销售', kind: 'money' },
  { key: 'gross', label: 'Gross Sales 毛销售', kind: 'money' },
  { key: 'discount', label: 'Discount 折扣', kind: 'money', inverse: true },
  { key: 'serviceCharge', label: 'Service Charge 服务费', kind: 'money' },
  { key: 'tax', label: 'GST 税务', kind: 'money' },
  { key: 'orders', label: 'Orders 订单数', kind: 'int' },
  { key: 'items', label: 'Items Sold 销量', kind: 'int' },
  { key: 'avgSpend', label: 'Avg / Order 客单价', kind: 'money' },
];

export const PERIOD_PRESET_KEYS = PERIOD_PRESETS.map((p) => p.key);
export const GRAIN_KEYS = GRAINS.map((g) => g.key);
export const COMPARE_KEYS = COMPARE_MODES.map((c) => c.key);

/** 分桶数量上限:纯粹是防御性硬顶(避免「十年 × 按天」把接口拖垮)。
 *  正常默认粒度由 defaultGrain 决定,用户显式选的粒度在合理范围内一律尊重。 */
const MAX_BUCKETS = 1000;

// ------------------------------------------------------------------ 期间解析

/** 按天数挑一个合适的默认粒度(用户没显式指定时用)。 */
export function defaultGrain(days) {
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

/** 把用户给的粒度收敛到「不会炸」的粒度。 */
export function effectiveGrain(from, to, grain) {
  const s = parseYmd(from);
  const e = parseYmd(to);
  if (!s || !e || e < s) return 'day';
  const days = daysBetween(s, e) + 1;
  const wanted = GRAIN_KEYS.includes(grain) ? grain : defaultGrain(days);
  // 只在真的会炸的时候才粗化;一年按天(365 桶)是用户明确选择,照做。
  if (wanted === 'day' && days > MAX_BUCKETS) return 'month';
  if (wanted === 'week' && days / 7 > MAX_BUCKETS) return 'month';
  return wanted;
}

/**
 * 解析期间预设。
 * @param {string} preset 见 PERIOD_PRESETS
 * @param {{anchor?:string, from?:string, to?:string, grain?:string}} opts
 * @returns {{key,label,from,to,days,anchorKind,grain}}
 */
export function resolvePeriod(preset = 'this_month', opts = {}) {
  const anchor = parseYmd(opts.anchor) || parseYmd(ymd(new Date()));
  const key = PERIOD_PRESET_KEYS.includes(preset) ? preset : 'custom';
  const def = PERIOD_PRESETS.find((p) => p.key === key);
  let from;
  let to;
  let anchorKind = def.kind;

  switch (key) {
    case 'today': from = anchor; to = anchor; break;
    case 'yesterday': from = addDays(anchor, -1); to = from; break;
    case 'this_week': from = startOfWeek(anchor); to = anchor; break;
    case 'last_week': { const s = addDays(startOfWeek(anchor), -7); from = s; to = addDays(s, 6); break; }
    case 'this_month': from = startOfMonth(anchor); to = anchor; break;
    case 'last_month': { const s = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1); from = s; to = endOfMonth(s); break; }
    case 'this_quarter': from = startOfQuarter(anchor); to = anchor; break;
    case 'last_quarter': { const s = new Date(anchor.getFullYear(), anchor.getMonth() - 3, 1); from = s; to = endOfMonth(new Date(s.getFullYear(), s.getMonth() + 2, 1)); break; }
    case 'this_year': from = startOfYear(anchor); to = anchor; break;
    case 'last_year': from = new Date(anchor.getFullYear() - 1, 0, 1); to = new Date(anchor.getFullYear() - 1, 11, 31); break;
    default: {
      from = parseYmd(opts.from) || startOfMonth(anchor);
      to = parseYmd(opts.to) || anchor;
      // 自定义区间也推断日历锚点,否则「3/1~3/31」的上期会被算成紧邻的 31 天。
      anchorKind = inferAnchorKind(from, to);
    }
  }
  if (to < from) { const t = from; from = to; to = t; }
  const days = daysBetween(from, to) + 1;
  // 两个容易混的标记,分开算才不会互相污染:
  //
  // complete —— 这一期是否已经走完**整个日历单元**。决定「上期怎么取」:
  //   走完了(9 月整月)→ 上期取完整的 8 月;还在进行中(本月 1~13 号)→ 上期取上月 1~13 号。
  //   判定基准是 anchor(而不是 to >= unitEnd):今天虽然就是「日」这个日历单元,
  //   但它还没过完,用 to >= unitEnd 会算成 true,于是「今天」被标成「完整期间」。
  //
  // final —— 本期数据是否已经**定稿**。决定界面上显示「完整期间」还是「进行中」。
  //   基准是「末日早于今天」:今天还在营业,今天的营业额还会涨。
  //   两者只在自定义的「过去子区间」上分道扬镳(如 9/5~9/9):数据早已定稿(final),
  //   但它不是一个完整日历单元,上期仍按等长前窗取(complete 为 false)。
  //   complete 为 true 一定蕴含 final 为 true —— 单元都走完了,数据当然定稿。
  const anchorKey = ymd(anchor);
  const unitEnd = anchorKind === 'custom' ? null : endOfUnit(anchorKind, from);
  const complete = !!unitEnd && ymd(unitEnd) < anchorKey;
  const final = ymd(to) < anchorKey;
  return {
    key,
    label: def.label,
    from: ymd(from),
    to: ymd(to),
    days,
    anchorKind,
    complete,
    final,
    grain: effectiveGrain(ymd(from), ymd(to), opts.grain),
  };
}

/**
 * 环比上期。
 * - 该期间**已走完**(上月 / 上周 / 上季 / 去年,或自定义的完整日历区间)
 *   → 上期取「完整上一期」(9/1~9/30 ↔ 8/1~8/31);
 * - 该期间**还在进行中**(本月 1~13 号)
 *   → 上期取「上一期的相同天数」(10/1~10/13 ↔ 9/1~9/13),不受月中促销干扰;
 * - 无日历锚点(today / yesterday / 任意自定义区间) → 紧邻的等长前窗。
 */
export function prevPeriod(p) {
  const from = parseYmd(p.from);
  const to = parseYmd(p.to);
  const days = p.days;
  let s;
  let e;
  if (p.anchorKind === 'week') {
    s = addDays(startOfWeek(from), -7);
    e = p.complete ? addDays(s, 6) : addDays(s, days - 1);
  } else if (p.anchorKind === 'month') {
    s = p.complete ? new Date(from.getFullYear(), from.getMonth() - 1, 1) : sameDayPrevMonth(from);
    e = p.complete ? endOfMonth(s) : addDays(s, days - 1);
    const cap = endOfMonth(s);
    if (e > cap) e = cap;
  } else if (p.anchorKind === 'quarter') {
    const qStart = new Date(from.getFullYear(), from.getMonth() - 3, from.getDate());
    s = p.complete ? new Date(from.getFullYear(), from.getMonth() - 3, 1) : qStart;
    const cap = endOfUnit('quarter', s);
    e = p.complete ? cap : addDays(s, days - 1);
    if (e > cap) e = cap;
  } else if (p.anchorKind === 'year') {
    const yStart = new Date(from.getFullYear() - 1, from.getMonth(), from.getDate());
    s = p.complete ? new Date(from.getFullYear() - 1, 0, 1) : yStart;
    e = p.complete ? new Date(from.getFullYear() - 1, 11, 31) : addDays(s, days - 1);
  } else {
    e = addDays(from, -1);
    s = addDays(e, -(days - 1));
  }
  return { ...p, key: 'prev', label: 'Previous Period 上期', from: ymd(s), to: ymd(e), days: daysBetween(s, e) + 1, complete: true, final: ymd(e) < ymd(new Date()) };
}

/** 同比:整体前移一年;2/29 落到平年时夹到 2/28。 */
export function yoyPeriod(p) {
  const shift = (d) => {
    const y = d.getFullYear() - 1;
    const m = d.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last));
  };
  const s = shift(parseYmd(p.from));
  const e = shift(parseYmd(p.to));
  // 去年同期永远是「已经走完」的窗口,标记 complete 以免再被当成进行中期间二次对齐。
  // final 仍按真实日历判定:本期若是一段未来区间,「去年同期」也可能还没走完。
  return { ...p, key: 'yoy', label: 'Same Period Last Year 去年同期', from: ymd(s), to: ymd(e), days: daysBetween(s, e) + 1, complete: true, final: ymd(e) < ymd(new Date()) };
}

/** 按模式推导对比期间。 */
export function comparePeriod(p, mode = 'prev') {
  return mode === 'yoy' ? yoyPeriod(p) : prevPeriod(p);
}

// ------------------------------------------------------------------ 分桶

/** 日期键 → 所属桶键(day: 原样;week: 该周周一;month: YYYY-MM)。 */
export function bucketKeyOf(dayKey, grain) {
  const d = parseYmd(dayKey);
  if (!d) return null;
  if (grain === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (grain === 'week') return ymd(startOfWeek(d));
  return ymd(d);
}

export function bucketLabel(key, grain) {
  if (grain === 'month') return key;
  if (grain === 'week') {
    const s = parseYmd(key);
    return s ? `${key.slice(5)}~${ymd(addDays(s, 6)).slice(5)}` : key;
  }
  return key.slice(5);
}

/**
 * 枚举区间内的**全部**桶(含没有任何订单的空桶)。
 * 空桶必须补齐,否则趋势图会把「停业的那天」直接跳过,曲线看起来像连续营业。
 */
export function enumerateBuckets(from, to, grain = 'day') {
  const s = parseYmd(from);
  const e = parseYmd(to);
  if (!s || !e || e < s) return [];
  const g = effectiveGrain(from, to, grain);
  const out = [];
  if (g === 'month') {
    let cur = startOfMonth(s);
    while (cur <= e) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      out.push({ key, label: key, from: ymd(cur), to: ymd(endOfMonth(cur)) });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  } else if (g === 'week') {
    let cur = startOfWeek(s);
    while (cur <= e) {
      const end = addDays(cur, 6);
      out.push({ key: ymd(cur), label: `${ymd(cur).slice(5)}~${ymd(end).slice(5)}`, from: ymd(cur), to: ymd(end) });
      cur = addDays(cur, 7);
    }
  } else {
    let cur = s;
    while (cur <= e) {
      const key = ymd(cur);
      out.push({ key, label: key.slice(5), from: key, to: key });
      cur = addDays(cur, 1);
    }
  }
  return out;
}

/**
 * 只保留「已结算」订单(paid / refunded),与 reportEngine 里 `paid` 的口径完全一致。
 * 期间报表统计的是**营业额**,作废单/挂单/未结账的 open 单都不算 —— 必须先过这道闸,
 * 否则 summarizePeriod / bucketize 会把作废单的金额一并加进去。
 */
export const salesOrders = (orders = []) => orders.filter((o) => o.status === 'paid' || o.status === 'refunded');

/** 汇总一批订单的核心指标(期间对比的原子单位)。 */
export function summarizePeriod(orders = []) {  const sum = (k) => orders.reduce((s, o) => s + Number(o[k] || 0), 0);
  const net = sum('total');
  const items = orders.reduce((s, o) => s + (o.items || []).reduce((x, i) => x + Number(i.qty || 0), 0), 0);
  return {
    net: round2(net),
    gross: round2(sum('subtotal')),
    discount: round2(sum('discount')),
    serviceCharge: round2(sum('serviceCharge')),
    tax: round2(sum('tax')),
    orders: orders.length,
    items,
    avgSpend: orders.length ? round2(net / orders.length) : 0,
  };
}

/** 按粒度把订单聚合进桶。 */
export function bucketize(orders = [], from, to, grain = 'day') {
  const g = effectiveGrain(from, to, grain);
  const buckets = enumerateBuckets(from, to, g);
  const byKey = new Map(buckets.map((b) => [b.key, {
    ...b, orders: 0, items: 0, net: 0, gross: 0, discount: 0, serviceCharge: 0, tax: 0,
  }]));
  for (const o of orders) {
    const k = bucketKeyOf(dayKeyOf(o.createdAt), g);
    const b = byKey.get(k);
    if (!b) continue;
    b.orders += 1;
    b.items += (o.items || []).reduce((s, i) => s + Number(i.qty || 0), 0);
    b.net += Number(o.total || 0);
    b.gross += Number(o.subtotal || 0);
    b.discount += Number(o.discount || 0);
    b.serviceCharge += Number(o.serviceCharge || 0);
    b.tax += Number(o.tax || 0);
  }
  return [...byKey.values()].map((b) => ({
    ...b,
    net: round2(b.net),
    gross: round2(b.gross),
    discount: round2(b.discount),
    serviceCharge: round2(b.serviceCharge),
    tax: round2(b.tax),
    avgSpend: b.orders ? round2(b.net / b.orders) : 0,
  }));
}

/** 计算增幅(%);上期为 0 时无法定义,返回 null 由前端显示 '—'。 */
export function growthOf(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0) return c === 0 ? 0 : null;
  return round2(((c - p) / Math.abs(p)) * 100);
}

export const directionOf = (delta) => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');

/**
 * 本期 / 上期两条序列按**桶序号**对齐(第 1 桶比第 1 桶)。
 * 桶数不同也照常配对,缺的一侧按 0 计 —— 趋势图因此能直接画成双线。
 */
/**
 * 序列对齐:按**桶序号**配对(第 1 桶比第 1 桶,而不是按日期配对)。
 *
 * 只取两个序列的**重叠长度**:9 月(30 天)对上 8 月(31 天)时,多出来的 8/31 不参与对齐。
 * 早先按 max 长度补齐,图表末尾会凭空多出一个「本期 0 / 上期 ¥72.30」的桶 ——
 * 它的标签是空的,却长得像「最后一天一单没开」,把「月份天数不同」说成了「当天经营异常」。
 * 少掉的桶数由调用方通过 seriesMeta 透出,界面可以如实说明,而不是假装对齐过。
 *
 * @returns {object[]} 长度为 min(cur.length, prev.length)
 */
export function alignSeries(cur = [], prev = [], valueKey = 'net') {
  const n = Math.min(cur.length, prev.length);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const c = cur[i];
    const p = prev[i];
    const current = round2(Number(c?.[valueKey] || 0));
    const previous = round2(Number(p?.[valueKey] || 0));
    const delta = round2(current - previous);
    out.push({
      index: i + 1,
      label: c?.label || p?.label || `#${i + 1}`,
      currentLabel: c?.label || '-',
      previousLabel: p?.label || '-',
      current,
      previous,
      delta,
      growth: growthOf(current, previous),
      direction: directionOf(delta),
      orders: Number(c?.orders || 0),
      prevOrders: Number(p?.orders || 0),
    });
  }
  return out;
}

/** 指标对比:本期 / 上期 / 差值 / 增幅 / 方向。 */
export function compareMetrics(cur = {}, prev = {}) {
  return METRICS.map((m) => {
    const current = round2(Number(cur[m.key] || 0));
    const previous = round2(Number(prev[m.key] || 0));
    const delta = round2(current - previous);
    return { ...m, current, previous, delta, growth: growthOf(current, previous), direction: directionOf(delta) };
  });
}

/** 按 key 分组订单行,用于期间分类/单品对比。 */
export function groupItemsBy(orders = [], keyFn, keyName) {
  const map = new Map();
  for (const o of orders) {
    for (const it of o.items || []) {
      const k = keyFn(it);
      if (k == null || k === '') continue;
      let acc = map.get(k);
      if (!acc) { acc = { [keyName]: k, qty: 0, amount: 0 }; map.set(k, acc); }
      acc.qty += Number(it.qty || 0);
      acc.amount += Number(it.qty || 0) * Number(it.unitPrice || 0);
    }
  }
  return [...map.values()];
}

/**
 * 分类对比:本期 vs 上期,按本期金额降序。
 * 上期有、本期没有的分类也会出现(金额 0),否则「某类彻底没卖」会被静默藏掉。
 */
export function compareCategories(curOrders = [], prevOrders = [], keyName = 'category') {
  const keyFn = (it) => it[keyName] || 'Uncategorised';
  const cur = new Map(groupItemsBy(curOrders, keyFn, keyName).map((r) => [r[keyName], r]));
  const prev = new Map(groupItemsBy(prevOrders, keyFn, keyName).map((r) => [r[keyName], r]));
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  const rows = [...keys].map((k) => {
    const c = cur.get(k) || { qty: 0, amount: 0 };
    const p = prev.get(k) || { qty: 0, amount: 0 };
    const amount = round2(c.amount);
    const prevAmount = round2(p.amount);
    const delta = round2(amount - prevAmount);
    return {
      name: k, qty: c.qty, amount, prevQty: p.qty, prevAmount, delta,
      growth: growthOf(amount, prevAmount), direction: directionOf(delta),
    };
  });
  return rows.sort((a, b) => b.amount - a.amount || b.prevAmount - a.prevAmount);
}

/**
 * 完整期间对比结果。两个后端与 reportEngine 都走这一个入口,口径不可能漂移。
 * @param {object[]} orders 全量订单(已含 items)
 * @param {{period:object, compare?:string, grain?:string}} opts
 */
export function buildPeriodComparison(orders = [], opts = {}) {
  const period = opts.period;
  const prev = comparePeriod(period, opts.compare === 'yoy' ? 'yoy' : 'prev');
  const inWindow = (p) => {
    const f = parseYmd(p.from);
    const t = parseYmd(p.to);
    return salesOrders(orders).filter((o) => {
      const d = parseYmd(dayKeyOf(o.createdAt));
      return d && d >= f && d <= t;
    });
  };
  const curOrders = inWindow(period);
  const prevOrders = inWindow(prev);
  const grain = opts.grain || period.grain || defaultGrain(period.days);
  const curBuckets = bucketize(curOrders, period.from, period.to, grain);
  const prevBuckets = bucketize(prevOrders, prev.from, prev.to, grain);

  return {
    period,
    previous: prev,
    grain: effectiveGrain(period.from, period.to, grain),
    metrics: compareMetrics(summarizePeriod(curOrders), summarizePeriod(prevOrders)),
    series: alignSeries(curBuckets, prevBuckets, 'net'),
    // 两个期间的桶数未必相等(9 月 30 天 vs 8 月 31 天)。如实报出桶数,
    // 界面才能说明「按前 N 桶对齐」,而不是让用户以为最后一天真的没营业。
    seriesMeta: {
      currentBuckets: curBuckets.length,
      previousBuckets: prevBuckets.length,
      alignedBuckets: Math.min(curBuckets.length, prevBuckets.length),
    },
    categories: compareCategories(curOrders, prevOrders, 'category'),
    summary: {
      current: summarizePeriod(curOrders),
      previous: summarizePeriod(prevOrders),
    },
  };
}

// ------------------------------------------------------------------ 接口载荷

/** 趋势列文案:导出成 CSV/Excel 后 ▲▼ 仍能一眼看出方向。 */
export const TREND_LABEL = { up: '▲ Rise', down: '▼ Fall', flat: '— Flat' };

/** 期间面板的三个分节,与 reportCatalog 里的报表一一对应(导出复用同一批列定义)。 */
export const PERIOD_SECTIONS = [
  { key: 'metrics', label: 'Metrics 指标对比', report: 'period_comparison' },
  { key: 'series', label: 'Trend 趋势', report: 'period_sales' },
  { key: 'categories', label: 'Categories 分类对比', report: 'period_category' },
];

export const PERIOD_SECTION_KEYS = PERIOD_SECTIONS.map((s) => s.key);

/** 分节 → 报表 key(导出用)。 */
export const periodSectionReport = (section) => (PERIOD_SECTIONS.find((s) => s.key === section) || PERIOD_SECTIONS[0]).report;

/**
 * 组装期间对比接口载荷。
 * 传 preset 就按预设算;只传 from/to 则当作自定义区间(periodEngine 会自动推断日历锚点)。
 * @param {object[]} orders 全量订单
 * @param {{preset?,compare?,grain?,from?,to?,anchor?}} query
 */
export function periodReportPayload(orders = [], query = {}) {
  const preset = PERIOD_PRESET_KEYS.includes(query.preset)
    ? query.preset
    : (query.from || query.to ? 'custom' : 'this_month');
  const period = resolvePeriod(preset, {
    anchor: query.anchor, from: query.from, to: query.to, grain: query.grain,
  });
  const compare = COMPARE_KEYS.includes(query.compare) ? query.compare : 'prev';
  const base = buildPeriodComparison(orders, { period, compare, grain: query.grain });
  return {
    ...base,
    compare,
    options: { presets: PERIOD_PRESETS, grains: GRAINS, compares: COMPARE_MODES, sections: PERIOD_SECTIONS },
  };
}

/** 取某一分节的行(列定义走 reportCatalog,导出与界面表头不会各写一份)。 */
export function periodSectionRows(payload, section = 'metrics') {
  const tag = (r) => ({ ...r, trend: TREND_LABEL[r.direction] || TREND_LABEL.flat });
  if (section === 'series') return payload.series.map((r) => ({ ...tag(r), bucket: r.index }));
  if (section === 'categories') return payload.categories.map(tag);
  return payload.metrics.map(tag);
}
