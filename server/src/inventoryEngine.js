// ---------------------------------------------------------------------------
// 库存引擎 —— 生产(MySQL)与预览(内存)共用的唯一库存变动入口。
//
// 为什么要有这一层:
//   以前 routes/inventory.js 和 devMode.js 各自手写「改 quantity + 插一条台账」,
//   两边的成本口径迟早会漂移。现在所有库存变动都走 applyMovements(),
//   它负责三件事:
//     1) 按移动加权平均重算 avg_cost —— 库存估值的唯一依据
//     2) 写回 quantity / avg_cost / last_cost
//     3) 落一行台账(stock_movements),带 unit_cost / amount / 来源单据
//
// 关键约束:先全部试算通过,再统一落库(validate-then-commit)。
//   一张收货单有 5 行,第 5 行不合法时,前 4 行绝不能进账。
// ---------------------------------------------------------------------------

const num = (v) => Number(v || 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;
const r3 = (v) => Math.round(num(v) * 1000) / 1000;
const r4 = (v) => Math.round(num(v) * 10000) / 10000;

// ---- 变动类型 ----
// IN  : 数量按绝对值入库
// OUT : 数量按绝对值出库(传正数即可,引擎自动取负)
// SET : 数量是盘点绝对值(不是增量)
export const IN_TYPES = new Set(['opening', 'restock', 'purchase_receipt', 'transfer_in', 'credit_note', 'refund']);
export const OUT_TYPES = new Set(['sale', 'wastage', 'return', 'transfer_out', 'receipt_void']);
export const SET_TYPES = new Set(['count']);
// adjustment / adjust 按传入 qty 的正负号决定方向

// last_cost 的语义是「最近一次采购入库单价」,下单时用作默认价。
// 只有真正的采购入库才更新它 —— 期初/盘点/调整/调拨都不该覆盖。
export const LAST_COST_TYPES = new Set(['purchase_receipt', 'restock']);

export const MOVEMENT_LABELS = {
  opening: '期初建账',
  restock: '补货入库',
  purchase_receipt: '采购入库',
  receipt_void: '收货冲销',
  adjustment: '手工调整',
  adjust: '手工调整',
  count: '盘点调整',
  wastage: '损耗报废',
  return: '退货给供应商',
  transfer_in: '库位调拨入',
  transfer_out: '库位调拨出',
  sale: '销售出库',
  credit_note: '贷项单回补',
  refund: '退款回补',
};
export const movementLabel = (t) => MOVEMENT_LABELS[t] || t;

/**
 * 单条变动的纯函数试算(不碰存储)。
 * @returns {{error?:string, requested?:number, available?:number,
 *            before:number, after:number, delta:number,
 *            avgCost:number, lastCost:number, unitCost:number, amount:number}}
 */
export function computeNext(prev, line, allowNegative = false) {
  const oldQty = num(prev.quantity);
  const oldAvg = num(prev.avgCost);
  const oldLast = num(prev.lastCost);
  const oldValue = oldQty * oldAvg;
  const rawCost = line.unitCost == null || line.unitCost === '' ? null : num(line.unitCost);

  let delta;
  let newQty;
  let newAvg;
  let newLast;
  let moveCost;
  // 只有采购入库才把 last_cost 刷成本次入库价,其余类型保留原值
  const touchesLast = LAST_COST_TYPES.has(line.type);

  if (SET_TYPES.has(line.type)) {
    // 盘点:line.qty 是「实盘数量」,不是增量
    newQty = Math.max(0, num(line.qty));
    delta = newQty - oldQty;
    if (delta > 0) {
      const c = rawCost != null ? rawCost : oldAvg;
      newAvg = newQty > 0 ? (oldValue + delta * c) / newQty : c;
      moveCost = c;
    } else if (delta < 0) {
      // 盘亏按加权成本出账;若同时给了新成本,视为重新估值
      newAvg = rawCost != null ? rawCost : oldAvg;
      moveCost = oldAvg;
    } else {
      newAvg = rawCost != null ? rawCost : oldAvg;
      moveCost = rawCost != null ? rawCost : oldAvg;
    }
    newLast = oldLast;
  } else {
    const signed = IN_TYPES.has(line.type) ? Math.abs(num(line.qty))
      : OUT_TYPES.has(line.type) ? -Math.abs(num(line.qty))
        : num(line.qty); // adjustment: 跟随符号
    delta = signed;
    const projected = oldQty + signed;
    if (projected < 0 && !allowNegative) {
      return { error: 'insufficient', requested: Math.abs(signed), available: oldQty, before: oldQty, after: oldQty, delta: 0 };
    }
    if (signed >= 0) {
      // 入库:按入库单价把金额并入加权平均
      const c = rawCost != null ? rawCost : oldAvg;
      newQty = projected;
      newAvg = newQty > 0 ? (oldValue + signed * c) / newQty : c;
      moveCost = c;
      newLast = touchesLast ? c : oldLast;
    } else {
      // 出库:按当前加权成本计价,且不改动加权成本本身。
      // allowNegative(收货冲销用)时不做 0 下限截断 —— 否则 delta 会与 after-before 对不上。
      newQty = allowNegative ? projected : Math.max(0, projected);
      newAvg = oldAvg;
      moveCost = oldAvg;
      newLast = oldLast;
    }
  }

  return {
    before: r3(oldQty),
    after: r3(newQty),
    delta: r3(delta),
    avgCost: r4(newAvg),
    lastCost: r4(newLast),
    unitCost: r4(moveCost),
    amount: r2(delta * moveCost),
  };
}

/**
 * 批量库存变动 —— 全量试算通过才落库。
 *
 * adapter 需要实现(生产走 MySQL / 预览走内存,由各自 backend 注入):
 *   getItem(orgId, storeId, itemId) -> 归一化物料的 Promise(含 id/name/code/unit/quantity/avgCost/lastCost)
 *   saveItem(item, { quantity, avgCost, lastCost }) -> Promise
 *   appendMovement(movement) -> Promise<归一化台账行>
 *
 * @param lines [{ itemId, type, qty, unitCost?, note?, location?, refType?, refId?, refNo? }]
 * @param ctx   { orgId, storeId, allowNegative?, createdBy, createdByName }
 * @returns { ok, errors?, movements?, items? }
 */
export async function applyMovements(adapter, lines, ctx = {}) {
  const { orgId, storeId, allowNegative = false, createdBy = null, createdByName = null } = ctx;
  if (!Array.isArray(lines) || !lines.length) return { ok: false, errors: [{ error: 'no_lines' }] };

  // ---- pass 1:逐行试算。同一物料多行会按顺序累积,不落库 ----
  const plan = new Map(); // itemId -> 状态
  const order = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || {};
    const item = await adapter.getItem(orgId, storeId, line.itemId);
    if (!item) {
      errors.push({ index: i, itemId: line.itemId, error: 'item_not_found' });
      continue;
    }
    const key = String(item.id);
    let st = plan.get(key);
    if (!st) {
      st = {
        item,
        quantity: num(item.quantity),
        avgCost: num(item.avgCost),
        lastCost: num(item.lastCost),
        movements: [],
      };
      plan.set(key, st);
      order.push(key);
    }
    const calc = computeNext(st, line, allowNegative);
    if (calc.error) {
      errors.push({
        index: i, itemId: item.id, itemName: item.name,
        error: calc.error, requested: calc.requested, available: calc.available,
      });
      continue;
    }
    st.quantity = calc.after;
    st.avgCost = calc.avgCost;
    st.lastCost = calc.lastCost;
    st.movements.push({
      lineIndex: i,
      movement: {
        orgId, storeId, itemId: item.id,
        itemCode: item.code || null, itemName: item.name || null,
        type: line.type,
        delta: calc.delta, before: calc.before, after: calc.after,
        unitCost: calc.unitCost, amount: calc.amount, avgCostAfter: calc.avgCost,
        refType: line.refType || line.type, refId: line.refId ?? null, refNo: line.refNo || null,
        location: line.location || item.location || null,
        note: line.note || null,
        createdBy, createdByName,
      },
    });
  }

  if (errors.length) return { ok: false, errors };

  // ---- pass 2:全部通过,统一提交 ----
  // movements 按**调用方传入的行顺序**返回(movements[i] 对应 lines[i]),
  // 收货单/调拨单要拿它写回每行的 before/after/avgCostAfter。
  const movements = new Array(lines.length);
  const items = [];
  for (const key of order) {
    const st = plan.get(key);
    await adapter.saveItem(st.item, {
      quantity: st.quantity, avgCost: st.avgCost, lastCost: st.lastCost,
    });
    for (const entry of st.movements) {
      movements[entry.lineIndex] = await adapter.appendMovement(entry.movement);
    }
    items.push({ item: st.item, quantity: st.quantity, avgCost: st.avgCost, lastCost: st.lastCost });
  }
  return { ok: true, movements, items };
}

/** 单条变动的便捷封装。 */
export async function applyMovement(adapter, line, ctx = {}) {
  const r = await applyMovements(adapter, [line], ctx);
  if (!r.ok) {
    const e = new Error(r.errors?.[0]?.error || 'movement_failed');
    e.detail = r.errors?.[0];
    throw e;
  }
  return { movement: r.movements[0], item: r.items[0] };
}

// ---------------------------------------------------------------------------
// 库存估值:以 avg_cost 为准,不是 cost_price(那是录入价,会过期)
// ---------------------------------------------------------------------------
export function valuationOf(items) {
  const rows = (items || []).map((it) => {
    const qty = num(it.quantity);
    const cost = num(it.avgCost != null ? it.avgCost : it.avg_cost);
    const value = r2(qty * cost);
    return {
      itemId: String(it.id ?? it._id ?? ''),
      code: it.code || null,
      name: it.name,
      category: it.category || 'Uncategorised',
      unit: it.unit || null,
      location: it.location || null,
      quantity: r3(qty),
      avgCost: r4(cost),
      lastCost: r4(it.lastCost ?? it.last_cost),
      value,
      threshold: r3(it.threshold),
      isLow: qty < num(it.threshold),
    };
  }).sort((a, b) => b.value - a.value);

  const total = r2(rows.reduce((s, x) => s + x.value, 0));
  const group = (key) => {
    const out = {};
    for (const x of rows) {
      const k = x[key] || 'Uncategorised';
      if (!out[k]) out[k] = { key: k, items: 0, quantity: 0, value: 0 };
      out[k].items++;
      out[k].quantity = r3(out[k].quantity + x.quantity);
      out[k].value = r2(out[k].value + x.value);
    }
    return Object.values(out).sort((a, b) => b.value - a.value);
  };

  return {
    rows,
    total,
    totalQuantity: r3(rows.reduce((s, x) => s + x.quantity, 0)),
    itemCount: rows.length,
    lowCount: rows.filter((x) => x.isLow).length,
    byCategory: group('category'),
    byLocation: group('location'),
  };
}

// ---------------------------------------------------------------------------
// 单据号:PO-20261003-0001 / GRN-20261003-0001 / TR-20261003-0001
// 取当天已有单据的最大流水 +1,预览与生产同一口径。
// ---------------------------------------------------------------------------
export function makeDocNo(prefix, existingNos, date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const base = `${prefix}-${stamp}-`;
  let max = 0;
  for (const n of existingNos || []) {
    const s = String(n || '');
    if (!s.startsWith(base)) continue;
    const k = parseInt(s.slice(base.length), 10);
    if (Number.isFinite(k) && k > max) max = k;
  }
  return `${base}${String(max + 1).padStart(4, '0')}`;
}

/** 采购单状态推进:根据各行已收数量推导。 */
export function derivePoStatus(lines, current) {
  if (current === 'cancelled') return 'cancelled';
  const list = lines || [];
  if (!list.length) return current === 'draft' ? 'draft' : current;
  const anyReceived = list.some((l) => num(l.receivedQty) > 0);
  const allReceived = list.every((l) => num(l.receivedQty) >= num(l.qty));
  if (allReceived) return 'received';
  if (anyReceived) return 'partial';
  return current === 'draft' ? 'draft' : 'approved';
}
