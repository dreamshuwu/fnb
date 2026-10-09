// ---------------------------------------------------------------------------
// 会员引擎 —— 生产(MySQL)与预览(内存)共用的唯一会员口径。
//
// 为什么要有这一层(和 inventoryEngine.js 同理):
//   以前 routes/business.js 与 devMode.js 各写一份「改积分 + 插一条流水」,
//   等级折扣 / 积分换算 / 信用额度判断散落在结账代码里,两边迟早漂移。
//   现在等级解析、积分换算、信用额度、积分与消费落账全部收拢到这里。
//
// 关键约束:先全部试算通过,再统一落库(validate-then-commit)。
//   一次结账可能同时「赚积分 + 抵积分 + 累加消费」,任何一项不合法就整体不落账。
//
// 适配器契约(adapter):
//   getMember(orgId, storeId, id) -> 会员对象(camelCase) 或 null
//   saveMember(member, patch)     -> void   patch 可含 points/pointsEarnedTotal/
//                                            pointsRedeemedTotal/totalSpend/creditBalance/tierId
//   appendPoints(row)             -> 新流水 id   (row 含 orgId/storeId)
//   appendCredit(row)             -> 新流水 id   (row 含 orgId/storeId)
//   listTiers(orgId, storeId)     -> [等级对象]
// ctx 统一携带 { orgId, storeId, createdBy, createdByName, ... }
// ---------------------------------------------------------------------------

const num = (v) => Number(v || 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;
const r3 = (v) => Math.round(num(v) * 1000) / 1000;

// ---- 积分流水类型 ----
export const POINTS_LABELS = {
  earn: '消费累积',
  redeem: '结账抵扣',
  adjust: '手工调整',
  bonus: '奖励赠送',
  expire: '积分过期',
  refund: '退款回补',
  void: '作废回滚',
};
export const pointsLabel = (t) => POINTS_LABELS[t] || t;
export const POINTS_TYPES = Object.keys(POINTS_LABELS);

// ---- 储值(credit)流水类型：topup / knockoff 共处 member_topups 一张表 ----
export const CREDIT_LABELS = { topup: '会员充值', knockoff: '赊账核销', adjust: '储值调整' };
export const creditLabel = (t) => CREDIT_LABELS[t] || t;

// ---- 会员状态 ----
export const MEMBER_STATUSES = ['active', 'inactive', 'blocked'];
export const GENDERS = ['male', 'female', 'other'];

// ---------------------------------------------------------------------------
// 等级解析
// ---------------------------------------------------------------------------
/** 会员当前生效的等级：先按 tier_id 命中，再退回默认等级，最后退回排序最靠前的启用等级。 */
export function resolveTier(tiers, member) {
  const list = (tiers || []).filter((t) => t && t.isActive !== false);
  if (!list.length) return null;
  const tid = member && member.tierId != null ? String(member.tierId) : null;
  if (tid) {
    const hit = list.find((t) => String(t.id) === tid);
    if (hit) return hit;
  }
  const def = list.find((t) => t.isDefault);
  if (def) return def;
  return [...list].sort((a, b) => num(a.sortOrder) - num(b.sortOrder))[0] || null;
}

/** 等级折扣率（百分数，例如 5 表示 5%）。 */
export function tierDiscountPercent(tier) {
  return tier ? r2(tier.discountPercent) : 0;
}

/** 按累计消费 / 积分命中的最高等级（min_spend 与 min_points 都要满足）。 */
export function tierForSpend(tiers, { totalSpend = 0, points = 0 } = {}) {
  const list = (tiers || []).filter((t) => t && t.isActive !== false);
  const qualified = list.filter(
    (t) => num(t.minSpend) <= num(totalSpend) + 0.001 && num(t.minPoints) <= num(points),
  );
  if (!qualified.length) return null;
  return qualified.sort((a, b) => num(b.sortOrder) - num(a.sortOrder))[0];
}

/** 等级折扣金额：amount * percent/100，2 位小数。 */
export function computeTierDiscount(tier, amount) {
  const percent = tierDiscountPercent(tier);
  const base = Math.max(0, r2(amount));
  if (percent <= 0 || base <= 0) return { percent: 0, amount: 0, base };
  const off = Math.min(base, r2((base * percent) / 100));
  return { percent, amount: off, base };
}

// ---------------------------------------------------------------------------
// 积分换算
// ---------------------------------------------------------------------------
/** 消费金额可得的积分（向下取整；pointsPerAmount = 每 1 元得几分）。 */
export function computePointsEarn(amount, settings = {}) {
  const rate = num(settings.pointsPerAmount);
  if (rate <= 0) return 0;
  return Math.floor(Math.max(0, num(amount)) * rate + 1e-9);
}

/** 积分可抵的金额（pointsRedeemValue = 1 分抵多少元）。 */
export function computePointsValue(points, settings = {}) {
  const v = num(settings.pointsRedeemValue);
  if (v <= 0) return 0;
  return r2(Math.max(0, num(points)) * v);
}

/** 抵扣 amount 元需要多少积分（向上取整；不足 1 分按 1 分算）。 */
export function pointsNeededFor(amount, settings = {}) {
  const v = num(settings.pointsRedeemValue);
  if (v <= 0) return Infinity;
  return Math.ceil(Math.max(0, num(amount)) / v - 1e-9);
}

/** 本次最多能用掉多少积分：受最低兑换门槛与会员余额共同约束。 */
export function maxRedeemablePoints(points, settings = {}) {
  const min = num(settings.pointsMinRedeem);
  const bal = Math.max(0, Math.floor(num(points)));
  if (bal <= 0) return 0;
  if (min > 0 && bal < min) return 0;
  return bal;
}

/** 校验一次积分抵扣：返回 { ok, error?, points?, value?, maxValue? }。 */
export function checkPointsRedeem(points, wantValue, settings = {}) {
  const value = r2(wantValue);
  if (value <= 0) return { ok: true, points: 0, value: 0, maxValue: 0 };
  const bal = Math.max(0, Math.floor(num(points)));
  const maxValue = computePointsValue(maxRedeemablePoints(bal, settings), settings);
  const min = num(settings.pointsMinRedeem);
  const need = pointsNeededFor(value, settings);
  if (!Number.isFinite(need)) return { ok: false, error: 'points_redeem_disabled', maxValue: 0 };
  if (min > 0 && bal < min) return { ok: false, error: 'points_below_min_redeem', available: bal, minRedeem: min, maxValue: 0 };
  if (need > bal) return { ok: false, error: 'insufficient_points', requested: need, available: bal, maxValue };
  if (need > maxRedeemablePoints(bal, settings)) return { ok: false, error: 'points_above_redeemable', maxValue };
  return { ok: true, points: need, value: computePointsValue(need, settings), maxValue };
}

// ---------------------------------------------------------------------------
// 信用额度（赊账）
// ---------------------------------------------------------------------------
// 口径说明（全系统统一）:
//   members.credit_balance 是**带符号的会员账户余额** ——
//     正数 = 储值(店家欠会员)   负数 = 欠款(会员欠店家)
//   top-up 充值 +、knock-off 核销 −、结账挂账(tab) −。
//   credit_limit 限制的是「最多能欠多少」,即余额最低可到 -credit_limit。
//   limit <= 0 表示该会员不允许挂账。
/** 检查再挂账 addAmount 是否超信用额度。 */
export function checkCreditLimit(member, addAmount) {
  const limit = r2(member && member.creditLimit);
  const balance = r2(member && member.creditBalance);
  const owed = r2(Math.max(0, -balance));
  const add = r2(addAmount);
  const available = r2(Math.max(0, limit - owed));
  const after = r2(balance - add);
  const floor = r2(-limit);
  if (add <= 0) return { ok: false, error: 'invalid_amount', limit, balance, owed, available, after, floor, over: 0 };
  if (limit <= 0) return { ok: false, error: 'credit_not_allowed', limit, balance, owed, available: 0, after, floor, over: add };
  if (after < floor - 0.001) {
    return { ok: false, error: 'credit_limit_exceeded', limit, balance, owed, available, after, floor, over: r2(floor - after) };
  }
  return { ok: true, limit, balance, owed, available, after, floor, over: 0 };
}

// ---------------------------------------------------------------------------
// 积分落账（原子）
// ---------------------------------------------------------------------------
/**
 * 批量积分变动。entries: [{ memberId, delta, type, reason, refType, refId, refNo }]
 * delta 为正=累积，为负=抵扣。ctx: { allowNegative, createdBy, createdByName }
 * @returns {{ok:boolean, errors:Array, entries:Array}}
 */
export async function applyPoints(adapter, entries, ctx = {}) {
  const { orgId, storeId, allowNegative = false, createdBy = null, createdByName = null } = ctx;
  const list = (entries || []).filter(Boolean);
  const errors = [];
  const plan = [];
  const running = new Map(); // memberId -> 变动后的积分

  for (const e of list) {
    const mid = String(e.memberId);
    const member = await adapter.getMember(orgId, storeId, mid);
    if (!member) { errors.push({ memberId: mid, code: 'member_not_found' }); continue; }
    const delta = Math.trunc(num(e.delta));
    if (!delta) { errors.push({ memberId: mid, code: 'zero_delta' }); continue; }
    const before = running.has(mid) ? running.get(mid) : Math.max(0, Math.floor(num(member.points)));
    const after = before + delta;
    if (after < 0 && !allowNegative) {
      errors.push({ memberId: mid, code: 'insufficient_points', requested: -delta, available: before });
      continue;
    }
    running.set(mid, after);
    plan.push({ member, before, after, delta, entry: e });
  }
  if (errors.length) return { ok: false, errors, entries: [] };

  // 二次遍历：按会员累计 earned / redeemed 总额，再逐条写流水
  const earnedRun = new Map();
  const redeemedRun = new Map();
  for (const p of plan) {
    const mid = String(p.member.id);
    const e0 = earnedRun.has(mid) ? earnedRun.get(mid) : Math.max(0, Math.floor(num(p.member.pointsEarnedTotal)));
    const r0 = redeemedRun.has(mid) ? redeemedRun.get(mid) : Math.max(0, Math.floor(num(p.member.pointsRedeemedTotal)));
    const e1 = e0 + (p.delta > 0 ? p.delta : 0);
    const r1 = r0 + (p.delta < 0 ? -p.delta : 0);
    earnedRun.set(mid, e1);
    redeemedRun.set(mid, r1);
    p.patch = { points: p.after, pointsEarnedTotal: e1, pointsRedeemedTotal: r1 };
  }

  const out = [];
  for (const p of plan) {
    const mid = String(p.member.id);
    await adapter.saveMember(p.member, p.patch);
    const id = await adapter.appendPoints({
      orgId, storeId,
      memberId: mid,
      delta: p.delta,
      type: p.entry.type || 'adjust',
      reason: p.entry.reason || null,
      refType: p.entry.refType || null,
      refId: p.entry.refId == null || p.entry.refId === '' ? null : String(p.entry.refId),
      refNo: p.entry.refNo || null,
      balanceAfter: p.after,
      createdBy: createdBy == null ? null : String(createdBy),
      createdByName: createdByName || null,
    });
    out.push({
      id: id == null ? null : String(id),
      memberId: mid,
      delta: p.delta,
      type: p.entry.type || 'adjust',
      balanceAfter: p.after,
    });
  }
  return { ok: true, errors: [], entries: out };
}

// ---------------------------------------------------------------------------
// 消费累计 + 自动升级（原子）
// ---------------------------------------------------------------------------
/**
 * entries: [{ memberId, amount }]  —— amount 为本次实付金额（参与累计消费）
 * ctx: { autoTierUpgrade }  显式传 false 时不做自动升级
 */
export async function applyMemberSpend(adapter, entries, ctx = {}) {
  const { orgId, storeId, autoTierUpgrade } = ctx;
  const list = (entries || []).filter(Boolean);
  const errors = [];
  const plan = [];
  const running = new Map();

  for (const e of list) {
    const mid = String(e.memberId);
    const member = await adapter.getMember(orgId, storeId, mid);
    if (!member) { errors.push({ memberId: mid, code: 'member_not_found' }); continue; }
    const amount = r2(e.amount);
    if (amount <= 0) { errors.push({ memberId: mid, code: 'invalid_amount' }); continue; }
    const before = running.has(mid) ? running.get(mid) : r2(member.totalSpend);
    const after = r2(before + amount);
    running.set(mid, after);
    plan.push({ member, before, after, amount });
  }
  if (errors.length) return { ok: false, errors, members: [] };

  const tiers = autoTierUpgrade === false ? [] : await adapter.listTiers(orgId, storeId);
  const out = [];
  for (const p of plan) {
    const mid = String(p.member.id);
    const patch = { totalSpend: p.after };
    let upgraded = null;
    if (tiers && tiers.length) {
      const cur = resolveTier(tiers, p.member);
      const best = tierForSpend(tiers, { totalSpend: p.after, points: num(p.member.points) });
      // 只升不降：避免手工指定过高等级后被一次小额消费打回
      if (best && (!cur || num(best.sortOrder) > num(cur.sortOrder))) {
        patch.tierId = String(best.id);
        upgraded = { from: cur ? cur.name : null, fromId: cur ? String(cur.id) : null, to: best.name, tierId: String(best.id) };
      }
    }
    await adapter.saveMember(p.member, patch);
    out.push({
      memberId: mid,
      before: p.before,
      totalSpend: p.after,
      amount: p.amount,
      tierId: patch.tierId || (p.member.tierId == null ? null : String(p.member.tierId)),
      upgraded,
    });
  }
  return { ok: true, errors: [], members: out };
}

// ---------------------------------------------------------------------------
// 储值(credit)流水 —— 充值 / 核销共用
// ---------------------------------------------------------------------------
/**
 * entries: [{ memberId, amount, type:'topup'|'knockoff'|'adjust', method, note, receiptNo }]
 * amount 为正=充值，为负=核销。ctx: { allowNegative }
 */
export async function applyCredit(adapter, entries, ctx = {}) {
  const { orgId, storeId, allowNegative = false, createdBy = null, createdByName = null } = ctx;
  const list = (entries || []).filter(Boolean);
  const errors = [];
  const plan = [];
  const running = new Map();

  for (const e of list) {
    const mid = String(e.memberId);
    const member = await adapter.getMember(orgId, storeId, mid);
    if (!member) { errors.push({ memberId: mid, code: 'member_not_found' }); continue; }
    const amount = r2(e.amount);
    if (!amount) { errors.push({ memberId: mid, code: 'zero_amount' }); continue; }
    const before = running.has(mid) ? running.get(mid) : r2(member.creditBalance);
    const after = r2(before + amount);
    if (after < 0 && !allowNegative) {
      errors.push({ memberId: mid, code: 'insufficient_credit', requested: r2(-amount), available: before });
      continue;
    }
    running.set(mid, after);
    plan.push({ member, before, after, amount, entry: e });
  }
  if (errors.length) return { ok: false, errors, entries: [] };

  const out = [];
  for (const p of plan) {
    const mid = String(p.member.id);
    await adapter.saveMember(p.member, { creditBalance: p.after });
    const id = await adapter.appendCredit({
      orgId, storeId,
      memberId: mid,
      type: p.entry.type || (p.amount > 0 ? 'topup' : 'knockoff'),
      amount: p.amount,
      method: p.entry.method || 'cash',
      receiptNo: p.entry.receiptNo || null,
      balanceAfter: p.after,
      note: p.entry.note || null,
      createdBy: createdBy == null ? null : String(createdBy),
      createdByName: createdByName || null,
    });
    out.push({
      id: id == null ? null : String(id),
      memberId: mid,
      type: p.entry.type || (p.amount > 0 ? 'topup' : 'knockoff'),
      amount: p.amount,
      balanceAfter: p.after,
    });
  }
  return { ok: true, errors: [], entries: out };
}

// ---------------------------------------------------------------------------
// 会员对账单
// ---------------------------------------------------------------------------
// 三条独立账本(储值 / 返利 / 积分)各有自己的 running balance，
// 混在一条余额里会让「余额」失去意义，所以按 ledger 分开累计。
export const STATEMENT_LEDGERS = ['credit', 'rebate', 'points'];

const tsOf = (v) => (v == null ? 0 : new Date(v).getTime());
const seqOf = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * 归一化对账单事件。入参均为各账本已映射好的 camelCase 对象(需带 id)。
 * @returns {Array<{id,date,ledger,type,refNo,description,debit,credit,note,method,by}>}
 */
export function statementEvents({ credit = [], rebate = [], points = [] } = {}) {
  const rows = [];
  for (const t of credit) {
    const amt = r2(t.amount);
    rows.push({
      id: t.id, date: t.createdAt, ledger: 'credit', type: t.type || (amt > 0 ? 'topup' : 'knockoff'),
      refNo: t.receiptNo || null,
      description: creditLabel(t.type || (amt > 0 ? 'topup' : 'knockoff')),
      debit: amt < 0 ? r2(-amt) : 0, credit: amt > 0 ? amt : 0,
      note: t.note || null, method: t.method || null, by: t.createdByName || null,
    });
  }
  for (const r of rebate) {
    const isOut = r.type === 'redeem' || r.type === 'adjust_out' || num(r.amount) < 0;
    const amt = Math.abs(r2(r.amount));
    rows.push({
      id: r.id, date: r.createdAt, ledger: 'rebate', type: r.type,
      refNo: r.orderNo || null,
      description: isOut ? '返利抵扣' : '返利累积',
      debit: isOut ? amt : 0, credit: isOut ? 0 : amt,
      note: r.reason || null, method: null, by: r.createdByName || null,
    });
  }
  for (const p of points) {
    const d = Math.trunc(num(p.delta));
    rows.push({
      id: p.id, date: p.createdAt, ledger: 'points', type: p.type || 'adjust',
      refNo: p.refNo || null,
      description: pointsLabel(p.type || 'adjust') + (p.reason ? ` · ${p.reason}` : ''),
      debit: d < 0 ? -d : 0, credit: d > 0 ? d : 0,
      note: p.reason || null, method: null, by: p.createdByName || null,
    });
  }
  // 时间戳相同(同毫秒;MySQL TIMESTAMP 更是只到秒)时必须按自增 id 排,
  // 否则同一秒内的充值/核销会被单号字母序打乱,running balance 直接算错。
  return rows.sort(
    (a, b) => (tsOf(a.date) - tsOf(b.date))
      || (seqOf(a.id) - seqOf(b.id))
      || String(a.refNo || '').localeCompare(String(b.refNo || '')),
  );
}

/**
 * 按账本分别累计 running balance。
 * @param {Array} events statementEvents() 的输出
 * @param {{credit:number, rebate:number, points:number}} opening 期初余额
 */
export function runStatement(events, opening = {}) {  const bal = { credit: r2(opening.credit), rebate: r2(opening.rebate), points: Math.floor(num(opening.points)) };
  const rows = [];
  for (const e of events) {
    if (e.ledger === 'points') {
      bal.points += (e.credit || 0) - (e.debit || 0);
    } else {
      bal[e.ledger] = r2(bal[e.ledger] + (e.credit || 0) - (e.debit || 0));
    }
    rows.push({ ...e, balance: e.ledger === 'points' ? bal.points : bal[e.ledger] });
  }
  const totals = {
    creditIn: 0, creditOut: 0, rebateIn: 0, rebateOut: 0,
    pointsIn: 0, pointsOut: 0, sales: 0,
  };
  for (const e of events) {
    if (e.ledger === 'credit') { totals.creditIn = r2(totals.creditIn + e.credit); totals.creditOut = r2(totals.creditOut + e.debit); }
    else if (e.ledger === 'rebate') { totals.rebateIn = r2(totals.rebateIn + e.credit); totals.rebateOut = r2(totals.rebateOut + e.debit); }
    else { totals.pointsIn += e.credit; totals.pointsOut += e.debit; }
  }
  return { rows, opening: { credit: r2(opening.credit), rebate: r2(opening.rebate), points: Math.floor(num(opening.points)) }, closing: bal, totals };
}

/** 汇总一组事件的借贷发生额(按账本分开)。 */
export function sumByLedger(events) {
  const t = { creditIn: 0, creditOut: 0, rebateIn: 0, rebateOut: 0, pointsIn: 0, pointsOut: 0 };
  for (const e of events) {
    if (e.ledger === 'credit') { t.creditIn = r2(t.creditIn + (e.credit || 0)); t.creditOut = r2(t.creditOut + (e.debit || 0)); }
    else if (e.ledger === 'rebate') { t.rebateIn = r2(t.rebateIn + (e.credit || 0)); t.rebateOut = r2(t.rebateOut + (e.debit || 0)); }
    else { t.pointsIn += (e.credit || 0); t.pointsOut += (e.debit || 0); }
  }
  return t;
}

/** 某组事件的净变动(按账本)。 */
export function netByLedger(events) {
  const t = sumByLedger(events);
  return {
    credit: r2(t.creditIn - t.creditOut),
    rebate: r2(t.rebateIn - t.rebateOut),
    points: Math.trunc(t.pointsIn - t.pointsOut),
  };
}

/**
 * 按 [from, to] 切分对账单：from 之前的事件汇成期初，区间内的事件才是正文明细。
 * 日期用本地日历日比较(YYYY-MM-DD)，避免时区把月初/月末的行切错。
 * @param {string|null} from YYYY-MM-DD
 * @param {string|null} to   YYYY-MM-DD
 */
export function sliceStatement(events, from = null, to = null) {
  const f = from ? new Date(`${String(from).slice(0, 10)}T00:00:00`).getTime() : null;
  const t = to ? new Date(`${String(to).slice(0, 10)}T23:59:59.999`).getTime() : null;
  const before = [];
  const within = [];
  for (const e of events) {
    const ts = tsOf(e.date);
    if (f != null && ts < f) before.push(e);
    else if ((f == null || ts >= f) && (t == null || ts <= t)) within.push(e);
  }
  return { opening: netByLedger(before), within };
}

// ---------------------------------------------------------------------------
// 编号
// ---------------------------------------------------------------------------
/** 会员编号：M + 4 位序号，取当天/现有编号的最大值 +1。 */export function nextMemberNo(existingNos, prefix = 'M', width = 4) {
  let max = 0;
  for (const n of existingNos || []) {
    const m = String(n || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

/** 等级编码：优先用调用方给的 code，否则由名称派生（去空格、大写、截 32 位）。 */
export function makeTierCode(name, existingCodes = []) {
  const base = String(name || 'TIER').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'TIER';
  if (!existingCodes.includes(base)) return base;
  let i = 2;
  while (existingCodes.includes(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export { r2, r3 };
