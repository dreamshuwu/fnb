// 演示销售历史生成器(仅用于 DEV_NO_DB=1 的开发预览)。
//
// 为什么需要它:开发种子原本只有主数据、**一张订单都没有**,于是整个报表中心
// (65 个报表)、期间对比、日结、客单价全是空的 —— 预览起来像坏了一样。
// 这里生成一段可信的销售历史,让报表有东西可看、期间对比能看出涨跌。
//
// 两条硬约束:
// 1. **确定性**:用固定种子的 mulberry32,每次启动生成的历史完全一样。
//    否则每次重启报表数字都在变,没法对照截图排查。
// 2. **日期口径与报表一致**:createdAt 用 Date.UTC(y,m,d,h) 构造,
//    保证 `String(iso).slice(0,10)`(报表的 dayKey,UTC 口径)恰好等于预期日期。
//    营业时段取 UTC 02:00~13:00 —— 在 GMT+8 下即当地 10:00~21:00,
//    不会跨到前一天,也不会与本地时区的区间过滤打架。
//
// 生产 seed.js **不使用**本模块:往真实店铺库里塞假销售是错的。

/** mulberry32:小巧的确定性 PRNG。 */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** 营业时段(UTC 小时):GMT+8 下为当地 10:00~21:00,避开跨日边界。 */
const OPEN_HOUR_UTC = 2;
const CLOSE_HOUR_UTC = 13;

/** 客流权重:午餐与晚餐两个高峰(kopitiam 的典型曲线)。 */
function hourWeight(hourUTC) {
  const h = hourUTC + 8; // 转成当地小时便于理解
  if (h >= 12 && h <= 14) return 3.0; // 午市
  if (h >= 17 && h <= 20) return 2.4; // 晚市
  if (h >= 10 && h < 12) return 1.4;
  if (h > 14 && h < 17) return 1.1;
  return 0.8;
}

/**
 * 生成一段销售历史。
 * @param {object} opts
 * @param {object[]} opts.variants  菜单变体(需含 id/code/name/price/category)
 * @param {object[]} opts.tables    桌位
 * @param {object[]} opts.users     员工(id/name/role),用于收银员与销售员
 * @param {object[]} opts.members   会员
 * @param {object}   opts.settings  门店设置(taxRate / taxInclusive / serviceChargeRate / roundTo5cent)
 * @param {(items:object[], discount:number)=>object} opts.totalsOf 金额计算(由调用方注入,避免与结账口径漂移)
 * @param {(variant:object, levelCode:string)=>number} [opts.priceOf] 按价格级别取价;不传则用 variant.price
 * @param {()=>string} opts.nextId  id 生成器
 * @param {number} [opts.days=60]  历史天数(含今天)
 * @param {Date}   [opts.anchor]   锚点日期,默认今天
 * @param {number} [opts.seed]     PRNG 种子
 * @returns {{orders:object[], payments:object[], voids:object[]}}
 */
export function buildDemoSalesHistory(opts = {}) {
  const {
    variants = [], tables = [], users = [], members = [],
    settings = {}, totalsOf, priceOf, nextId,
    days = 60,
    anchor = new Date(),
    seed = 20260101,
  } = opts;

  if (!variants.length || typeof totalsOf !== 'function' || typeof nextId !== 'function') {
    return { orders: [], payments: [], voids: [] };
  }

  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const cashiers = users.filter((u) => ['admin', 'manager', 'cashier'].includes(u.role));
  const sellers = users.filter((u) => ['admin', 'manager', 'cashier', 'waiter'].includes(u.role));
  const methods = [['cash', 0.55], ['card', 0.30], ['ewallet', 0.15]];

  const orders = [];
  const payments = [];
  const voids = [];

  // 按**本地日期**枚举,时间戳用 Date.UTC(...) 构造。
  // 两者必须分开:若按 UTC 日期枚举,当地凌晨(UTC 还是前一天)会把「今天」算成昨天;
  // 而时间戳用 Date.UTC 是为了让 dayKey(取 ISO 前 10 位)恰好等于预期日期。
  const nowMs = Date.now();

  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - back);
    const y = day.getFullYear();
    const mo = day.getMonth();
    const d = day.getDate();
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    const base = weekend ? between(14, 22) : between(9, 16);
    const ymd = `${y}${pad(mo + 1)}${pad(d)}`;
    let seq = 1;

    for (let i = 0; i < base; i += 1) {
      // 按客流权重抽营业时刻
      let hour = OPEN_HOUR_UTC;
      const weights = [];
      for (let h = OPEN_HOUR_UTC; h <= CLOSE_HOUR_UTC; h += 1) weights.push(hourWeight(h));
      const totalW = weights.reduce((a, b) => a + b, 0);
      let r = rnd() * totalW;
      for (let h = OPEN_HOUR_UTC; h <= CLOSE_HOUR_UTC; h += 1) {
        r -= hourWeight(h);
        if (r <= 0) { hour = h; break; }
      }
      const minute = between(0, 59);
      const second = between(0, 59);
      const ts = Date.UTC(y, mo, d, hour, minute, second);
      // 未来时段不生成:今天只补到「现在」为止,否则凌晨启动就会凭空多出一整天的营业额。
      if (ts > nowMs) continue;
      const createdAt = new Date(ts).toISOString();

      const member = rnd() < 0.12 && members.length ? pick(members) : null;
      const priceLevel = member ? 'MEMBER' : 'RETAIL';
      const roll = rnd();
      const type = roll < 0.62 ? 'dine_in' : roll < 0.88 ? 'takeaway' : 'delivery';
      const table = type === 'dine_in' && tables.length ? pick(tables) : null;

      // 1~4 行明细,不重复同一个变体
      const lineCount = between(1, 4);
      const chosen = [];
      const used = new Set();
      for (let k = 0; k < lineCount; k += 1) {
        let v = pick(variants);
        let guard = 0;
        while (used.has(String(v.id)) && guard < 8) { v = pick(variants); guard += 1; }
        used.add(String(v.id));
        const qty = rnd() < 0.72 ? 1 : between(2, 3);
        chosen.push({ v, qty });
      }
      const items = chosen.map(({ v, qty }) => ({
        variantId: String(v.id),
        code: v.code,
        name: v.name,
        // 会员单必须走会员价 —— 否则 Sales By Price Level 会出现「会员价级别却是零售金额」
        unitPrice: round2(typeof priceOf === 'function' ? priceOf(v, priceLevel) : Number(v.price || 0)),
        qty,
        status: 'pending',
        priceLevel,
      }));

      const gross = items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
      // 6% 的散单打个整数折扣,让折扣报表与 Sales By Discount Type 有数据
      const discount = rnd() < 0.06 ? Math.min(round2(gross * 0.1), 10) : 0;
      const totals = totalsOf(items, discount);

      const o = {
        id: nextId(),
        orgId: '1',
        storeId: '1',
        orderNo: `T${ymd}-${pad(seq)}`,
        type,
        tableId: table ? String(table.id) : null,
        customerName: type === 'delivery' ? 'Walk-in Delivery' : null,
        phone: null,
        status: 'paid',
        items,
        subtotal: totals.subtotal,
        discount: totals.discount,
        serviceCharge: totals.serviceCharge,
        tax: totals.tax,
        total: totals.total,
        refundedAmount: 0,
        invoiceNo: null,
        holdLabel: null,
        heldAt: null,
        reprintCount: 0,
        createdBy: (cashiers.length ? pick(cashiers) : users[0]).id,
        salesPersonId: type === 'dine_in' && sellers.length ? String(pick(sellers).id) : null,
        memberId: member ? String(member.id) : null,
        voucherDiscount: 0,
        rebateRedeemed: 0,
        priceLevel,
        shiftId: null,
        voidReason: null,
        createdAt,
        updatedAt: createdAt,
      };

      // 2% 作废单:让 Void / Cancellation 报表也有内容。
      // 作废单不进营业额,payments 也不生成。
      if (rnd() < 0.02) {
        o.status = 'void';
        o.voidReason = pick(['Customer cancelled', 'Wrong item entered', 'Duplicate order']);
        voids.push(o);
        orders.push(o);
        seq += 1;
        continue;
      }

      orders.push(o);

      // 支付方式按权重拆一笔(演示不做分单,一笔即可)
      let mr = rnd();
      let method = 'cash';
      for (const [m, w] of methods) { mr -= w; if (mr <= 0) { method = m; break; } }
      payments.push({
        id: nextId(),
        orgId: '1',
        storeId: '1',
        orderId: o.id,
        method,
        amount: totals.total,
        tip: 0,
        createdAt,
      });
      seq += 1;
    }
  }

  return { orders, payments, voids };
}
