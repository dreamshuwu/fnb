// 报表计算引擎(前后端共用逻辑的核心)。
// 两个后端只负责把各自的数据源(内存 store / MySQL)整理成统一 dataset,
// 具体的分组、汇总、日期过滤全部在这里完成 —— 保证开发预览与生产环境报表口径一致。
import { getReport } from './reportCatalog.js';

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const dayKey = (d) => String(d || '').slice(0, 10);
const monthKey = (d) => String(d || '').slice(0, 7);

/** 把 from/to(YYYY-MM-DD) 转成闭区间时间范围。 */
export function rangeBounds(from, to) {
  return {
    f: from ? new Date(`${from}T00:00:00`) : null,
    t: to ? new Date(`${to}T23:59:59.999`) : null,
  };
}

/** 生成日期过滤器;无 from/to 时恒为 true。 */
export function makeFilter(from, to) {
  const { f, t } = rangeBounds(from, to);
  return (d) => {
    if (!f && !t) return true;
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return true; // 无日期的记录不因区间被丢弃
    if (f && x < f) return false;
    if (t && x > t) return false;
    return true;
  };
}

/** 按 key 分组累加若干数值列。 */
function groupSum(list, keyFn, numFields) {
  const map = new Map();
  for (const r of list) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    let acc = map.get(k);
    if (!acc) { acc = {}; for (const f of numFields) acc[f] = 0; acc._key = k; map.set(k, acc); }
    for (const f of numFields) acc[f] += Number(r[f] || 0);
  }
  return [...map.values()];
}

/** 报表主金额列(用于顶部 KPI 合计)。 */
const TOTAL_COLUMN = {
  sales_by_date: 'net', sales_by_product: 'amount', sales_by_category: 'amount', sales_by_department: 'amount',
  sales_by_payment: 'amount', sales_by_hour: 'total', sales_by_cashier: 'total', sales_by_salesperson: 'total',
  sales_by_table: 'total', sales_by_member: 'total', sales_by_discount: 'discount', top_products: 'amount',
  bottom_products: 'amount', avg_spend: 'net', sales_trend_7day: 'total', monthly_sales: 'total',
  order_list: 'total', void_report: 'total', void_by_user: 'amount', refund_report: 'amount',
  refund_by_reason: 'amount', discount_report: 'discount', unsettle_report: 'amount',
  credit_note: 'total', credit_note_detail: 'subtotal', tax_invoice_list: 'total',
  cash_bill: 'amount', payout: 'amount', cash_movement: 'amount', close_shift: 'closeAmount',
  shift_variance: 'difference', gst_summary: 'outputTax', gst_detail: 'total',
  member_list: 'creditBalance', member_points: 'creditBalance', member_topup: 'amount',
  stock_valuation: 'value', purchase_summary: 'total', purchase_by_supplier: 'total',
  cashier_performance: 'total', day_end_history: 'countedCash',
};

/**
 * 执行报表。
 * @param {string} type 报表 key(见 reportCatalog)
 * @param {object} ds   统一数据集
 * @param {{from?:string,to?:string}} opts
 * @returns {{type:string, rows:object[], total:number, count:number, from:string|null, to:string|null}}
 */
export function runReport(type, ds, opts = {}) {
  const from = opts.from || null;
  const to = opts.to || null;
  const inRange = makeFilter(from, to);
  const rows = computeRows(type, ds, inRange, { from, to });
  const totalKey = TOTAL_COLUMN[type];
  const total = totalKey ? round2(rows.reduce((s, r) => s + Number(r[totalKey] || 0), 0)) : 0;
  return { type, rows, total, count: rows.length, from, to };
}

function computeRows(type, ds, inRange, range) {
  const orders = ds.orders || [];
  const paid = orders.filter((o) => (o.status === 'paid' || o.status === 'refunded') && inRange(o.createdAt));
  const itemsOf = (list) => list.flatMap((o) => (o.items || []).map((i) => ({ ...i, __order: o })));

  switch (type) {
    // ---------------------------------------------------------- Sales
    case 'sales_by_date': {
      return groupSum(paid, (o) => dayKey(o.createdAt), ['subtotal', 'discount', 'serviceCharge', 'tax', 'total'])
        .map((g) => ({
          date: g._key,
          orders: paid.filter((o) => dayKey(o.createdAt) === g._key).length,
          gross: round2(g.subtotal),
          discount: round2(g.discount),
          serviceCharge: round2(g.serviceCharge),
          tax: round2(g.tax),
          net: round2(g.total),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    case 'sales_by_product': {
      return groupSum(itemsOf(paid), (i) => i.code || i.name, ['qty', 'amount'])
        .map((g) => ({ code: g._key, name: (itemsOf(paid).find((i) => (i.code || i.name) === g._key) || {}).name || g._key, qty: g.qty, amount: round2(g.amount) }))
        .sort((a, b) => b.amount - a.amount);
    }
    case 'sales_by_category': {
      const its = itemsOf(paid);
      return groupSum(its, (i) => i.category || 'Uncategorised', ['qty', 'amount'])
        .map((g) => ({ category: g._key, qty: g.qty, amount: round2(g.amount) }))
        .sort((a, b) => b.amount - a.amount);
    }
    case 'sales_by_department': {
      const its = itemsOf(paid);
      return groupSum(its, (i) => i.station || i.category || 'Kitchen', ['qty', 'amount'])
        .map((g) => ({ department: g._key, qty: g.qty, amount: round2(g.amount) }))
        .sort((a, b) => b.amount - a.amount);
    }
    case 'sales_by_payment': {
      const pays = (ds.payments || []).filter((p) => inRange(p.createdAt));
      return groupSum(pays, (p) => p.method || 'other', ['amount'])
        .map((g) => ({ method: g._key, count: pays.filter((p) => (p.method || 'other') === g._key).length, amount: round2(g.amount) }))
        .sort((a, b) => b.amount - a.amount);
    }
    case 'sales_by_hour': {
      return groupSum(paid, (o) => `${String(new Date(o.createdAt).getHours()).padStart(2, '0')}:00`, ['total'])
        .map((g) => ({ hour: g._key, orders: paid.filter((o) => `${String(new Date(o.createdAt).getHours()).padStart(2, '0')}:00` === g._key).length, total: round2(g.total) }))
        .sort((a, b) => a.hour.localeCompare(b.hour));
    }
    case 'sales_by_cashier':
      return groupSum(paid, (o) => o.cashierName || 'Unknown', ['total'])
        .map((g) => ({ cashier: g._key, orders: paid.filter((o) => (o.cashierName || 'Unknown') === g._key).length, total: round2(g.total) }))
        .sort((a, b) => b.total - a.total);
    case 'sales_by_salesperson':
      return groupSum(paid, (o) => o.salesPersonName || o.cashierName || 'Unknown', ['total'])
        .map((g) => ({ salesperson: g._key, orders: paid.filter((o) => (o.salesPersonName || o.cashierName || 'Unknown') === g._key).length, total: round2(g.total) }))
        .sort((a, b) => b.total - a.total);
    case 'sales_by_table':
      return groupSum(paid, (o) => o.tableNo || (o.type === 'takeaway' ? 'Takeaway' : 'Walk-in'), ['total'])
        .map((g) => ({ table: g._key, orders: paid.filter((o) => (o.tableNo || (o.type === 'takeaway' ? 'Takeaway' : 'Walk-in')) === g._key).length, total: round2(g.total) }))
        .sort((a, b) => b.total - a.total);
    case 'sales_by_member':
      return groupSum(paid.filter((o) => o.memberNo), (o) => o.memberNo, ['total'])
        .map((g) => {
          const o = paid.find((x) => x.memberNo === g._key) || {};
          return { memberNo: g._key, name: o.memberName || '', orders: paid.filter((x) => x.memberNo === g._key).length, total: round2(g.total) };
        })
        .sort((a, b) => b.total - a.total);
    case 'sales_by_discount':
      return groupSum(paid.filter((o) => Number(o.discount) > 0), (o) => o.discountType || 'Manual / Other', ['discount'])
        .map((g) => ({ type: g._key, orders: paid.filter((o) => Number(o.discount) > 0 && (o.discountType || 'Manual / Other') === g._key).length, discount: round2(g.discount) }))
        .sort((a, b) => b.discount - a.discount);
    case 'top_products':
    case 'bottom_products': {
      const its = itemsOf(paid);
      const all = groupSum(its, (i) => i.code || i.name, ['qty', 'amount'])
        .map((g) => ({ code: g._key, name: (its.find((i) => (i.code || i.name) === g._key) || {}).name || g._key, qty: g.qty, amount: round2(g.amount) }));
      return type === 'top_products'
        ? all.sort((a, b) => b.qty - a.qty).slice(0, 10)
        : all.sort((a, b) => a.qty - b.qty).slice(0, 10);
    }
    case 'avg_spend':
      return groupSum(paid, (o) => dayKey(o.createdAt), ['total'])
        .map((g) => {
          const n = paid.filter((o) => dayKey(o.createdAt) === g._key).length;
          return { date: g._key, orders: n, net: round2(g.total), avgSpend: n ? round2(g.total / n) : 0 };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
    case 'sales_trend_7day': {
      const anchor = range.to ? new Date(`${range.to}T00:00:00`) : new Date();
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(anchor); d.setDate(d.getDate() - i);
        days.push(dayKey(d.toISOString()));
      }
      return days.map((d) => {
        const list = paid.filter((o) => dayKey(o.createdAt) === d);
        return { date: d, orders: list.length, total: round2(list.reduce((s, o) => s + Number(o.total || 0), 0)) };
      });
    }
    case 'monthly_sales':
      return groupSum(paid, (o) => monthKey(o.createdAt), ['total'])
        .map((g) => ({ month: g._key, orders: paid.filter((o) => monthKey(o.createdAt) === g._key).length, total: round2(g.total) }))
        .sort((a, b) => a.month.localeCompare(b.month));

    // ---------------------------------------------------------- Transactions
    case 'order_list':
      return orders.filter((o) => inRange(o.createdAt)).map((o) => ({
        orderNo: o.orderNo, date: o.createdAt,
        type: o.type || 'dine_in', table: o.tableNo || '-', status: o.status,
        subtotal: round2(o.subtotal), discount: round2(o.discount), tax: round2(o.tax), total: round2(o.total),
      })).sort((a, b) => new Date(b.date) - new Date(a.date));
    case 'void_report':
      return orders.filter((o) => (o.status === 'void' || o.status === 'void_pending') && inRange(o.createdAt))
        .map((o) => ({ orderNo: o.orderNo, date: o.createdAt, reason: o.voidReason || '', status: o.status, total: round2(o.total) }));
    case 'void_by_user':
      return groupSum(orders.filter((o) => o.status === 'void' && inRange(o.createdAt)), (o) => o.cashierName || 'Unknown', ['total'])
        .map((g) => ({ cashier: g._key, count: orders.filter((o) => o.status === 'void' && inRange(o.createdAt) && (o.cashierName || 'Unknown') === g._key).length, amount: round2(g.total) }));
    case 'refund_report':
      return (ds.refunds || []).filter((r) => inRange(r.createdAt))
        .map((r) => ({ refundNo: r.refundNo, orderNo: r.orderNo, date: r.createdAt, amount: round2(r.amount), method: r.method, reason: r.reason }));
    case 'refund_by_reason':
      return groupSum((ds.refunds || []).filter((r) => inRange(r.createdAt)), (r) => r.reason || 'Unspecified', ['amount'])
        .map((g) => ({ reason: g._key, count: (ds.refunds || []).filter((r) => inRange(r.createdAt) && (r.reason || 'Unspecified') === g._key).length, amount: round2(g.amount) }));
    case 'discount_report':
      return paid.filter((o) => Number(o.discount) > 0)
        .map((o) => ({ orderNo: o.orderNo, date: o.createdAt, subtotal: round2(o.subtotal), discount: round2(o.discount), total: round2(o.total) }));
    case 'unsettle_report':
      return (ds.unsettles || []).filter((u) => inRange(u.createdAt))
        .map((u) => ({ orderNo: u.orderNo, date: u.createdAt, amount: round2(u.amount), reason: u.reason || '' }));
    case 'reprint_log':
      return (ds.reprintLogs || []).filter((l) => inRange(l.createdAt || l.at))
        .map((l) => ({ orderNo: l.orderNo, kind: l.kind, date: l.createdAt || l.at }));
    case 'transfer_log':
      return (ds.orderTransfers || []).filter((t) => inRange(t.createdAt)).map((t) => ({
        date: t.createdAt,
        type: t.type,
        orderNo: t.orderNo,
        fromTableNo: t.fromTableNo || '-',
        toTableNo: t.toTableNo || '-',
        mergedOrderNos: (t.mergedOrderNos || []).join(', ') || '-',
        amount: round2(t.amount),
        user: t.createdByName || '-',
      }));
    case 'credit_note':
      return (ds.creditNotes || []).filter((c) => inRange(c.createdAt))
        .map((c) => ({ creditNo: c.creditNo, customerName: c.customerName || '-', orderNo: c.orderNo || '-', reason: c.reason || '', total: round2(c.total), status: c.status }));
    case 'credit_note_detail': {
      const out = [];
      for (const c of (ds.creditNotes || []).filter((x) => inRange(x.createdAt))) {
        for (const l of c.items || []) {
          out.push({
            creditNo: c.creditNo, code: l.code || '', description: l.description || '',
            qty: Number(l.qty || 0), uom: l.uom || 'pcs',
            retail: round2(l.retail), subtotal: round2(Number(l.qty || 0) * Number(l.retail || 0)),
          });
        }
      }
      return out;
    }
    case 'tax_invoice_list': {
      const byOrder = new Map(orders.map((o) => [String(o.id), o]));
      return (ds.invoices || []).filter((v) => inRange(v.createdAt)).map((v) => {
        const o = byOrder.get(String(v.orderId)) || {};
        return {
          invoiceNo: v.invoiceNo, orderNo: o.orderNo || '-', date: v.createdAt,
          taxable: round2(Number(v.amount || 0) - Number(v.tax || 0)), tax: round2(v.tax), total: round2(v.amount),
        };
      });
    }

    // ---------------------------------------------------------- Cash
    case 'cash_bill': {
      const byOrder = new Map(orders.map((o) => [String(o.id), o]));
      return (ds.payments || []).filter((p) => inRange(p.createdAt))
        .map((p) => ({ orderNo: (byOrder.get(String(p.orderId)) || {}).orderNo || '-', method: p.method, amount: round2(p.amount), date: p.createdAt }));
    }
    case 'payout':
      return (ds.cashMovements || []).filter((m) => ['payout', 'withdraw'].includes(m.type) && inRange(m.createdAt))
        .map((m) => ({ voucherNo: m.voucherNo, payTo: m.payTo || '-', amount: round2(m.amount), reason: m.reason || '', date: m.createdAt }));
    case 'cash_movement':
      return (ds.cashMovements || []).filter((m) => inRange(m.createdAt))
        .map((m) => ({ type: m.type, voucherNo: m.voucherNo, amount: round2(m.amount), date: m.createdAt }));
    case 'close_shift':
      return (ds.shifts || []).filter((s) => inRange(s.openedAt))
        .map((s) => ({ shiftId: s.id, openedAt: s.openedAt, closedAt: s.closedAt, openAmount: round2(s.openAmount), expectedAmount: round2(s.expectedAmount), closeAmount: round2(s.closeAmount), difference: round2(s.difference), status: s.status }));
    case 'shift_variance':
      return (ds.shifts || []).filter((s) => s.closedAt && inRange(s.closedAt))
        .map((s) => ({ shiftId: s.id, closedAt: s.closedAt, expectedAmount: round2(s.expectedAmount), closeAmount: round2(s.closeAmount), difference: round2(s.difference) }));

    // ---------------------------------------------------------- GST
    case 'gst_summary': {
      const s = ds.settings || {};
      const outputTax = round2(paid.reduce((x, o) => x + Number(o.tax || 0), 0));
      const rate = Number(s.taxRate || 0);
      const refunded = (ds.refunds || []).filter((r) => inRange(r.createdAt)).reduce((x, r) => x + Number(r.amount || 0), 0);
      const refundTax = rate ? round2(refunded * (rate / (100 + rate))) : 0;
      return [{
        taxableSales: round2(paid.reduce((x, o) => x + Number(o.total || 0), 0)),
        taxRate: rate,
        outputTax: round2(outputTax - refundTax),
        invoices: (ds.invoices || []).filter((v) => inRange(v.createdAt)).length,
      }];
    }
    case 'gst_detail':
      return groupSum(paid, (o) => dayKey(o.createdAt), ['total', 'tax'])
        .map((g) => ({ date: g._key, taxable: round2(g.total - g.tax), tax: round2(g.tax), total: round2(g.total) }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // ---------------------------------------------------------- Members
    case 'member_list':
      return (ds.members || []).map((m) => ({ memberNo: m.memberNo, name: m.name, phone: m.phone || '-', points: Number(m.points || 0), creditBalance: round2(m.creditBalance) }));
    case 'member_points':
      return (ds.members || []).map((m) => ({ memberNo: m.memberNo, name: m.name, points: Number(m.points || 0), creditBalance: round2(m.creditBalance) }))
        .sort((a, b) => b.points - a.points);
    case 'member_topup': {
      const byId = new Map((ds.members || []).map((m) => [String(m.id), m]));
      return (ds.memberTopups || []).filter((t) => inRange(t.createdAt))
        .map((t) => ({ receiptNo: t.receiptNo || '-', memberNo: (byId.get(String(t.memberId)) || {}).memberNo || '-', amount: round2(t.amount), date: t.createdAt }));
    }
    case 'member_ledger': {
      const byId = new Map((ds.members || []).map((m) => [String(m.id), m]));
      return (ds.pointsLedger || []).filter((p) => inRange(p.createdAt))
        .map((p) => ({ memberNo: (byId.get(String(p.memberId)) || {}).memberNo || '-', type: p.reason || p.type || 'adjust', points: Number(p.delta ?? p.points ?? 0), date: p.createdAt }));
    }

    // ---------------------------------------------------------- Stock
    case 'stock_report':
      return (ds.variants || []).map((v) => ({ code: v.code, name: v.name, stockQty: Number(v.stockQty || 0), stockThreshold: Number(v.stockThreshold || 0) }));
    case 'stock_alert':
      return (ds.variants || []).filter((v) => Number(v.stockQty || 0) < Number(v.stockThreshold || 0))
        .map((v) => ({ code: v.code, name: v.name, stockQty: Number(v.stockQty || 0), stockThreshold: Number(v.stockThreshold || 0), shortage: Number(v.stockThreshold || 0) - Number(v.stockQty || 0) }));
    case 'stock_valuation':
      return (ds.variants || []).map((v) => ({ code: v.code, name: v.name, stockQty: Number(v.stockQty || 0), cost: round2(v.cost), value: round2(Number(v.stockQty || 0) * Number(v.cost || 0)) }))
        .sort((a, b) => b.value - a.value);
    case 'customer_stock':
      return (ds.customerStock || []).map((c) => ({ memberNo: c.memberNo || '-', itemName: c.itemName, qty: Number(c.qty || 0), unit: c.unit || 'pcs' }));
    case 'stock_take':
      return (ds.stockTakes || []).filter((s) => inRange(s.createdAt))
        .map((s) => ({ ref: s.takeNo || s.id, date: s.createdAt, lines: (s.lines || []).length, status: s.status }));

    // ---------------------------------------------------------- Purchase
    case 'purchase_summary': {
      const sup = new Map((ds.suppliers || []).map((s) => [String(s.id), s]));
      return (ds.purchaseOrders || []).filter((p) => inRange(p.createdAt))
        .map((p) => ({ poNo: p.poNo, supplier: (sup.get(String(p.supplierId)) || {}).name || '-', date: p.createdAt, total: round2(p.total), status: p.status }));
    }
    case 'purchase_by_supplier': {
      const sup = new Map((ds.suppliers || []).map((s) => [String(s.id), s]));
      const list = (ds.purchaseOrders || []).filter((p) => inRange(p.createdAt));
      return groupSum(list, (p) => (sup.get(String(p.supplierId)) || {}).name || 'Unknown', ['total'])
        .map((g) => ({ supplier: g._key, orders: list.filter((p) => ((sup.get(String(p.supplierId)) || {}).name || 'Unknown') === g._key).length, total: round2(g.total) }))
        .sort((a, b) => b.total - a.total);
    }

    // ---------------------------------------------------------- Staff
    case 'attendance_report':
      return (ds.attendance || []).filter((a) => inRange(a.time))
        .map((a) => ({ code: a.code || '-', name: a.userName, action: a.action, time: a.time }));
    case 'cashier_performance':
      return groupSum(paid, (o) => o.cashierName || 'Unknown', ['total'])
        .map((g) => {
          const n = paid.filter((o) => (o.cashierName || 'Unknown') === g._key).length;
          return { cashier: g._key, orders: n, total: round2(g.total), avgSpend: n ? round2(g.total / n) : 0 };
        })
        .sort((a, b) => b.total - a.total);

    // ---------------------------------------------------------- Day End
    case 'day_end_history':
      return (ds.dayEnds || []).filter((d) => inRange(d.date)).map((d) => ({
        date: d.date, expectedCash: round2(d.expectedCash), countedCash: round2(d.countedCash),
        difference: round2(d.difference), closedAt: d.closedAt,
      }));

    default:
      return paid.map((o) => ({
        orderNo: o.orderNo, date: o.createdAt, subtotal: round2(o.subtotal),
        discount: round2(o.discount), tax: round2(o.tax), total: round2(o.total), status: o.status,
      }));
  }
}

/** 报表标题(用于导出文件名与打印页)。 */
export function reportTitle(type) {
  const d = getReport(type);
  return d ? d.label : type;
}
