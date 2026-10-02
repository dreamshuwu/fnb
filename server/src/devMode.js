// 开发预览模式(免 MySQL):当 DEV_NO_DB=1 时启用。
// 用内存假数据实现前端所需的全部接口 + Socket.IO KDS,不改变生产 MySQL 路径。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { signTokens, JWT_SECRET } from './middleware/auth.js';

const store = {
  users: [], categories: [], bases: [], modifiers: [], baseModifiers: [], variants: [],
  tables: [], orders: [], inventory: [], payments: [],
  members: [], memberTopups: [], pointsLedger: [], cashMovements: [], creditNotes: [],
  attendance: [], shifts: [], suppliers: [], purchaseOrders: [], settings: [], seq: 1,
  // 新增：Split Bill / Refund / Void / 促销 / 客户库存 / 盘点 / 报表设计器 / 硬件
  orderSplits: [], refunds: [], promotions: [], customerStock: [], stockTakes: [],
  reportTemplates: [], printJobs: [], printers: [], invoices: [],
  // 新增：挂单 / 反结算 / 重打
  unsettles: [], reprintLogs: [],
  // 新增：日结
  dayEnds: [],
};
const nid = () => String(store.seq++);
const now = () => new Date().toISOString();

// ---- 种子数据（kopitiam 风格，演示用；后台可改） ----
const CATS = [
  ['KOPI', '#7c3aed', 1], ['TEH', '#f97316', 2], ['SUSU', '#eab308', 3], ['MILO', '#ec4899', 4],
  ['NESCAFE', '#14b8a6', 5], ['OTHER', '#64748b', 6], ['FRESH', '#06b6d4', 7],
  ['CAN DRINK', '#3b82f6', 8], ['BEER', '#d97706', 9],
];
const DRINK_BASES = [
  ['Kopi', 'KOPI', 3.0], ['Teh', 'TEH', 3.0], ['Susu', 'SUSU', 2.4], ['Milo', 'MILO', 3.8], ['Nescafe', 'NESCAFE', 3.8],
];
const BASE_SHORT = { Kopi: 'KOPI', Teh: 'TEH', Susu: 'SUSU', Milo: 'MILO', Nescafe: 'NESCAFE' };
const SINGLE_BASES = [
  ['Dunhill PROMO', 'OTHER', 18.2], ['Marlboro', 'OTHER', 14.2], ['Mevius', 'OTHER', 18.4],
  ['Heineken', 'BEER', 9.0], ['Tiger tin', 'BEER', 8.0], ['Carlsberg Big', 'BEER', 16.0],
  ['Honey Lemongrass', 'FRESH', 2.5], ['Cucumber Juice', 'FRESH', 6.0],
  ['100plus', 'CAN DRINK', 3.2], ['Cola', 'CAN DRINK', 3.2], ['Sarsi', 'CAN DRINK', 3.2],
];
const MODIFIERS = [
  ['O', 'Kosong 无糖', -0.4, 1], ['KOS', '无奶', -0.3, 2], ['C', 'Kurang 少糖', -0.2, 3],
  ['P', 'Peng 冰', 0.5, 4], ['K', 'Kow 浓', 0.1, 5], ['SP', 'Special', 0.6, 6],
  ['SUSU', '加奶', 0.3, 7], ['Tarik', '拉', 0.4, 8], ['DANGGUT', '', 0.1, 9],
];

function seedDev() {
  if (store.users.length) return;
  const demo = [
    ['1000000000', 'Admin', 'admin', 'admin123'],
    ['1000000001', 'Manager', 'manager', 'manager123'],
    ['1000000002', 'Cashier', 'cashier', 'cashier123'],
    ['1000000003', 'Waiter', 'waiter', 'waiter123'],
    ['1000000004', 'Kitchen', 'kitchen', 'kitchen123'],
  ];
  for (const [phone, name, role, pw] of demo) {
    store.users.push({ id: nid(), orgId: '1', storeId: '1', name, phone, role, password: bcrypt.hashSync(pw, 10), isActive: true });
  }
  const catIds = {};
  for (const [name, color, sort] of CATS) {
    const id = nid();
    store.categories.push({ id, orgId: '1', storeId: '1', name, color, sortOrder: sort, isActive: true });
    catIds[name] = id;
  }
  const baseIds = {};
  for (const [name, cat, price] of DRINK_BASES) {
    const id = nid();
    store.bases.push({ id, orgId: '1', storeId: '1', categoryId: catIds[cat], name, basePrice: price, sortOrder: 1, isActive: true });
    baseIds[name] = id;
  }
  for (const [name, cat, price] of SINGLE_BASES) {
    const id = nid();
    store.bases.push({ id, orgId: '1', storeId: '1', categoryId: catIds[cat], name, basePrice: price, sortOrder: 1, isActive: true });
    baseIds[name] = id;
  }
  const modIds = {};
  for (const [code, label, delta, sort] of MODIFIERS) {
    const id = nid();
    store.modifiers.push({ id, orgId: '1', storeId: '1', code, label, defaultDelta: delta, sortOrder: sort, isActive: true });
    modIds[code] = id;
  }
  for (const [bname] of DRINK_BASES) {
    for (const [code] of MODIFIERS) {
      store.baseModifiers.push({ id: nid(), orgId: '1', storeId: '1', baseId: baseIds[bname], modifierId: modIds[code], delta: null });
    }
  }
  let vsort = 1;
  const addVar = (baseId, cat, code, name, price) => {
    store.variants.push({
      id: nid(), orgId: '1', storeId: '1', baseId, categoryId: catIds[cat], code, name,
      modifierIds: [], price, cost: +(price * 0.4).toFixed(2), stockQty: 50, stockThreshold: 10, barcode: null, sortOrder: vsort++, isActive: true,
    });
  };
  for (const [name, cat, price] of DRINK_BASES) {
    const baseId = baseIds[name]; const short = BASE_SHORT[name];
    addVar(baseId, cat, short, name, price);
    for (const [code, label, delta] of MODIFIERS) {
      const vprice = +(price + delta).toFixed(2);
      const vcode = `${short} ${code}`;
      const vname = label ? `${name} ${label}` : `${name} ${code}`;
      addVar(baseId, cat, vcode, vname, vprice);
    }
  }
  for (const [name, cat, price] of SINGLE_BASES) addVar(baseIds[name], cat, name, name, price);

  store.inventory.push({ id: nid(), orgId: '1', storeId: '1', name: '咖啡豆', unit: 'kg', quantity: 5, threshold: 2, costPrice: 80 });
  store.inventory.push({ id: nid(), orgId: '1', storeId: '1', name: '杯子', unit: '个', quantity: 200, threshold: 50, costPrice: 0.5 });

  for (const n of ['A1', 'A2', 'B1']) {
    store.tables.push({ id: nid(), orgId: '1', storeId: '1', number: n, zone: '大厅', seats: 4, status: 'free', currentOrderId: null });
  }
  store.members.push({ id: nid(), orgId: '1', storeId: '1', memberNo: 'M0001', name: 'Demo Member', phone: '0123456789', creditBalance: 0, points: 120, status: 'active', createdAt: now() });
  store.suppliers.push({ id: nid(), orgId: '1', storeId: '1', code: 'SUP-001', name: 'Demo Supplier', phone: '', contact: '', status: 'active', createdAt: now() });
  store.shifts.push({ id: nid(), orgId: '1', storeId: '1', cashierId: '3', openAmount: 0, expectedAmount: 0, closeAmount: 0, difference: 0, status: 'open', openedAt: now(), closedAt: null });
  store.settings.push({ id: nid(), orgId: '1', storeId: '1', key: 'taxRate', value: 0 });

  // ---- 默认门店设置（GST / 发票 / 服务费 / 硬件） ----
  const DEFAULTS = {
    companyName: 'Kopitiam Demo Sdn Bhd',
    address: 'No. 1, Jalan Demo, 50000 Kuala Lumpur',
    phone: '03-1234 5678',
    gstNo: 'GST-000123456789',
    taxRate: 6,
    taxInclusive: true,
    serviceChargeRate: 0,
    invoicePrefix: 'INV',
    currency: '¥',
    receiptFooter: 'Thank you, please come again!',
    roundTo5cent: false,
  };
  for (const [key, value] of Object.entries(DEFAULTS)) store.settings.push({ id: nid(), orgId: '1', storeId: '1', key, value });

  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Counter Receipt', target: 'receipt', connection: 'usb', width: 80, isDefault: true, isActive: true });
  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Kitchen Printer', target: 'kitchen', connection: 'lan', width: 80, isDefault: false, isActive: true });
  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Bar Printer', target: 'bar', connection: 'lan', width: 58, isDefault: false, isActive: true });
  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Office A4', target: 'a4', connection: 'system', width: 210, isDefault: false, isActive: true });

  store.promotions.push({ id: nid(), orgId: '1', storeId: '1', code: 'HAPPY10', name: 'Happy Hour 10%', type: 'percent', value: 10, minSpend: 20, validFrom: null, validUntil: null, isActive: true, createdAt: now() });
  store.promotions.push({ id: nid(), orgId: '1', storeId: '1', code: 'RM2OFF', name: 'RM2 Off', type: 'amount', value: 2, minSpend: 10, validFrom: null, validUntil: null, isActive: true, createdAt: now() });

  store.customerStock.push({ id: nid(), orgId: '1', storeId: '1', memberId: '1', memberNo: 'M0001', itemName: 'Heineken', qty: 6, unit: 'btl', note: 'Member kept stock', createdAt: now() });

  for (const t of [
    ['sales_by_date', 'Sales By Date', ['orderNo', 'date', 'subtotal', 'discount', 'tax', 'total']],
    ['sales_by_product', 'Sales By Product', ['code', 'name', 'qty', 'amount']],
    ['sales_by_payment', 'Sales By Payment Type', ['method', 'amount']],
    ['sales_by_cashier', 'Sales By Cashier', ['cashier', 'orders', 'total']],
    ['sales_by_table', 'Sales By Table', ['table', 'orders', 'total']],
    ['void_report', 'Void / Cancellation', ['orderNo', 'date', 'reason', 'status', 'total']],
    ['refund_report', 'Refund Report', ['refundNo', 'orderNo', 'date', 'amount', 'method', 'reason']],
    ['stock_report', 'Stock Report', ['name', 'code', 'stockQty', 'stockThreshold']],
  ]) {
    store.reportTemplates.push({ id: nid(), orgId: '1', storeId: '1', type: t[0], name: t[1], columns: t[2], isSystem: true, createdAt: now() });
  }
}

// ---- mappers(与 db.js 输出保持一致,前端按这些字段渲染) ----
const toUser = (u) => ({ id: u.id, _id: u.id, name: u.name, phone: u.phone, role: u.role, orgId: u.orgId, storeId: u.storeId });
const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, orgId: u.orgId, storeId: u.storeId, phone: u.phone });
const toMenuCategory = (c) => ({ _id: c.id, id: c.id, orgId: c.orgId, storeId: c.storeId, name: c.name, color: c.color || null, sortOrder: c.sortOrder, isActive: !!c.isActive, createdAt: now(), updatedAt: now() });
const toMenuBase = (b) => ({ _id: b.id, id: b.id, orgId: b.orgId, storeId: b.storeId, categoryId: b.categoryId == null ? null : String(b.categoryId), name: b.name, basePrice: Number(b.basePrice || 0), sortOrder: b.sortOrder, isActive: !!b.isActive, createdAt: now(), updatedAt: now() });
const toModifier = (m) => ({ _id: m.id, id: m.id, orgId: m.orgId, storeId: m.storeId, code: m.code, label: m.label, defaultDelta: Number(m.defaultDelta || 0), sortOrder: m.sortOrder, isActive: !!m.isActive, createdAt: now(), updatedAt: now() });
const toBaseModifier = (bm) => ({ _id: bm.id, id: bm.id, orgId: bm.orgId, storeId: bm.storeId, baseId: String(bm.baseId), modifierId: String(bm.modifierId), delta: bm.delta == null ? null : Number(bm.delta), createdAt: now(), updatedAt: now() });
const toVariant = (v) => ({
  _id: v.id, id: v.id, orgId: v.orgId, storeId: v.storeId, baseId: String(v.baseId),
  categoryId: v.categoryId == null ? null : String(v.categoryId), code: v.code, name: v.name,
  modifierIds: v.modifierIds || [], price: Number(v.price || 0), cost: Number(v.cost || 0),
  stockQty: Number(v.stockQty || 0), stockThreshold: Number(v.stockThreshold || 0),
  barcode: v.barcode || null, sortOrder: v.sortOrder, isActive: !!v.isActive, createdAt: now(), updatedAt: now(),
});
const toTable = (t) => ({
  _id: t.id, id: t.id, orgId: t.orgId, storeId: t.storeId, number: t.number, zone: t.zone, seats: t.seats,
  status: t.status, currentOrderId: t.currentOrderId == null ? null : String(t.currentOrderId), createdAt: now(), updatedAt: now(),
});
const toInventoryItem = (inv) => ({
  _id: inv.id, id: inv.id, orgId: inv.orgId, storeId: inv.storeId, name: inv.name, unit: inv.unit,
  quantity: Number(inv.quantity || 0), threshold: Number(inv.threshold || 0),
  costPrice: inv.costPrice == null ? null : Number(inv.costPrice), createdAt: now(), updatedAt: now(),
});
const toOrder = (o) => ({
  _id: o.id, id: o.id, orgId: o.orgId, storeId: o.storeId, orderNo: o.orderNo, type: o.type,
  tableId: o.tableId == null ? null : String(o.tableId), customerName: o.customerName, phone: o.phone, status: o.status,
  items: o.items || [], subtotal: Number(o.subtotal || 0), discount: Number(o.discount || 0), tax: Number(o.tax || 0), total: Number(o.total || 0),
  serviceCharge: Number(o.serviceCharge || 0), refundedAmount: Number(o.refundedAmount || 0), invoiceNo: o.invoiceNo || null,
  splitFromOrderId: o.splitFromOrderId == null ? null : String(o.splitFromOrderId), splitGroupNo: o.splitGroupNo ?? null,
  holdLabel: o.holdLabel || null, heldAt: o.heldAt || null, reprintCount: Number(o.reprintCount || 0),
  unsettledAt: o.unsettledAt || null,
  createdBy: o.createdBy == null ? null : String(o.createdBy), shiftId: o.shiftId == null ? null : String(o.shiftId),
  voidRequestedBy: o.voidRequestedBy == null ? null : String(o.voidRequestedBy), voidApprovedBy: o.voidApprovedBy == null ? null : String(o.voidApprovedBy), voidReason: o.voidReason || null,
  createdAt: o.createdAt, updatedAt: o.updatedAt || o.createdAt,
});
const toMember = (m) => ({ _id: m.id, id: m.id, memberNo: m.memberNo, name: m.name, phone: m.phone, creditBalance: Number(m.creditBalance || 0), points: Number(m.points || 0), status: m.status, createdAt: m.createdAt });
const toMovement = (m) => ({ _id: m.id, id: m.id, type: m.type, voucherNo: m.voucherNo, payTo: m.payTo, amount: Number(m.amount || 0), reason: m.reason, method: m.method, createdBy: m.createdBy, createdAt: m.createdAt });
const toAttendance = (a) => ({ _id: a.id, id: a.id, userId: a.userId, userName: a.userName, action: a.action, code: a.code, time: a.time, note: a.note || '' });
const toShift = (s) => ({ _id: s.id, id: s.id, cashierId: s.cashierId, openAmount: Number(s.openAmount || 0), expectedAmount: Number(s.expectedAmount || 0), closeAmount: Number(s.closeAmount || 0), difference: Number(s.difference || 0), status: s.status, openedAt: s.openedAt, closedAt: s.closedAt });
const toSupplier = (s) => ({ _id: s.id, id: s.id, code: s.code, name: s.name, phone: s.phone, contact: s.contact, status: s.status, createdAt: s.createdAt });
const toRefund = (r) => ({ _id: r.id, id: r.id, refundNo: r.refundNo, orderId: String(r.orderId), orderNo: r.orderNo, amount: Number(r.amount || 0), method: r.method || 'cash', reason: r.reason || '', items: r.items || [], restock: !!r.restock, createdBy: r.createdBy, createdAt: r.createdAt });
const toPromotion = (p) => ({ _id: p.id, id: p.id, code: p.code, name: p.name, type: p.type, value: Number(p.value || 0), minSpend: Number(p.minSpend || 0), validFrom: p.validFrom || null, validUntil: p.validUntil || null, isActive: !!p.isActive, createdAt: p.createdAt });
const toCustomerStock = (c) => ({ _id: c.id, id: c.id, memberId: String(c.memberId), memberNo: c.memberNo, itemName: c.itemName, qty: Number(c.qty || 0), unit: c.unit || 'pcs', note: c.note || '', createdAt: c.createdAt });
const toStockTake = (s) => ({ _id: s.id, id: s.id, takeNo: s.takeNo, status: s.status, lines: s.lines || [], createdBy: s.createdBy, createdAt: s.createdAt, postedAt: s.postedAt || null });
const toReportTemplate = (t) => ({ _id: t.id, id: t.id, type: t.type, name: t.name, columns: t.columns || [], isSystem: !!t.isSystem, createdAt: t.createdAt });
const toPrinter = (p) => ({ _id: p.id, id: p.id, name: p.name, target: p.target, connection: p.connection, width: Number(p.width || 80), isDefault: !!p.isDefault, isActive: !!p.isActive });
const toCreditNote = (c) => ({
  _id: c.id, id: c.id, creditNo: c.creditNo, customerName: c.customerName, orderNo: c.orderNo,
  date: c.date || c.createdAt, reason: c.reason, includeGst: !!c.includeGst, gst: !!c.includeGst,
  items: c.items || [], subtotal: Number(c.subtotal || 0), gstAmount: Number(c.gstAmount || 0),
  total: Number(c.total || 0), taxRate: Number(c.taxRate || 0), status: c.status,
  restock: !!c.restock, postedAt: c.postedAt || null, createdBy: c.createdBy, createdAt: c.createdAt,
});

// ---- 门店设置 ----
function getSettings() {
  const o = {};
  for (const s of store.settings) o[s.key] = s.value;
  return o;
}
function setSettings(patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    const row = store.settings.find((s) => s.key === key);
    if (row) row.value = value;
    else store.settings.push({ id: nid(), orgId: '1', storeId: '1', key, value });
  }
  return getSettings();
}
const taxRate = () => Number(getSettings().taxRate || 0);

function computeTotals(items, taxRate = 0) {
  const subtotal = items.reduce((s, i) => s + Number(i.unitPrice) * Number(i.qty), 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  return { subtotal, tax, total: subtotal + tax };
}

// 付款行归集：多收的部分视为找零，只记录实际入账金额，避免日报表虚高
function normalizePayments(rows, total) {
  const list = (rows || []).map((r) => ({ ...r, amount: Number(r.amount || 0) }));
  const sum = list.reduce((s, r) => s + r.amount, 0);
  if (sum <= total + 0.001) return list;
  let excess = Math.round((sum - total) * 100) / 100;
  for (let i = list.length - 1; i >= 0 && excess > 0.001; i--) {
    const cut = Math.min(list[i].amount, excess);
    list[i].amount = Math.round((list[i].amount - cut) * 100) / 100;
    excess = Math.round((excess - cut) * 100) / 100;
  }
  return list.filter((r) => r.amount > 0);
}

// GST 感知的总额计算：支持含税/未税价、服务费、5 分钱取整
function computeOrderTotals(items, discount = 0) {
  const s = getSettings();
  const rate = Number(s.taxRate || 0) / 100;
  const svcRate = Number(s.serviceChargeRate || 0) / 100;
  const gross = items.reduce((sum, i) => sum + Number(i.unitPrice) * Number(i.qty), 0);
  const disc = Math.max(0, Math.min(Number(discount || 0), gross));
  const net = gross - disc;
  const serviceCharge = Math.round(net * svcRate * 100) / 100;
  const base = net + serviceCharge;
  let tax;
  let total;
  if (s.taxInclusive) {
    tax = Math.round((base - base / (1 + rate)) * 100) / 100;
    total = base;
  } else {
    tax = Math.round(base * rate * 100) / 100;
    total = base + tax;
  }
  if (s.roundTo5cent) total = Math.round(total * 20) / 20;
  return { subtotal: gross, discount: disc, serviceCharge, tax, total: Math.round(total * 100) / 100 };
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const dayOf = (d) => String(d || '').slice(0, 10);

// 贷项凭单：按行项目计算小计 / GST / 合计
function computeCreditNote(lines, includeGst) {
  const s = getSettings();
  const rate = Number(s.taxRate || 0) / 100;
  const subtotal = round2(lines.reduce((x, l) => x + Number(l.subtotal || 0), 0));
  const gstAmount = includeGst ? (s.taxInclusive ? round2(subtotal - subtotal / (1 + rate)) : round2(subtotal * rate)) : 0;
  const total = includeGst && !s.taxInclusive ? round2(subtotal + gstAmount) : subtotal;
  return { subtotal, gstAmount, total, taxRate: Number(s.taxRate || 0), taxInclusive: !!s.taxInclusive };
}

// 日结汇总：当天销售 / 付款方式 / 现金流水 / GST / 差异
function dayEndSummary(dateStr) {
  const s = getSettings();
  const day = dateStr || dayOf(new Date().toISOString());
  const onDay = (d) => dayOf(d) === day;
  const today = store.orders.filter((o) => onDay(o.createdAt));
  const paid = today.filter((o) => o.status === 'paid' || o.status === 'refunded');
  const voids = today.filter((o) => o.status === 'void');
  const byMethod = {};
  for (const p of store.payments) {
    const o = store.orders.find((x) => x.id === String(p.orderId));
    if (o && onDay(o.createdAt)) byMethod[p.method] = round2((byMethod[p.method] || 0) + Number(p.amount || 0));
  }
  const movements = store.cashMovements.filter((m) => onDay(m.createdAt));
  const sumType = (t) => round2(movements.filter((m) => m.type === t).reduce((x, m) => x + Number(m.amount || 0), 0));
  const shiftsToday = store.shifts.filter((sh) => onDay(sh.openedAt));
  const opening = round2(shiftsToday.reduce((x, sh) => x + Number(sh.openAmount || 0), 0));
  const salesCash = byMethod.cash || 0;
  const refunded = round2(store.refunds.filter((r) => onDay(r.createdAt)).reduce((x, r) => x + Number(r.amount || 0), 0));
  const unsettled = round2(store.unsettles.filter((u) => onDay(u.createdAt)).reduce((x, u) => x + Number(u.amount || 0), 0));
  const creditNotes = store.creditNotes.filter((c) => onDay(c.createdAt));
  const tax = round2(paid.reduce((x, o) => x + Number(o.tax || 0), 0));
  const net = round2(paid.reduce((x, o) => x + Number(o.total || 0), 0));
  const rate = Number(s.taxRate || 0);
  const refundTax = rate ? round2(refunded * (rate / (100 + rate))) : 0;
  return {
    date: day,
    status: store.dayEnds.find((d) => d.date === day) ? 'closed' : 'open',
    sales: {
      orders: paid.length,
      gross: round2(paid.reduce((x, o) => x + Number(o.subtotal || 0), 0)),
      discount: round2(paid.reduce((x, o) => x + Number(o.discount || 0), 0)),
      serviceCharge: round2(paid.reduce((x, o) => x + Number(o.serviceCharge || 0), 0)),
      tax, net, refunded, unsettled,
      voids: voids.length,
      voidAmount: round2(voids.reduce((x, o) => x + Number(o.total || 0), 0)),
    },
    byMethod,
    cash: {
      opening, cashIn: sumType('cash_in'), withdraw: sumType('withdraw'), payout: sumType('payout'), received: sumType('received'),
      salesCash, expected: round2(opening + sumType('cash_in') + salesCash + sumType('received') - sumType('withdraw') - sumType('payout')),
      counted: null, difference: null,
    },
    gst: { taxRate: rate, taxInclusive: !!s.taxInclusive, taxableSales: net, outputTax: tax, refundTax, netTax: round2(tax - refundTax) },
    creditNotes: { count: creditNotes.length, amount: round2(creditNotes.reduce((x, c) => x + Number(c.total || 0), 0)) },
    closedAt: null, closedBy: null, note: '',
  };
}
function orderNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `T${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// 生成可重打的单据内容（Bill / Receipt / Order slip / Kitchen / Bar）。
// 只产出结构化内容供界面显示与浏览器打印；不涉及 ESC/POS 硬件。
const DOC_TITLES = { bill: 'Bill / Tax Invoice', receipt: 'Receipt', order: 'Order Slip', kitchen: 'Kitchen Order', bar: 'Bar Order' };
function buildDocument(o, kind = 'bill') {
  const s = getSettings();
  const isKitchen = kind === 'kitchen' || kind === 'bar';
  const table = o.tableId ? (store.tables.find((t) => t.id === String(o.tableId)) || {}).number || null : null;
  const cashier = (store.users.find((u) => u.id === String(o.createdBy)) || {}).name || null;
  const payments = store.payments.filter((p) => p.orderId === o.id);
  return {
    kind, title: DOC_TITLES[kind] || 'Bill',
    header: isKitchen
      ? { name: s.companyName || 'Store' }
      : { name: s.companyName || 'Store', address: s.address || '', phone: s.phone || '', gstNo: s.gstNo || '' },
    orderNo: o.orderNo, invoiceNo: o.invoiceNo || null, date: o.createdAt, status: o.status,
    table, cashier, customerName: o.customerName || null,
    items: isKitchen ? o.items.map((i) => ({ qty: i.qty, code: i.code, name: i.name })) : o.items,
    subtotal: Number(o.subtotal || 0), discount: Number(o.discount || 0), serviceCharge: Number(o.serviceCharge || 0),
    tax: Number(o.tax || 0), taxRate: s.taxRate || 0, taxInclusive: !!s.taxInclusive,
    total: Number(o.total || 0), refundedAmount: Number(o.refundedAmount || 0),
    payments: isKitchen ? [] : payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
    footer: isKitchen ? '' : (s.receiptFooter || ''),
    reprintCount: Number(o.reprintCount || 0),
  };
}

function devAuthenticate(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
  try {
    const d = jwt.verify(h.slice(7), JWT_SECRET);
    const u = store.users.find((x) => x.id === String(d.sub));
    if (!u || !u.isActive) return res.status(401).json({ error: 'unauthorized' });
    req.user = { id: u.id, orgId: u.orgId, storeId: u.storeId, role: u.role, name: u.name, phone: u.phone };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

export function createDevRouter(io) {
  const r = Router();

  // auth
  r.post('/auth/login', async (req, res) => {
    const { phone, password } = req.body || {};
    const u = store.users.find((x) => x.phone === phone);
    if (!u || !bcrypt.compareSync(password || '', u.password)) return res.status(401).json({ error: 'invalid credentials' });
    const { access: accessToken, refresh: refreshToken } = signTokens(toUser(u));
    res.json({ accessToken, refreshToken, user: publicUser(u) });
  });
  r.post('/auth/refresh', (req, res) => {
    const { access: accessToken, refresh: refreshToken } = signTokens(toUser(req.user));
    res.json({ accessToken, refreshToken });
  });

  r.use(devAuthenticate);
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

  // ---- 菜单 CRUD ----
  r.get('/menu/categories', (req, res) => res.json(store.categories.map(toMenuCategory)));
  r.post('/menu/categories', (req, res) => {
    const c = { id: nid(), orgId: '1', storeId: '1', name: req.body.name, color: req.body.color ?? null, sortOrder: req.body.sortOrder || store.categories.length + 1, isActive: true };
    store.categories.push(c); res.status(201).json(toMenuCategory(c));
  });
  r.put('/menu/categories/:id', (req, res) => {
    const c = store.categories.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (req.body.name !== undefined) c.name = req.body.name;
    if (req.body.color !== undefined) c.color = req.body.color;
    if (req.body.sortOrder !== undefined) c.sortOrder = req.body.sortOrder;
    if (req.body.isActive !== undefined) c.isActive = req.body.isActive;
    res.json(toMenuCategory(c));
  });
  r.delete('/menu/categories/:id', (req, res) => {
    store.categories = store.categories.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/bases', (req, res) => {
    let list = store.bases;
    if (req.query.category) list = list.filter((b) => b.categoryId === String(req.query.category));
    res.json(list.map(toMenuBase));
  });
  r.post('/menu/bases', (req, res) => {
    const b = { id: nid(), orgId: '1', storeId: '1', categoryId: req.body.categoryId || null, name: req.body.name, basePrice: req.body.basePrice ?? 0, sortOrder: req.body.sortOrder || 1, isActive: true };
    store.bases.push(b); res.status(201).json(toMenuBase(b));
  });
  r.put('/menu/bases/:id', (req, res) => {
    const b = store.bases.find((x) => x.id === req.params.id);
    if (!b) return res.status(404).json({ error: 'not found' });
    Object.assign(b, {
      categoryId: req.body.categoryId !== undefined ? req.body.categoryId : b.categoryId,
      name: req.body.name ?? b.name,
      basePrice: req.body.basePrice !== undefined ? req.body.basePrice : b.basePrice,
      sortOrder: req.body.sortOrder ?? b.sortOrder,
      isActive: req.body.isActive ?? b.isActive,
    });
    res.json(toMenuBase(b));
  });
  r.delete('/menu/bases/:id', (req, res) => {
    store.bases = store.bases.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/modifiers', (req, res) => res.json(store.modifiers.map(toModifier)));
  r.post('/menu/modifiers', (req, res) => {
    const m = { id: nid(), orgId: '1', storeId: '1', code: req.body.code, label: req.body.label ?? null, defaultDelta: req.body.defaultDelta ?? 0, sortOrder: req.body.sortOrder || store.modifiers.length + 1, isActive: true };
    store.modifiers.push(m); res.status(201).json(toModifier(m));
  });
  r.put('/menu/modifiers/:id', (req, res) => {
    const m = store.modifiers.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    Object.assign(m, {
      code: req.body.code ?? m.code, label: req.body.label ?? m.label,
      defaultDelta: req.body.defaultDelta ?? m.defaultDelta, sortOrder: req.body.sortOrder ?? m.sortOrder,
      isActive: req.body.isActive ?? m.isActive,
    });
    res.json(toModifier(m));
  });
  r.delete('/menu/modifiers/:id', (req, res) => {
    store.modifiers = store.modifiers.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/base-modifiers', (req, res) => {
    let list = store.baseModifiers;
    if (req.query.baseId) list = list.filter((x) => x.baseId === String(req.query.baseId));
    res.json(list.map(toBaseModifier));
  });
  r.post('/menu/base-modifiers', (req, res) => {
    const bm = { id: nid(), orgId: '1', storeId: '1', baseId: String(req.body.baseId), modifierId: String(req.body.modifierId), delta: req.body.delta == null ? null : req.body.delta };
    store.baseModifiers.push(bm); res.status(201).json(toBaseModifier(bm));
  });
  r.delete('/menu/base-modifiers/:id', (req, res) => {
    store.baseModifiers = store.baseModifiers.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/variants', (req, res) => {
    let list = store.variants;
    if (req.query.baseId) list = list.filter((v) => v.baseId === String(req.query.baseId));
    if (req.query.categoryId) list = list.filter((v) => v.categoryId === String(req.query.categoryId));
    res.json(list.map(toVariant));
  });
  // 条码扫描：按 barcode 或 code 精确查找（Smcin 条码管理）
  r.get('/menu/variants/barcode/:code', (req, res) => {
    const code = String(req.params.code);
    const v = store.variants.find((x) => (x.barcode && x.barcode === code) || x.code === code);
    if (!v) return res.status(404).json({ error: 'barcode not found' });
    res.json(toVariant(v));
  });
  r.post('/menu/variants', (req, res) => {
    const b = req.body;
    const v = {
      id: nid(), orgId: '1', storeId: '1', baseId: String(b.baseId), categoryId: b.categoryId || null,
      code: b.code, name: b.name, modifierIds: b.modifierIds || [],
      price: b.price ?? 0, cost: b.cost ?? 0, stockQty: b.stockQty ?? 0, stockThreshold: b.stockThreshold ?? 0,
      barcode: b.barcode || null, sortOrder: b.sortOrder || store.variants.length + 1, isActive: true,
    };
    store.variants.push(v); res.status(201).json(toVariant(v));
  });
  r.put('/menu/variants/:id', (req, res) => {
    const v = store.variants.find((x) => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: 'not found' });
    Object.assign(v, {
      categoryId: req.body.categoryId !== undefined ? req.body.categoryId : v.categoryId,
      code: req.body.code ?? v.code, name: req.body.name ?? v.name,
      modifierIds: req.body.modifierIds ?? v.modifierIds,
      price: req.body.price ?? v.price, cost: req.body.cost ?? v.cost,
      stockQty: req.body.stockQty ?? v.stockQty, stockThreshold: req.body.stockThreshold ?? v.stockThreshold,
      barcode: req.body.barcode ?? v.barcode, sortOrder: req.body.sortOrder ?? v.sortOrder,
      isActive: req.body.isActive ?? v.isActive,
    });
    res.json(toVariant(v));
  });
  r.delete('/menu/variants/:id', (req, res) => {
    store.variants = store.variants.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/tree', (req, res) => {
    res.json({
      categories: store.categories.map(toMenuCategory),
      bases: store.bases.map(toMenuBase),
      modifiers: store.modifiers.map(toModifier),
      baseModifiers: store.baseModifiers.map(toBaseModifier),
      variants: store.variants.filter((v) => v.isActive).map(toVariant),
    });
  });

  // ---- 桌台 ----
  r.get('/tables', (req, res) => res.json(store.tables.map(toTable)));
  r.post('/tables', (req, res) => {
    const b = req.body;
    const t = { id: nid(), orgId: '1', storeId: '1', number: b.number, zone: b.zone || '大厅', seats: b.seats || 4, status: 'free', currentOrderId: null };
    store.tables.push(t); res.status(201).json(toTable(t));
  });
  r.post('/tables/:id/status', (req, res) => {
    const t = store.tables.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    t.status = req.body.status || t.status;
    res.json(toTable(t));
  });

  // ---- 订单（item 引用 variantId） ----
  r.get('/orders', (req, res) => {
    let list = store.orders;
    if (req.query.status) list = list.filter((o) => o.status === req.query.status);
    res.json(list.map(toOrder));
  });
  r.get('/orders/:id', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    res.json(toOrder(o));
  });
  r.post('/orders', (req, res) => {
    const b = req.body;
    const items = (b.items || []).map((i) => ({ ...i, status: 'pending' }));
    const totals = computeOrderTotals(items, b.discount || 0);
    const held = !!b.hold;
    const o = {
      id: nid(), orgId: '1', storeId: '1', orderNo: orderNo(), type: b.type || 'dine_in',
      tableId: b.tableId ? String(b.tableId) : null, customerName: b.customerName || null, phone: b.phone || null,
      status: held ? 'hold' : 'open', items, subtotal: totals.subtotal, discount: totals.discount, serviceCharge: totals.serviceCharge,
      tax: totals.tax, total: totals.total, refundedAmount: 0, invoiceNo: null,
      holdLabel: held ? (b.holdLabel || `Hold ${store.orders.filter((x) => x.status === 'hold').length + 1}`) : null,
      heldAt: held ? now() : null, reprintCount: 0,
      createdBy: req.user.id, shiftId: store.shifts.find((s) => s.status === 'open')?.id || null, voidReason: null,
      createdAt: now(), updatedAt: now(),
    };
    store.orders.push(o);
    if (!held && o.type === 'dine_in' && o.tableId) {
      const t = store.tables.find((x) => x.id === o.tableId);
      if (t) { t.status = 'occupied'; t.currentOrderId = o.id; }
    }
    res.status(201).json(toOrder(o));
  });
  r.post('/orders/:id/items', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'open') return res.status(400).json({ error: 'order not open' });
    o.items.push({ ...req.body, status: 'pending' });
    const totals = computeOrderTotals(o.items, o.discount);
    Object.assign(o, totals); o.updatedAt = now();
    res.json(toOrder(o));
  });
  // 整单替换明细（取单后编辑再送厨房用）
  r.put('/orders/:id/items', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (!['open', 'hold'].includes(o.status)) return res.status(400).json({ error: 'order not editable' });
    const items = (req.body.items || []).map((i) => ({ ...i, status: 'pending' }));
    if (!items.length) return res.status(400).json({ error: 'items required' });
    o.items = items;
    const totals = computeOrderTotals(items, req.body.discount ?? o.discount);
    Object.assign(o, totals); o.updatedAt = now();
    res.json(toOrder(o));
  });
  r.put('/orders/:id/status', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (req.body.status === 'kitchen' && o.status === 'open') {
      o.status = 'kitchen'; o.updatedAt = now();
      io.to(`store:${o.storeId}`).emit('order:created', toOrder(o));
      io.to(`store:${o.storeId}`).emit('kds:ticket', toOrder(o));
      return res.json(toOrder(o));
    }
    o.status = req.body.status || o.status; o.updatedAt = now();
    if (o.status === 'served') io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
    else io.to(`store:${o.storeId}`).emit('order:created', toOrder(o));
    res.json(toOrder(o));
  });
  r.post('/orders/:id/checkout', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status === 'paid' || o.status === 'void') return res.status(400).json({ error: 'already closed' });
    const paidSum = (req.body.payments || []).reduce((s, x) => s + Number(x.amount), 0);
    if (paidSum + Number(req.body.tip || 0) < Number(o.total || 0)) return res.status(400).json({ error: 'amount not covered' });
    for (const pm of normalizePayments(req.body.payments, Number(o.total || 0))) {
      store.payments.push({ id: nid(), orgId: '1', storeId: '1', orderId: o.id, method: pm.method, amount: pm.amount, tip: 0, createdAt: now() });
    }
    o.status = 'paid'; o.updatedAt = now();
    const s = getSettings();
    if (!o.invoiceNo) {
      const seq = store.invoices.length + 1;
      o.invoiceNo = `${s.invoicePrefix || 'INV'}-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
      store.invoices.push({ id: nid(), orderId: o.id, invoiceNo: o.invoiceNo, amount: o.total, tax: o.tax, createdAt: now() });
    }
    // 扣成品库存（全部追踪）
    const low = [];
    for (const it of o.items) {
      const vid = it.variantId || it.itemId;
      const v = store.variants.find((x) => x.id === String(vid));
      if (!v) continue;
      v.stockQty = Math.max(0, Number(v.stockQty) - Number(it.qty));
      if (v.stockQty < Number(v.stockThreshold || 0)) low.push({ itemId: v.id, name: v.name, quantity: v.stockQty });
    }
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'needs_clean'; t.currentOrderId = null; } }
    io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
    if (low.length) io.to(`store:${o.storeId}`).emit('inventory:low', low);
    const payments = store.payments.filter((p) => p.orderId === o.id);
    res.json({
      order: toOrder(o),
      receipt: {
        storeName: s.companyName || 'Demo Store', address: s.address || '', phone: s.phone || '', gstNo: s.gstNo || '',
        orderNo: o.orderNo, invoiceNo: o.invoiceNo, items: o.items, subtotal: o.subtotal, discount: o.discount,
        serviceCharge: o.serviceCharge, tax: o.tax, taxRate: s.taxRate, taxInclusive: s.taxInclusive, total: o.total,
        payments, footer: s.receiptFooter || '', createdAt: o.createdAt,
      },
    });
  });
  r.post('/orders/:id/void', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (['paid', 'void', 'void_pending'].includes(o.status)) return res.status(400).json({ error: 'cannot void this order' });
    o.status = 'void_pending'; o.voidRequestedBy = req.user.id; o.voidReason = req.body.reason || null; o.updatedAt = now();
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'free'; t.currentOrderId = null; } }
    res.json(toOrder(o));
  });
  r.post('/orders/:id/void/approve', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
    o.status = 'void'; o.voidApprovedBy = req.user.id; o.updatedAt = now();
    io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'free'; t.currentOrderId = null; } }
    res.json(toOrder(o));
  });
  r.post('/orders/:id/void/reject', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
    o.status = 'open'; o.voidRequestedBy = null; o.voidReason = null; o.voidRejectReason = req.body?.reason || null; o.updatedAt = now();
    io.to(`store:${o.storeId}`).emit('order:created', toOrder(o));
    res.json(toOrder(o));
  });

  // ---- 挂单 Hold / 取单 Recall ----
  r.get('/holds', (req, res) => res.json(store.orders.filter((o) => o.status === 'hold').map(toOrder)));
  r.post('/orders/:id/hold', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (!['open', 'hold'].includes(o.status)) return res.status(400).json({ error: 'only open orders can be held' });
    o.status = 'hold';
    o.holdLabel = req.body?.label || o.holdLabel || `Hold ${store.orders.filter((x) => x.status === 'hold').length + 1}`;
    o.heldAt = now(); o.updatedAt = now();
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'free'; t.currentOrderId = null; } }
    io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
    res.json(toOrder(o));
  });
  r.post('/orders/:id/recall', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'hold') return res.status(400).json({ error: 'order is not on hold' });
    o.status = 'open'; o.heldAt = null; o.updatedAt = now();
    if (o.type === 'dine_in' && o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'occupied'; t.currentOrderId = o.id; } }
    res.json(toOrder(o));
  });

  // ---- 反结算 Unsettle：把已结算单退回未结算 ----
  r.get('/unsettles', (req, res) => res.json(store.unsettles));
  r.post('/orders/:id/unsettle', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (!['paid', 'refunded'].includes(o.status)) return res.status(400).json({ error: 'only settled orders can be unsettled' });
    // 回补库存
    for (const it of o.items) {
      const v = store.variants.find((x) => x.id === String(it.variantId || it.itemId));
      if (v) v.stockQty = Number(v.stockQty) + Number(it.qty);
    }
    // 作废付款记录
    const voided = store.payments.filter((p) => p.orderId === o.id);
    store.payments = store.payments.filter((p) => p.orderId !== o.id);
    // 发票作废
    store.invoices = store.invoices.filter((i) => i.orderId !== o.id);
    const record = { id: nid(), orderId: o.id, orderNo: o.orderNo, invoiceNo: o.invoiceNo || null, amount: o.total, payments: voided.map((p) => ({ method: p.method, amount: Number(p.amount) })), reason: req.body?.reason || 'unsettle', createdBy: req.user.id, createdAt: now() };
    store.unsettles.unshift(record);
    o.status = 'open'; o.invoiceNo = null; o.refundedAmount = 0; o.unsettledAt = now(); o.updatedAt = now();
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'occupied'; t.currentOrderId = o.id; } }
    io.to(`store:${o.storeId}`).emit('order:created', toOrder(o));
    res.json({ order: toOrder(o), unsettle: record });
  });

  // ---- 单据内容（重打用）：Bill / Receipt / Order / Kitchen / Bar ----
  r.get('/orders/:id/document', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    res.json(buildDocument(o, req.query.kind || 'bill'));
  });
  r.post('/orders/:id/reprint', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    const kind = req.body?.kind || 'bill';
    o.reprintCount = Number(o.reprintCount || 0) + 1;
    const row = { id: nid(), orderId: o.id, orderNo: o.orderNo, kind, createdBy: req.user.id, createdAt: now() };
    store.reprintLogs.unshift(row);
    res.json({ document: buildDocument(o, kind), reprint: row });
  });

  // ---- 发票 / Tax Invoice ----
  r.get('/orders/:id/invoice', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    const s = getSettings();
    const payments = store.payments.filter((p) => p.orderId === o.id);
    res.json({
      invoiceNo: o.invoiceNo || `DRAFT-${o.orderNo}`,
      orderNo: o.orderNo, date: o.createdAt, status: o.status,
      seller: { name: s.companyName, address: s.address, phone: s.phone, gstNo: s.gstNo },
      customer: { name: o.customerName || 'Walk-in Customer', phone: o.phone || '' },
      items: o.items, subtotal: o.subtotal, discount: o.discount, serviceCharge: o.serviceCharge,
      tax: o.tax, taxRate: s.taxRate, taxInclusive: s.taxInclusive, total: o.total,
      payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
      refundedAmount: o.refundedAmount || 0,
    });
  });

  // ---- Split Bill ----
  r.get('/orders/:id/splits', (req, res) => {
    res.json(store.orders.filter((o) => String(o.splitFromOrderId) === String(req.params.id)).map(toOrder));
  });
  r.post('/orders/:id/split', (req, res) => {
    const parent = store.orders.find((x) => x.id === req.params.id);
    if (!parent) return res.status(404).json({ error: 'not found' });
    if (!['open', 'kitchen', 'ready', 'served'].includes(parent.status)) return res.status(400).json({ error: 'cannot split this order' });
    const b = req.body || {};
    const mode = b.mode || 'equal';
    const groups = []; // 每组 items
    if (mode === 'item') {
      // b.groups = [[itemIndex, ...], [...]]
      for (const idxs of b.groups || []) {
        const items = idxs.map((i) => parent.items[i]).filter(Boolean).map((i) => ({ ...i, status: 'pending' }));
        if (items.length) groups.push(items);
      }
    } else if (mode === 'pax') {
      const pax = Math.max(2, Number(b.pax || 2));
      const buckets = Array.from({ length: pax }, () => []);
      parent.items.forEach((it, i) => buckets[i % pax].push({ ...it, status: 'pending' }));
      groups.push(...buckets.filter((g) => g.length));
    } else {
      // equal / amount：按金额均分，生成占位项目，保留原单为母单
      const parts = Math.max(2, Number(b.parts || 2));
      const per = Math.round((parent.total / parts) * 100) / 100;
      for (let i = 0; i < parts; i++) {
        const amount = i === parts - 1 ? Math.round((parent.total - per * (parts - 1)) * 100) / 100 : per;
        groups.push([{ code: `SPLIT-${i + 1}`, name: `Split share ${i + 1}`, unitPrice: amount, qty: 1, status: 'pending' }]);
      }
    }
    if (!groups.length) return res.status(400).json({ error: 'nothing to split' });
    const created = [];
    groups.forEach((items, gi) => {
      const totals = computeOrderTotals(items, 0);
      const child = {
        id: nid(), orgId: '1', storeId: '1', orderNo: `${parent.orderNo}-S${gi + 1}`, type: parent.type,
        tableId: parent.tableId, customerName: parent.customerName, phone: parent.phone, status: 'open',
        items, subtotal: totals.subtotal, discount: 0, serviceCharge: totals.serviceCharge, tax: totals.tax, total: totals.total,
        refundedAmount: 0, invoiceNo: null, splitFromOrderId: parent.id, splitGroupNo: gi + 1,
        createdBy: req.user.id, shiftId: parent.shiftId, voidReason: null, createdAt: now(), updatedAt: now(),
      };
      store.orders.push(child); created.push(child);
    });
    store.orderSplits.push({ id: nid(), parentOrderId: parent.id, mode, count: created.length, createdAt: now(), createdBy: req.user.id });
    parent.status = 'split'; parent.updatedAt = now();
    io.to(`store:${parent.storeId}`).emit('order:closed', String(parent.id));
    res.status(201).json({ parent: toOrder(parent), children: created.map(toOrder) });
  });

  // ---- Refund ----
  r.get('/refunds', (req, res) => res.json(store.refunds.map(toRefund)));
  r.post('/orders/:id/refund', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (!['paid', 'served'].includes(o.status)) return res.status(400).json({ error: 'only paid orders can be refunded' });
    const b = req.body || {};
    const restock = b.restock !== false;
    let amount = Number(b.amount || 0);
    const refundItems = [];
    if (Array.isArray(b.items) && b.items.length) {
      // 按项目退款：b.items = [{ index|code, qty }]
      for (const rl of b.items) {
        const src = o.items[rl.index] || o.items.find((i) => i.code === rl.code);
        if (!src) continue;
        const qty = Math.min(Number(rl.qty || src.qty), src.qty);
        const lineAmt = Math.round(qty * Number(src.unitPrice) * 100) / 100;
        amount += lineAmt;
        refundItems.push({ code: src.code, name: src.name, qty, unitPrice: src.unitPrice });
        if (restock) {
          const v = store.variants.find((x) => x.id === String(src.variantId || src.itemId));
          if (v) v.stockQty = Number(v.stockQty) + qty;
        }
      }
    } else {
      amount = amount || Math.round((Number(o.total) - Number(o.refundedAmount || 0)) * 100) / 100;
      if (restock) {
        for (const it of o.items) {
          const v = store.variants.find((x) => x.id === String(it.variantId || it.itemId));
          if (v) v.stockQty = Number(v.stockQty) + Number(it.qty);
        }
      }
    }
    if (amount <= 0) return res.status(400).json({ error: 'refund amount must be positive' });
    if (Number(o.refundedAmount || 0) + amount > Number(o.total) + 0.001) return res.status(400).json({ error: 'refund exceeds order total' });
    o.refundedAmount = Math.round((Number(o.refundedAmount || 0) + amount) * 100) / 100;
    if (o.refundedAmount >= Number(o.total) - 0.001) o.status = 'refunded';
    o.updatedAt = now();
    const refund = {
      id: nid(), orgId: '1', storeId: '1', refundNo: `RF${Date.now()}`, orderId: o.id, orderNo: o.orderNo,
      amount, method: b.method || 'cash', reason: b.reason || 'customer refund', items: refundItems, restock,
      createdBy: req.user.id, createdAt: now(),
    };
    store.refunds.unshift(refund);
    io.to(`store:${o.storeId}`).emit('order:created', toOrder(o));
    res.status(201).json({ order: toOrder(o), refund: toRefund(refund) });
  });

  // ---- 门店设置 / GST ----
  r.get('/settings', (req, res) => res.json(getSettings()));
  r.put('/settings', (req, res) => res.json(setSettings(req.body)));

  // ---- 促销 Promotion ----
  r.get('/promotions', (req, res) => res.json(store.promotions.map(toPromotion)));
  r.post('/promotions', (req, res) => {
    const b = req.body || {};
    const p = { id: nid(), orgId: '1', storeId: '1', code: b.code || `PROMO${store.promotions.length + 1}`, name: b.name || '', type: b.type || 'percent', value: Number(b.value || 0), minSpend: Number(b.minSpend || 0), validFrom: b.validFrom || null, validUntil: b.validUntil || null, isActive: b.isActive !== false, createdAt: now() };
    store.promotions.push(p); res.status(201).json(toPromotion(p));
  });
  r.put('/promotions/:id', (req, res) => {
    const p = store.promotions.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    Object.assign(p, { code: req.body.code ?? p.code, name: req.body.name ?? p.name, type: req.body.type ?? p.type, value: req.body.value !== undefined ? Number(req.body.value) : p.value, minSpend: req.body.minSpend !== undefined ? Number(req.body.minSpend) : p.minSpend, validFrom: req.body.validFrom ?? p.validFrom, validUntil: req.body.validUntil ?? p.validUntil, isActive: req.body.isActive ?? p.isActive });
    res.json(toPromotion(p));
  });
  r.delete('/promotions/:id', (req, res) => { store.promotions = store.promotions.filter((x) => x.id !== req.params.id); res.json({ ok: true }); });
  r.get('/promotions/apply', (req, res) => {
    const code = String(req.query.code || '').toUpperCase();
    const amount = Number(req.query.amount || 0);
    const p = store.promotions.find((x) => x.code.toUpperCase() === code && x.isActive);
    if (!p) return res.status(404).json({ error: 'promotion not found' });
    if (amount < p.minSpend) return res.status(400).json({ error: `min spend ${p.minSpend}` });
    const discount = p.type === 'percent' ? Math.round(amount * p.value) / 100 : Math.min(p.value, amount);
    res.json({ promotion: toPromotion(p), discount: Math.round(discount * 100) / 100 });
  });

  // ---- 客户库存 Customer Stock ----
  r.get('/customer-stock', (req, res) => res.json(store.customerStock.map(toCustomerStock)));
  r.post('/customer-stock', (req, res) => {
    const b = req.body || {};
    const m = store.members.find((x) => x.id === String(b.memberId));
    const c = { id: nid(), orgId: '1', storeId: '1', memberId: String(b.memberId || (m && m.id) || ''), memberNo: b.memberNo || (m && m.memberNo) || '', itemName: b.itemName || '', qty: Number(b.qty || 0), unit: b.unit || 'pcs', note: b.note || '', createdAt: now() };
    store.customerStock.push(c); res.status(201).json(toCustomerStock(c));
  });
  r.post('/customer-stock/:id/adjust', (req, res) => {
    const c = store.customerStock.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    c.qty = Math.max(0, Number(c.qty) + Number(req.body.delta || 0));
    res.json(toCustomerStock(c));
  });

  // ---- 定期盘点 Periodical Stock Take ----
  r.get('/stock-takes', (req, res) => res.json(store.stockTakes.map(toStockTake)));
  r.post('/stock-takes', (req, res) => {
    const lines = store.variants.map((v) => ({ itemId: v.id, code: v.code, name: v.name, systemQty: Number(v.stockQty || 0), countedQty: null, variance: 0 }));
    const st = { id: nid(), orgId: '1', storeId: '1', takeNo: `ST${Date.now()}`, status: 'draft', lines, createdBy: req.user.id, createdAt: now(), postedAt: null };
    store.stockTakes.unshift(st); res.status(201).json(toStockTake(st));
  });
  r.put('/stock-takes/:id', (req, res) => {
    const st = store.stockTakes.find((x) => x.id === req.params.id);
    if (!st) return res.status(404).json({ error: 'not found' });
    if (st.status !== 'draft') return res.status(400).json({ error: 'already posted' });
    for (const upd of req.body?.lines || []) {
      const line = st.lines.find((l) => String(l.itemId) === String(upd.itemId));
      if (line) { line.countedQty = Number(upd.countedQty || 0); line.variance = line.countedQty - line.systemQty; }
    }
    res.json(toStockTake(st));
  });
  r.post('/stock-takes/:id/post', (req, res) => {
    const st = store.stockTakes.find((x) => x.id === req.params.id);
    if (!st) return res.status(404).json({ error: 'not found' });
    if (st.status !== 'draft') return res.status(400).json({ error: 'already posted' });
    for (const line of st.lines) {
      if (line.countedQty == null) continue;
      const v = store.variants.find((x) => x.id === String(line.itemId));
      if (v) v.stockQty = Number(line.countedQty);
    }
    st.status = 'posted'; st.postedAt = now();
    res.json(toStockTake(st));
  });

  // ---- 报表设计器 Report Templates ----
  r.get('/report-templates', (req, res) => res.json(store.reportTemplates.map(toReportTemplate)));
  r.post('/report-templates', (req, res) => {
    const b = req.body || {};
    const t = { id: nid(), orgId: '1', storeId: '1', type: b.type || 'custom', name: b.name || 'Custom Report', columns: b.columns || [], isSystem: false, createdAt: now() };
    store.reportTemplates.push(t); res.status(201).json(toReportTemplate(t));
  });
  r.delete('/report-templates/:id', (req, res) => { store.reportTemplates = store.reportTemplates.filter((x) => x.id !== req.params.id); res.json({ ok: true }); });

  // ---- 硬件 Hardware ----
  r.get('/hardware/printers', (req, res) => res.json(store.printers.map(toPrinter)));
  r.post('/hardware/printers', (req, res) => {
    const b = req.body || {};
    const p = { id: nid(), orgId: '1', storeId: '1', name: b.name || 'Printer', target: b.target || 'receipt', connection: b.connection || 'usb', width: Number(b.width || 80), isDefault: !!b.isDefault, isActive: b.isActive !== false };
    store.printers.push(p); res.status(201).json(toPrinter(p));
  });
  r.put('/hardware/printers/:id', (req, res) => {
    const p = store.printers.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    Object.assign(p, { name: req.body.name ?? p.name, target: req.body.target ?? p.target, connection: req.body.connection ?? p.connection, width: req.body.width !== undefined ? Number(req.body.width) : p.width, isDefault: req.body.isDefault ?? p.isDefault, isActive: req.body.isActive ?? p.isActive });
    res.json(toPrinter(p));
  });
  r.post('/hardware/print', (req, res) => {
    const b = req.body || {};
    const target = b.target || 'receipt';
    const printer = store.printers.find((x) => x.target === target && x.isActive) || store.printers.find((x) => x.isActive);
    const o = b.orderId ? store.orders.find((x) => x.id === String(b.orderId)) : null;
    const s = getSettings();
    // 生成 ESC/POS 文本载荷（真实环境由本地打印代理发送到打印机）
    const lines = [];
    if (target === 'kitchen' || target === 'bar') {
      lines.push(`== ${target.toUpperCase()} COPY ==`);
      lines.push(o ? o.orderNo : '-');
      if (o) for (const it of o.items) lines.push(`${it.qty} x ${it.code} ${it.name}`);
    } else {
      lines.push(s.companyName || 'Store');
      if (o) { lines.push(o.orderNo); for (const it of o.items) lines.push(`${it.qty} x ${it.name}  ${(it.unitPrice * it.qty).toFixed(2)}`); lines.push(`TOTAL ${Number(o.total).toFixed(2)}`); }
    }
    const job = { id: nid(), orgId: '1', storeId: '1', target, printerId: printer ? printer.id : null, orderId: o ? o.id : null, payload: lines.join('\n'), status: 'queued', createdBy: req.user.id, createdAt: now() };
    store.printJobs.unshift(job);
    res.status(201).json({ job, printer: printer ? toPrinter(printer) : null, escpos: lines.join('\n') });
  });
  r.post('/hardware/drawer', (req, res) => {
    const job = { id: nid(), orgId: '1', storeId: '1', target: 'drawer', payload: 'ESC/POS: 1B 70 00 19 FA', status: 'sent', createdBy: req.user.id, createdAt: now() };
    store.printJobs.unshift(job);
    res.json({ ok: true, job });
  });

  // ---- GST 汇总报表 ----
  r.get('/reports/gst', (req, res) => {
    const paid = store.orders.filter((o) => o.status === 'paid' || o.status === 'refunded');
    const s = getSettings();
    const outputTax = paid.reduce((sum, o) => sum + Number(o.tax || 0), 0);
    const refundTax = store.refunds.reduce((sum, r) => sum + Number(r.amount || 0) * (Number(s.taxRate || 0) / (100 + Number(s.taxRate || 0))), 0);
    res.json({ from: req.query.from || null, to: req.query.to || null, taxRate: s.taxRate, taxInclusive: s.taxInclusive, taxableSales: paid.reduce((sum, o) => sum + Number(o.total || 0), 0), outputTax: Math.round(outputTax * 100) / 100, refundTax: Math.round(refundTax * 100) / 100, netTax: Math.round((outputTax - refundTax) * 100) / 100, invoiceCount: store.invoices.length });
  });

  // ---- 重打中心：按类型/日期/桌号/收银员检索历史单据 ----
  r.get('/reports/reprint', (req, res) => {
    const type = req.query.type || 'bill';
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59`) : null;
    const inRange = (d) => { const t = new Date(d); if (from && t < from) return false; if (to && t > to) return false; return true; };
    const tableOf = (id) => (store.tables.find((t) => t.id === String(id)) || {}).number || null;
    const cashierOf = (id) => (store.users.find((u) => u.id === String(id)) || {}).name || null;
    let rows = [];
    if (type === 'payout') {
      rows = store.cashMovements.filter((m) => ['payout', 'withdraw'].includes(m.type) && inRange(m.createdAt))
        .map((m) => ({ id: m.id, voucherNo: m.voucherNo, date: m.createdAt, payTo: m.payTo, amount: Number(m.amount), reason: m.reason, method: m.method, kind: 'payout' }));
    } else if (type === 'closeshift') {
      rows = store.shifts.filter((s) => inRange(s.openedAt)).map((s) => ({ id: s.id, date: s.openedAt, cashier: cashierOf(s.cashierId), openAmount: Number(s.openAmount), expectedAmount: Number(s.expectedAmount), closeAmount: Number(s.closeAmount), difference: Number(s.difference), status: s.status, kind: 'closeshift' }));
    } else if (type === 'dayend') {
      const byDay = {};
      for (const o of store.orders.filter((x) => x.status === 'paid' || x.status === 'refunded')) {
        if (!inRange(o.createdAt)) continue;
        const d = String(o.createdAt).slice(0, 10);
        byDay[d] = byDay[d] || { date: d, orders: 0, cash: 0, card: 0, other: 0, total: 0, kind: 'dayend' };
        byDay[d].orders++; byDay[d].total += Number(o.total || 0);
        for (const p of store.payments.filter((x) => x.orderId === o.id)) {
          if (p.method === 'cash') byDay[d].cash += Number(p.amount);
          else if (p.method === 'card') byDay[d].card += Number(p.amount);
          else byDay[d].other += Number(p.amount);
        }
      }
      rows = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));
    } else {
      let list = store.orders.filter((o) => inRange(o.createdAt));
      if (type === 'bill' || type === 'receipt') list = list.filter((o) => ['paid', 'refunded'].includes(o.status));
      if (type === 'order') list = list.filter((o) => !['void', 'hold'].includes(o.status));
      if (req.query.table) list = list.filter((o) => String(o.tableId) === String(req.query.table));
      if (req.query.cashier) list = list.filter((o) => String(o.createdBy) === String(req.query.cashier));
      if (req.query.orderNo) list = list.filter((o) => o.orderNo.toLowerCase().includes(String(req.query.orderNo).toLowerCase()));
      rows = list.map((o) => ({ id: o.id, orderNo: o.orderNo, invoiceNo: o.invoiceNo || null, date: o.createdAt, status: o.status, table: tableOf(o.tableId), cashier: cashierOf(o.createdBy), itemCount: o.items.length, total: Number(o.total || 0), reprintCount: Number(o.reprintCount || 0), kind: type }));
    }
    res.json({ type, from: req.query.from || null, to: req.query.to || null, rows, count: rows.length });
  });

  r.get('/reprints', (req, res) => res.json(store.reprintLogs));

  // ---- 库存（原料级） ----
  r.get('/inventory/items', (req, res) => res.json(store.inventory.map(toInventoryItem)));
  r.post('/inventory/items', (req, res) => {
    const b = req.body;
    const inv = { id: nid(), orgId: '1', storeId: '1', name: b.name, unit: b.unit, quantity: Number(b.quantity || 0), threshold: Number(b.threshold || 0), costPrice: b.costPrice == null ? null : Number(b.costPrice) };
    store.inventory.push(inv); res.status(201).json(toInventoryItem(inv));
  });
  r.post('/inventory/adjust', (req, res) => {
    const inv = store.inventory.find((x) => x.id === String(req.body.itemId));
    if (!inv) return res.status(404).json({ error: 'not found' });
    inv.quantity = Math.max(0, Number(inv.quantity) + Number(req.body.delta || 0));
    res.json(toInventoryItem(inv));
  });

  // ---- 报表 ----
  r.get('/reports/sales', (req, res) => {
    const paid = store.orders.filter((o) => o.status === 'paid');
    const total = paid.reduce((s, o) => s + Number(o.total || 0), 0);
    const byMethod = {};
    for (const p of store.payments) byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount || 0);
    res.json({ from: now(), to: now(), total, count: paid.length, byMethod });
  });
  r.get('/reports/daily-close', (req, res) => {
    const paid = store.orders.filter((o) => o.status === 'paid');
    const total = paid.reduce((s, o) => s + Number(o.total || 0), 0);
    const byMethod = {};
    for (const p of store.payments) byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount || 0);
    res.json({ date: now(), total, orderCount: paid.length, byMethod, saleMovements: 0 });
  });

  // ---- 会员 / 会员充值 / 积分 / Knock Off ----
  r.get('/members', (req, res) => res.json(store.members.map(toMember)));
  r.post('/members', (req, res) => {
    const b = req.body || {};
    const m = { id: nid(), orgId: '1', storeId: '1', memberNo: b.memberNo || `M${String(store.members.length + 1).padStart(4, '0')}`, name: b.name || '', phone: b.phone || '', creditBalance: Number(b.creditBalance || 0), points: Number(b.points || 0), status: 'active', createdAt: now() };
    store.members.push(m); res.status(201).json(toMember(m));
  });
  r.put('/members/:id', (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    Object.assign(m, { memberNo: req.body.memberNo ?? m.memberNo, name: req.body.name ?? m.name, phone: req.body.phone ?? m.phone, status: req.body.status ?? m.status });
    res.json(toMember(m));
  });
  r.post('/members/:id/top-up', (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id);
    const amount = Number(req.body.amount || 0);
    if (!m || amount <= 0) return res.status(400).json({ error: 'invalid member or amount' });
    m.creditBalance += amount;
    const topup = { id: nid(), memberId: m.id, receiptNo: `TU${Date.now()}`, amount, createdAt: now(), createdBy: req.user.id };
    store.memberTopups.push(topup); res.json({ member: toMember(m), topup });
  });
  r.get('/members/:id/ledger', (req, res) => res.json({ topups: store.memberTopups.filter((x) => x.memberId === req.params.id), points: store.pointsLedger.filter((x) => x.memberId === req.params.id) }));
  r.post('/members/:id/points', (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id); const delta = Number(req.body.delta || 0);
    if (!m) return res.status(404).json({ error: 'not found' });
    m.points = Math.max(0, m.points + delta); const row = { id: nid(), memberId: m.id, delta, reason: req.body.reason || 'manual', createdAt: now() }; store.pointsLedger.push(row); res.json({ member: toMember(m), entry: row });
  });
  r.post('/members/:id/knock-off', (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id); const amount = Number(req.body.amount || 0);
    if (!m || amount <= 0 || amount > m.creditBalance) return res.status(400).json({ error: 'invalid amount' });
    m.creditBalance -= amount; res.json({ member: toMember(m), knockedOff: amount, receiptNo: `RV${Date.now()}` });
  });

  // ---- Cash In / Withdraw / Payment / Received / Credit Note ----
  r.get('/finance/movements', (req, res) => res.json(store.cashMovements.map(toMovement)));
  r.post('/finance/movements', (req, res) => {
    const b = req.body || {}; const amount = Number(b.amount || 0);
    if (amount <= 0) return res.status(400).json({ error: 'amount must be positive' });
    const row = { id: nid(), type: b.type || 'cash_in', voucherNo: b.voucherNo || `V${Date.now()}`, payTo: b.payTo || '', amount, reason: b.reason || b.for || '', method: b.method || 'cash', createdBy: req.user.id, createdAt: now() };
    store.cashMovements.unshift(row); res.status(201).json(toMovement(row));
  });
  // ---- Credit Note（含行项目 / GST / 过账回库） ----
  r.get('/finance/credit-notes', (req, res) => res.json(store.creditNotes.map(toCreditNote)));
  r.get('/finance/credit-notes/:id', (req, res) => {
    const c = store.creditNotes.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json(toCreditNote(c));
  });
  r.post('/finance/credit-notes', (req, res) => {
    const b = req.body || {};
    const lines = (b.items || []).map((i) => {
      const qty = Number(i.qty || 0);
      const retail = Number(i.retail ?? i.unitPrice ?? 0);
      return {
        code: i.code || '', barcode: i.barcode || '', description: i.description || i.name || '',
        location: i.location || '', qty, uom: i.uom || 'pcs', retail, cost: Number(i.cost || 0),
        subtotal: round2(qty * retail),
      };
    });
    const totals = computeCreditNote(lines, !!b.includeGst);
    const row = {
      id: nid(), orgId: '1', storeId: '1', creditNo: b.creditNo || `CN${Date.now()}`,
      customerName: b.customerName || '', orderNo: b.orderNo || '', date: b.date || now(),
      reason: b.reason || '', includeGst: !!b.includeGst, items: lines, status: 'open',
      restock: b.restock !== false, ...totals, createdBy: req.user.id, createdAt: now(),
    };
    store.creditNotes.unshift(row);
    res.status(201).json(toCreditNote(row));
  });
  r.post('/finance/credit-notes/:id/post', (req, res) => {
    const c = store.creditNotes.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (c.status !== 'open') return res.status(400).json({ error: 'already posted' });
    // 过账：可选回补库存
    if (c.restock !== false) {
      for (const l of c.items || []) {
        const v = store.variants.find((x) => x.code === l.code || (l.barcode && x.barcode === l.barcode));
        if (v) v.stockQty = Number(v.stockQty) + Number(l.qty || 0);
      }
    }
    c.status = 'posted'; c.postedAt = now();
    res.json(toCreditNote(c));
  });
  r.delete('/finance/credit-notes/:id', (req, res) => {
    const c = store.creditNotes.find((x) => x.id === req.params.id);
    if (c && c.status === 'posted') return res.status(400).json({ error: 'posted note cannot be deleted' });
    store.creditNotes = store.creditNotes.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  // ---- 日结 Day End ----
  r.get('/reports/day-end', (req, res) => res.json(dayEndSummary(req.query.date)));
  r.get('/reports/day-end/history', (req, res) => res.json(store.dayEnds));
  r.get('/reports/day-end/:id', (req, res) => {
    const d = store.dayEnds.find((x) => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'not found' });
    res.json(d);
  });
  r.post('/reports/day-end/close', (req, res) => {
    const date = req.body?.date || dayOf(new Date().toISOString());
    if (store.dayEnds.find((d) => d.date === date)) return res.status(400).json({ error: 'day already closed' });
    const summary = dayEndSummary(date);
    const counted = Number(req.body?.countedCash || 0);
    summary.cash.counted = round2(counted);
    summary.cash.difference = round2(counted - summary.cash.expected);
    summary.status = 'closed';
    summary.closedAt = now();
    summary.closedBy = req.user.name;
    summary.note = req.body?.note || '';
    const rec = { id: nid(), ...summary };
    store.dayEnds.unshift(rec);
    res.status(201).json(rec);
  });

  // ---- Attendance ----
  r.get('/attendance', (req, res) => res.json(store.attendance.map(toAttendance)));
  r.post('/attendance', (req, res) => {
    const action = req.body.action || 'sign_in';
    const row = { id: nid(), userId: req.user.id, userName: req.user.name, action, code: req.body.code || '', note: req.body.note || '', time: now() };
    store.attendance.unshift(row); res.status(201).json(toAttendance(row));
  });

  // ---- Shift / Close Shift Settlement ----
  r.get('/shifts/current', (req, res) => {
    let s = store.shifts.find((x) => x.status === 'open');
    if (!s) { s = { id: nid(), orgId: '1', storeId: '1', cashierId: req.user.id, openAmount: 0, expectedAmount: 0, closeAmount: 0, difference: 0, status: 'open', openedAt: now(), closedAt: null }; store.shifts.push(s); }
    const paid = store.orders.filter((o) => o.status === 'paid' && o.shiftId === s.id);
    s.expectedAmount = s.openAmount + paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
    res.json({ shift: toShift(s), paidOrders: paid.map(toOrder), byMethod: Object.fromEntries(Object.entries(store.payments.filter((p) => paid.some((o) => o.id === p.orderId)).reduce((a, p) => { a[p.method] = (a[p.method] || 0) + Number(p.amount); return a; }, {}))) });
  });
  r.post('/shifts/open', (req, res) => { const s = { id: nid(), orgId: '1', storeId: '1', cashierId: req.user.id, openAmount: Number(req.body.openAmount || 0), expectedAmount: Number(req.body.openAmount || 0), closeAmount: 0, difference: 0, status: 'open', openedAt: now(), closedAt: null }; store.shifts.push(s); res.status(201).json(toShift(s)); });
  r.post('/shifts/:id/close', (req, res) => {
    const s = store.shifts.find((x) => x.id === req.params.id); if (!s || s.status !== 'open') return res.status(404).json({ error: 'open shift not found' });
    s.closeAmount = Number(req.body.closeAmount || 0); const paid = store.orders.filter((o) => o.status === 'paid' && o.shiftId === s.id); s.expectedAmount = s.openAmount + paid.reduce((sum, o) => sum + Number(o.total || 0), 0); s.difference = s.closeAmount - s.expectedAmount; s.status = 'closed'; s.closedAt = now(); res.json(toShift(s));
  });

  // ---- Suppliers / Purchase Order / GRN ----
  r.get('/suppliers', (req, res) => res.json(store.suppliers.map(toSupplier)));
  r.post('/suppliers', (req, res) => { const b = req.body || {}; const s = { id: nid(), orgId: '1', storeId: '1', code: b.code || `SUP-${store.suppliers.length + 1}`, name: b.name || '', phone: b.phone || '', contact: b.contact || '', status: 'active', createdAt: now() }; store.suppliers.push(s); res.status(201).json(toSupplier(s)); });
  r.get('/purchases', (req, res) => res.json(store.purchaseOrders));
  r.post('/purchases', (req, res) => { const b = req.body || {}; const p = { id: nid(), poNo: b.poNo || `PO${Date.now()}`, supplierId: b.supplierId || null, items: b.items || [], total: Number(b.total || 0), status: 'open', createdAt: now() }; store.purchaseOrders.unshift(p); res.status(201).json(p); });
  r.post('/purchases/:id/receive', (req, res) => { const p = store.purchaseOrders.find((x) => x.id === req.params.id); if (!p) return res.status(404).json({ error: 'not found' }); p.status = 'received'; p.receivedAt = now(); for (const item of p.items || []) { const inv = store.inventory.find((x) => x.id === String(item.itemId)); if (inv) inv.quantity += Number(item.qty || 0); } res.json(p); });

  // ---- 通用报表查询，供 ReportsPage / 后台使用 ----
  r.get('/reports/query', (req, res) => {
    const type = req.query.type || 'sales_by_date';
    const paid = store.orders.filter((o) => o.status === 'paid' || o.status === 'refunded');
    const s = getSettings();
    const userById = (id) => store.users.find((u) => u.id === String(id));
    const tableById = (id) => store.tables.find((t) => t.id === String(id));
    let rows = [];
    switch (type) {
      case 'sales_by_product':
        rows = Object.values(paid.flatMap((o) => o.items).reduce((a, i) => { const k = i.code || i.name; a[k] = a[k] || { code: k, name: i.name, qty: 0, amount: 0 }; a[k].qty += Number(i.qty); a[k].amount += Number(i.qty) * Number(i.unitPrice); return a; }, {}));
        break;
      case 'sales_by_payment':
        rows = Object.entries(store.payments.reduce((a, p) => { a[p.method] = (a[p.method] || 0) + Number(p.amount); return a; }, {})).map(([method, amount]) => ({ method, amount: Math.round(amount * 100) / 100 }));
        break;
      case 'sales_by_hour':
        rows = Object.values(paid.reduce((a, o) => { const h = new Date(o.createdAt).getHours(); const k = `${String(h).padStart(2, '0')}:00`; a[k] = a[k] || { hour: k, orders: 0, total: 0 }; a[k].orders++; a[k].total += Number(o.total); return a; }, {})).sort((x, y) => x.hour.localeCompare(y.hour));
        break;
      case 'sales_by_cashier':
        rows = Object.values(paid.reduce((a, o) => { const u = userById(o.createdBy); const k = u ? u.name : String(o.createdBy); a[k] = a[k] || { cashier: k, orders: 0, total: 0 }; a[k].orders++; a[k].total += Number(o.total); return a; }, {}));
        break;
      case 'sales_by_table':
        rows = Object.values(paid.reduce((a, o) => { const t = tableById(o.tableId); const k = t ? t.number : (o.type === 'takeaway' ? 'Takeaway' : 'Walk-in'); a[k] = a[k] || { table: k, orders: 0, total: 0 }; a[k].orders++; a[k].total += Number(o.total); return a; }, {}));
        break;
      case 'sales_by_department':
        rows = Object.values(paid.flatMap((o) => o.items).reduce((a, i) => { const v = store.variants.find((x) => x.id === String(i.variantId || i.itemId)); const b = v && store.bases.find((x) => x.id === String(v.baseId)); const c = b && store.categories.find((x) => x.id === String(b.categoryId)); const k = c ? c.name : 'Other'; a[k] = a[k] || { department: k, qty: 0, amount: 0 }; a[k].qty += Number(i.qty); a[k].amount += Number(i.qty) * Number(i.unitPrice); return a; }, {}));
        break;
      case 'void_report':
        rows = store.orders.filter((o) => o.status === 'void' || o.status === 'void_pending').map((o) => ({ orderNo: o.orderNo, date: o.createdAt, reason: o.voidReason || '', status: o.status, total: Number(o.total || 0) }));
        break;
      case 'refund_report':
        rows = store.refunds.map((r) => ({ refundNo: r.refundNo, orderNo: r.orderNo, date: r.createdAt, amount: Number(r.amount || 0), method: r.method, reason: r.reason }));
        break;
      case 'discount_report':
        rows = paid.filter((o) => Number(o.discount || 0) > 0).map((o) => ({ orderNo: o.orderNo, date: o.createdAt, subtotal: Number(o.subtotal), discount: Number(o.discount), total: Number(o.total) }));
        break;
      case 'stock_report':
        rows = store.variants.map((v) => ({ name: v.name, code: v.code, stockQty: Number(v.stockQty || 0), stockThreshold: Number(v.stockThreshold || 0) }));
        break;
      case 'customer_stock':
        rows = store.customerStock.map((c) => ({ memberNo: c.memberNo, itemName: c.itemName, qty: Number(c.qty), unit: c.unit }));
        break;
      case 'member_points':
        rows = store.members.map((m) => ({ memberNo: m.memberNo, name: m.name, points: Number(m.points), creditBalance: Number(m.creditBalance) }));
        break;
      case 'knock_off':
        rows = store.memberTopups.map((t) => { const m = store.members.find((x) => x.id === String(t.memberId)); return { receiptNo: t.receiptNo, memberNo: m ? m.memberNo : '', amount: Number(t.amount), date: t.createdAt }; });
        break;
      case 'cash_bill':
        rows = store.payments.map((p) => ({ orderNo: (store.orders.find((o) => o.id === String(p.orderId)) || {}).orderNo || '', method: p.method, amount: Number(p.amount), date: p.createdAt }));
        break;
      case 'payout':
        rows = store.cashMovements.filter((m) => m.type === 'payout' || m.type === 'withdraw').map((m) => ({ voucherNo: m.voucherNo, payTo: m.payTo, amount: Number(m.amount), reason: m.reason, date: m.createdAt }));
        break;
      case 'credit_note':
        rows = store.creditNotes.map((c) => ({ creditNo: c.creditNo, customerName: c.customerName, orderNo: c.orderNo, reason: c.reason, gst: !!c.gst }));
        break;
      case 'top_products':
        rows = Object.values(paid.flatMap((o) => o.items).reduce((a, i) => { const k = i.code || i.name; a[k] = a[k] || { code: k, name: i.name, qty: 0, amount: 0 }; a[k].qty += Number(i.qty); a[k].amount += Number(i.qty) * Number(i.unitPrice); return a; }, {})).sort((x, y) => y.qty - x.qty).slice(0, 10);
        break;
      case 'close_shift':
        rows = store.shifts.map((sh) => ({ shiftId: sh.id, openedAt: sh.openedAt, closedAt: sh.closedAt, openAmount: Number(sh.openAmount), expectedAmount: Number(sh.expectedAmount), closeAmount: Number(sh.closeAmount), difference: Number(sh.difference), status: sh.status }));
        break;
      case 'gst_summary': {
        const outputTax = paid.reduce((sum, o) => sum + Number(o.tax || 0), 0);
        rows = [{ taxableSales: Math.round(paid.reduce((sum, o) => sum + Number(o.total || 0), 0) * 100) / 100, taxRate: s.taxRate, outputTax: Math.round(outputTax * 100) / 100, invoices: store.invoices.length }];
        break;
      }
      default:
        rows = paid.map((o) => ({ orderNo: o.orderNo, date: o.createdAt, subtotal: Number(o.subtotal), discount: Number(o.discount), tax: Number(o.tax), total: Number(o.total), status: o.status }));
    }
    const total = type === 'refund_report' ? store.refunds.reduce((x, r) => x + Number(r.amount || 0), 0) : paid.reduce((x, o) => x + Number(o.total || 0), 0);
    res.json({ type, from: req.query.from || null, to: req.query.to || null, rows, total: Math.round(total * 100) / 100, count: rows.length });
  });

  return r;
}

export function devKdsSnapshot() {
  return store.orders.filter((o) => o.status === 'kitchen').map(toOrder);
}

export function initDevSockets(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const d = jwt.verify(token, JWT_SECRET);
      const u = store.users.find((x) => x.id === String(d.sub));
      if (!u) return next(new Error('unauthorized'));
      socket.user = u; next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    const room = `store:${socket.user.storeId}`;
    socket.join(room);
    socket.emit('kds:snapshot', devKdsSnapshot());
  });
}

export { seedDev };
