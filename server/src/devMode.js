// 开发预览模式(免 MySQL):当 DEV_NO_DB=1 时启用。
// 用内存假数据实现前端所需的全部接口 + Socket.IO KDS,不改变生产 MySQL 路径。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { signTokens, JWT_SECRET } from './middleware/auth.js';
import { REPORT_CATALOG, REPORT_CATEGORIES, reportColumns } from './reportCatalog.js';
import { runReport, reportTitle, makeFilter } from './reportEngine.js';
import { buildCsv, buildXlsx, buildPrintHtml } from './exporters.js';
import { applyMovements, applyMovement, valuationOf, makeDocNo, derivePoStatus } from './inventoryEngine.js';
// 复用生产同一份 zod schema —— 否则「预览能过、生产报错」这类漂移会一直存在
import {
  supplierSchema, purchaseOrderSchema, goodsReceiptSchema, stockTransferSchema,
  inventoryItemSchema, adjustSchema,
} from './validators.js';
import {
  ROLES, PERMISSION_GROUPS, ALL_PERMISSIONS, defaultPermissions, hasPermission, resolveRolePermissions,
} from './permissions.js';

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
  // 新增：转台 / 并台审计
  orderTransfers: [],
  // 新增：礼券 / 返利
  vouchers: [], voucherTxns: [], rebates: [],
  // 新增：日结
  dayEnds: [],
  // 新增：角色权限矩阵覆盖值 { manager: [...], cashier: [...] }
  rolePermissions: {},
  // 新增：采购与库存补全 —— 统一台账 / 采购行明细 / 收货单 / 库位调拨
  stockMovements: [], purchaseOrderLines: [], goodsReceipts: [], goodsReceiptLines: [],
  stockTransfers: [], stockTransferLines: [],
};
const nid = () => String(store.seq++);
const now = () => new Date().toISOString();
// 金额/数量取整:库存用 3 位小数,成本用 4 位(按克计价时 2 位不够)
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
const round4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;

// ---- 种子数据（kopitiam 风格，演示用；后台可改） ----
const CATS = [
  ['KOPI', '#7c3aed', 1], ['TEH', '#f97316', 2], ['SUSU', '#eab308', 3], ['MILO', '#ec4899', 4],
  ['NESCAFE', '#14b8a6', 5], ['OTHER', '#64748b', 6], ['FRESH', '#06b6d4', 7],
  ['CAN DRINK', '#3b82f6', 8], ['BEER', '#d97706', 9],
];
// 出品部门(用于 Sales By Department 报表):水吧 / 零售柜台
const STATION_BY_CAT = {
  KOPI: 'Beverage Bar', TEH: 'Beverage Bar', SUSU: 'Beverage Bar', MILO: 'Beverage Bar',
  NESCAFE: 'Beverage Bar', FRESH: 'Beverage Bar', 'CAN DRINK': 'Beverage Bar', BEER: 'Beverage Bar',
  OTHER: 'Counter / Retail',
};
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
    ['1000000000', 'Admin', 'admin', 'admin123', 'EMP-0001', '2023-01-01'],
    ['1000000001', 'Manager', 'manager', 'manager123', 'EMP-0002', '2023-02-01'],
    ['1000000002', 'Cashier', 'cashier', 'cashier123', 'EMP-0003', '2023-03-01'],
    ['1000000003', 'Waiter', 'waiter', 'waiter123', 'EMP-0004', '2023-04-01'],
    ['1000000004', 'Kitchen', 'kitchen', 'kitchen123', 'EMP-0005', '2023-05-01'],
  ];
  for (const [phone, name, role, pw, empNo, joinDate] of demo) {
    store.users.push({
      id: nid(), orgId: '1', storeId: '1', name, phone, role, employeeNo: empNo,
      joinDate, email: null, password: bcrypt.hashSync(pw, 10), pin: null,
      lastLoginAt: null, isActive: true,
    });
  }
  const catIds = {};
  for (const [name, color, sort] of CATS) {
    const id = nid();
    store.categories.push({ id, orgId: '1', storeId: '1', name, color, sortOrder: sort, isActive: true, station: STATION_BY_CAT[name] || 'Kitchen' });
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

  // ---- 供应商主档(kopitiam 常见三类:干货饮品 / 生鲜乳品 / 烟草) ----
  const SUPPLIERS = [
    ['SUP-001', 'Demo Supplier', '03-1234 5678', 'Ah Hock', 'sales@demosupplier.com',
      '12 Jalan Industri 3, 50000 Kuala Lumpur', 'GST-SUP-0001', 'Net 30', 30],
    ['SUP-002', 'Kedai Borong Segar', '03-8765 4321', 'Siti', 'order@borongsegar.com',
      '88 Jalan Pasar, 50000 Kuala Lumpur', 'GST-SUP-0002', 'Net 14', 14],
    ['SUP-003', 'Tobacco Wholesale Sdn Bhd', '03-2222 3333', 'Ravi', 'sales@twb.com.my',
      '5 Jalan Perdagangan, 50000 Kuala Lumpur', 'GST-SUP-0003', 'COD', 0],
  ];
  const supIds = [];
  for (const [code, name, phone, person, email, address, taxNo, terms, days] of SUPPLIERS) {
    const id = nid();
    supIds.push(id);
    store.suppliers.push({
      id, orgId: '1', storeId: '1', code, name, phone, contact: person, contactPerson: person,
      email, address, taxNo, paymentTerms: terms, creditTermsDays: days, note: null,
      status: 'active', createdAt: now(), updatedAt: now(),
    });
  }

  // ---- 库存主档:avgCost 用移动加权平均,lastCost 是最近一次入库价 ----
  // [code, name, category, unit, qty, threshold, avgCost, lastCost, location, supplierIdx]
  const ITEMS = [
    ['RAW-001', '咖啡豆 Robusta', 'Coffee Bean', 'kg', 12.5, 5, 80.0, 82.0, 'Dry Store', 0],
    ['RAW-002', '红茶粉', 'Tea', 'kg', 6.0, 3, 22.0, 22.0, 'Dry Store', 0],
    ['RAW-003', 'Milo 粉', 'Malt', 'kg', 8.0, 3, 28.0, 27.5, 'Dry Store', 0],
    ['RAW-004', '白糖', 'Sugar', 'kg', 30.0, 10, 2.8, 2.8, 'Dry Store', 0],
    ['RAW-005', '淡奶 Evaporated', 'Dairy', '罐', 24.0, 8, 3.2, 3.3, 'Chiller', 1],
    ['RAW-006', '炼乳 Condensed', 'Dairy', '罐', 18.0, 8, 3.6, 3.6, 'Chiller', 1],
    ['PKG-001', '纸杯 8oz', 'Packaging', '个', 800.0, 200, 0.12, 0.12, 'Counter Store', 0],
    ['PKG-002', '杯盖 8oz', 'Packaging', '个', 600.0, 200, 0.05, 0.05, 'Counter Store', 0],
    ['RTD-001', '100plus 罐装', 'Can Drink', '罐', 120.0, 48, 1.9, 1.95, 'Chiller', 0],
    ['TOB-001', 'Marlboro', 'Tobacco', '包', 40.0, 20, 12.5, 12.8, 'Counter Store', 2],
  ];
  const invIds = [];
  for (const [code, name, category, unit, qty, threshold, avgCost, lastCost, location, si] of ITEMS) {
    const id = nid();
    invIds.push(id);
    store.inventory.push({
      id, orgId: '1', storeId: '1', code, name, category, barcode: null, unit,
      quantity: qty, threshold, costPrice: avgCost, avgCost, lastCost,
      location, supplierId: supIds[si], note: null, isActive: true, createdAt: now(), updatedAt: now(),
    });
  }
  // 期初台账:让库存估值报表从第一天就有据可查
  for (const it of store.inventory) {
    store.stockMovements.push({
      id: nid(), orgId: '1', storeId: '1', itemId: it.id, itemCode: it.code, itemName: it.name,
      type: 'opening', delta: Number(it.quantity), before: 0, after: Number(it.quantity),
      unitCost: Number(it.avgCost), amount: +(Number(it.quantity) * Number(it.avgCost)).toFixed(2),
      avgCostAfter: Number(it.avgCost), refType: 'opening', refId: null, refNo: null,
      location: it.location, note: '期初库存', createdBy: '1', createdByName: 'Admin', createdAt: now(),
    });
  }

  for (const n of ['A1', 'A2', 'B1']) {
    store.tables.push({ id: nid(), orgId: '1', storeId: '1', number: n, zone: '大厅', seats: 4, status: 'free', currentOrderId: null });
  }
  store.members.push({ id: nid(), orgId: '1', storeId: '1', memberNo: 'M0001', name: 'Demo Member', phone: '0123456789', creditBalance: 0, points: 120, status: 'active', createdAt: now() });
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
    voucherPrefix: 'GV',
    rebatePercent: 0,
    rebateExpiryDays: 90,
  };
  for (const [key, value] of Object.entries(DEFAULTS)) store.settings.push({ id: nid(), orgId: '1', storeId: '1', key, value });

  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Counter Receipt', target: 'receipt', connection: 'usb', width: 80, isDefault: true, isActive: true });
  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Kitchen Printer', target: 'kitchen', connection: 'lan', width: 80, isDefault: false, isActive: true });
  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Bar Printer', target: 'bar', connection: 'lan', width: 58, isDefault: false, isActive: true });
  store.printers.push({ id: nid(), orgId: '1', storeId: '1', name: 'Office A4', target: 'a4', connection: 'system', width: 210, isDefault: false, isActive: true });

  store.promotions.push({ id: nid(), orgId: '1', storeId: '1', code: 'HAPPY10', name: 'Happy Hour 10%', type: 'percent', value: 10, minSpend: 20, validFrom: null, validUntil: null, isActive: true, createdAt: now() });
  store.promotions.push({ id: nid(), orgId: '1', storeId: '1', code: 'RM2OFF', name: 'RM2 Off', type: 'amount', value: 2, minSpend: 10, validFrom: null, validUntil: null, isActive: true, createdAt: now() });

  store.customerStock.push({ id: nid(), orgId: '1', storeId: '1', memberId: '1', memberNo: 'M0001', itemName: 'Heineken', qty: 6, unit: 'btl', note: 'Member kept stock', createdAt: now() });

  // 礼券种子：一张未使用、一张已部分核销、一张已过期
  const seedVoucher = (code, face, balance, status, extra = {}) => {
    const v = {
      id: nid(), orgId: '1', storeId: '1',
      voucherNo: `GV20261003${String(store.vouchers.length + 1).padStart(3, '0')}`, code,
      faceValue: face, balance, status,
      issuedToMemberId: null, issuedToName: null, issuedToPhone: null,
      soldAmount: face, note: null,
      issuedAt: now(), expiresAt: null, voidedAt: null, voidReason: null,
      createdBy: '1', createdByName: 'Admin', createdAt: now(), updatedAt: now(),
      ...extra,
    };
    store.vouchers.push(v);
    store.voucherTxns.push({
      id: nid(), orgId: '1', storeId: '1', voucherId: v.id, voucherNo: v.voucherNo, code: v.code,
      type: 'issue', amount: face, balanceAfter: face, orderId: null, orderNo: null,
      memberId: null, reason: 'initial issue', createdBy: '1', createdByName: 'Admin', createdAt: now(),
    });
    if (balance < face) {
      store.voucherTxns.push({
        id: nid(), orgId: '1', storeId: '1', voucherId: v.id, voucherNo: v.voucherNo, code: v.code,
        type: 'redeem', amount: round2(face - balance), balanceAfter: balance, orderId: null, orderNo: null,
        memberId: null, reason: 'seed partial redemption', createdBy: '1', createdByName: 'Admin', createdAt: now(),
      });
    }
    return v;
  };
  seedVoucher('GV-1001', 50, 50, 'active');
  seedVoucher('GV-1002', 100, 35, 'active', { issuedToMemberId: '1', issuedToName: 'Demo Member', note: 'Partial used' });
  seedVoucher('GV-1003', 20, 20, 'expired', { expiresAt: new Date(Date.now() - 86400000).toISOString() });

  // 返利种子：给 Demo Member 一笔已赚取返利
  const demoMember = store.members.find((m) => m.memberNo === 'M0001') || store.members[0];
  if (demoMember) {
    demoMember.rebateBalance = 8.5;
    store.rebates.push({
      id: nid(), orgId: '1', storeId: '1', memberId: demoMember.id, memberNo: demoMember.memberNo,
      memberName: demoMember.name, type: 'earn', amount: 8.5, balanceAfter: 8.5,
      orderId: null, orderNo: null, orderTotal: 85, percent: 10, reason: 'seed welcome rebate',
      expiresAt: null, createdBy: '1', createdByName: 'Admin', createdAt: now(),
    });
  }

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

  // 角色权限矩阵:与生产 seed 一致,先把默认值存一份,后台改动覆盖它。
  for (const role of ROLES) {
    store.rolePermissions[role] = defaultPermissions(role);
  }
}

// ---- mappers(与 db.js 输出保持一致,前端按这些字段渲染) ----
const toUser = (u) => ({ id: u.id, _id: u.id, name: u.name, phone: u.phone, role: u.role, orgId: u.orgId, storeId: u.storeId });
// publicUser 会回给前端:绝不带 password / pin 哈希,只说 hasPin。
const publicUser = (u) => ({
  id: u.id, name: u.name, role: u.role, orgId: u.orgId, storeId: u.storeId, phone: u.phone,
  email: u.email || null, employeeNo: u.employeeNo || null, joinDate: u.joinDate || null,
  lastLoginAt: u.lastLoginAt || null, hasPin: !!u.pin, isActive: u.isActive !== false,
});
// 后台员工主档:字段比 publicUser 多 isActive/employeeNo,同样不含任何哈希。
const toStaff = (u) => ({
  id: u.id, _id: u.id, orgId: u.orgId, storeId: u.storeId, name: u.name, phone: u.phone,
  email: u.email || null, role: u.role, employeeNo: u.employeeNo || null,
  joinDate: u.joinDate || null, lastLoginAt: u.lastLoginAt || null,
  hasPin: !!u.pin, isActive: u.isActive !== false, createdAt: u.createdAt || null,
});
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
  _id: inv.id, id: inv.id, orgId: inv.orgId, storeId: inv.storeId, name: inv.name,
  code: inv.code || null, category: inv.category || null, barcode: inv.barcode || null,
  unit: inv.unit, quantity: Number(inv.quantity || 0), threshold: Number(inv.threshold || 0),
  costPrice: inv.costPrice == null ? null : Number(inv.costPrice),
  avgCost: Number(inv.avgCost || 0), lastCost: Number(inv.lastCost || 0),
  stockValue: round2(Number(inv.quantity || 0) * Number(inv.avgCost || 0)),
  location: inv.location || null,
  supplierId: inv.supplierId == null ? null : String(inv.supplierId),
  note: inv.note || null,
  isActive: inv.isActive == null ? true : !!inv.isActive,
  isLow: Number(inv.quantity || 0) < Number(inv.threshold || 0),
  createdAt: inv.createdAt || now(), updatedAt: inv.updatedAt || inv.createdAt || now(),
});
const toStockMovement = (m) => ({
  _id: m.id, id: m.id, orgId: m.orgId, storeId: m.storeId,
  itemId: m.itemId == null ? null : String(m.itemId),
  itemCode: m.itemCode || null, itemName: m.itemName || null, type: m.type,
  delta: Number(m.delta || 0), before: Number(m.before || 0), after: Number(m.after || 0),
  unitCost: Number(m.unitCost || 0), amount: Number(m.amount || 0),
  avgCostAfter: Number(m.avgCostAfter || 0),
  refOrderId: m.refOrderId == null ? null : String(m.refOrderId),
  refType: m.refType || null,
  refId: m.refId == null ? null : String(m.refId),
  refNo: m.refNo || null,
  location: m.location || null, note: m.note || null,
  createdBy: m.createdBy == null ? null : String(m.createdBy),
  createdByName: m.createdByName || null,
  createdAt: m.createdAt || now(),
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
  salesPersonId: o.salesPersonId == null ? null : String(o.salesPersonId),
  memberId: o.memberId == null ? null : String(o.memberId),
  mergedIntoOrderId: o.mergedIntoOrderId == null ? null : String(o.mergedIntoOrderId),
  voucherDiscount: Number(o.voucherDiscount || 0), rebateRedeemed: Number(o.rebateRedeemed || 0),
  voidRequestedBy: o.voidRequestedBy == null ? null : String(o.voidRequestedBy), voidApprovedBy: o.voidApprovedBy == null ? null : String(o.voidApprovedBy), voidReason: o.voidReason || null,
  createdAt: o.createdAt, updatedAt: o.updatedAt || o.createdAt,
});
const toMember = (m) => ({ _id: m.id, id: m.id, memberNo: m.memberNo, name: m.name, phone: m.phone, creditBalance: Number(m.creditBalance || 0), points: Number(m.points || 0), rebateBalance: Number(m.rebateBalance || 0), status: m.status, createdAt: m.createdAt });
// ---- 礼券 / 返利 ----
const toVoucher = (v) => ({
  _id: v.id, id: v.id, orgId: v.orgId, storeId: v.storeId, voucherNo: v.voucherNo, code: v.code,
  faceValue: Number(v.faceValue || 0), balance: Number(v.balance || 0),
  usedAmount: round2(Number(v.faceValue || 0) - Number(v.balance || 0)),
  status: v.status,
  issuedToMemberId: v.issuedToMemberId == null ? null : String(v.issuedToMemberId),
  issuedToName: v.issuedToName || null, issuedToPhone: v.issuedToPhone || null,
  soldAmount: Number(v.soldAmount || 0), note: v.note || null,
  issuedAt: v.issuedAt, expiresAt: v.expiresAt || null,
  voidedAt: v.voidedAt || null, voidReason: v.voidReason || null,
  createdBy: v.createdBy == null ? null : String(v.createdBy), createdByName: v.createdByName || null,
  createdAt: v.createdAt, updatedAt: v.updatedAt || v.createdAt,
});
const toVoucherTxn = (t) => ({
  _id: t.id, id: t.id, voucherId: String(t.voucherId), voucherNo: t.voucherNo, code: t.code,
  type: t.type, amount: Number(t.amount || 0), balanceAfter: Number(t.balanceAfter || 0),
  orderId: t.orderId == null ? null : String(t.orderId), orderNo: t.orderNo || null,
  memberId: t.memberId == null ? null : String(t.memberId), reason: t.reason || null,
  createdBy: t.createdBy == null ? null : String(t.createdBy), createdByName: t.createdByName || null,
  createdAt: t.createdAt,
});
const toRebate = (r) => ({
  _id: r.id, id: r.id, memberId: String(r.memberId), memberNo: r.memberNo || null, memberName: r.memberName || null,
  type: r.type, amount: Number(r.amount || 0), balanceAfter: Number(r.balanceAfter || 0),
  orderId: r.orderId == null ? null : String(r.orderId), orderNo: r.orderNo || null,
  orderTotal: Number(r.orderTotal || 0), percent: Number(r.percent || 0),
  reason: r.reason || null, expiresAt: r.expiresAt || null,
  createdBy: r.createdBy == null ? null : String(r.createdBy), createdByName: r.createdByName || null,
  createdAt: r.createdAt,
});
const toMovement = (m) => ({ _id: m.id, id: m.id, type: m.type, voucherNo: m.voucherNo, payTo: m.payTo, amount: Number(m.amount || 0), reason: m.reason, method: m.method, createdBy: m.createdBy, createdAt: m.createdAt });
const toAttendance = (a) => ({ _id: a.id, id: a.id, userId: a.userId, userName: a.userName, action: a.action, code: a.code, time: a.time, note: a.note || '' });
const toShift = (s) => ({ _id: s.id, id: s.id, cashierId: s.cashierId, openAmount: Number(s.openAmount || 0), expectedAmount: Number(s.expectedAmount || 0), closeAmount: Number(s.closeAmount || 0), difference: Number(s.difference || 0), status: s.status, openedAt: s.openedAt, closedAt: s.closedAt });
const toSupplier = (s) => ({
  _id: s.id, id: s.id, orgId: s.orgId, storeId: s.storeId,
  code: s.code || null, name: s.name, phone: s.phone || null, contact: s.contact || null,
  contactPerson: s.contactPerson || s.contact || null,
  email: s.email || null, address: s.address || null, taxNo: s.taxNo || null,
  paymentTerms: s.paymentTerms || null, creditTermsDays: Number(s.creditTermsDays || 0),
  note: s.note || null, status: s.status || 'active',
  isActive: (s.status || 'active') === 'active',
  createdAt: s.createdAt || now(), updatedAt: s.updatedAt || s.createdAt || now(),
});
const toPurchaseOrderLine = (l) => ({
  _id: l.id, id: l.id, poId: l.poId == null ? null : String(l.poId), lineNo: Number(l.lineNo || 0),
  itemId: l.itemId == null ? null : String(l.itemId),
  itemCode: l.itemCode || null, itemName: l.itemName || null, unit: l.unit || null,
  qty: Number(l.qty || 0), receivedQty: Number(l.receivedQty || 0),
  outstandingQty: Math.max(0, round3(Number(l.qty || 0) - Number(l.receivedQty || 0))),
  unitCost: Number(l.unitCost || 0), taxRate: Number(l.taxRate || 0),
  amount: Number(l.amount || 0), note: l.note || null, createdAt: l.createdAt || now(),
});
const toPurchaseOrder = (p, lines = null) => ({
  _id: p.id, id: p.id, orgId: p.orgId, storeId: p.storeId, poNo: p.poNo,
  supplierId: p.supplierId == null ? null : String(p.supplierId),
  supplierName: p.supplierName || null,
  items: p.items || [],
  ...(lines ? { lines: lines.map(toPurchaseOrderLine) } : {}),
  subtotal: Number(p.subtotal || 0), taxAmount: Number(p.taxAmount || 0), total: Number(p.total || 0),
  status: p.status || 'draft', expectedDate: p.expectedDate || null, note: p.note || null,
  receivedAt: p.receivedAt || null, approvedAt: p.approvedAt || null,
  approvedBy: p.approvedBy == null ? null : String(p.approvedBy),
  approvedByName: p.approvedByName || null,
  cancelledAt: p.cancelledAt || null, cancelReason: p.cancelReason || null,
  createdBy: p.createdBy == null ? null : String(p.createdBy),
  createdByName: p.createdByName || null,
  createdAt: p.createdAt || now(), updatedAt: p.updatedAt || p.createdAt || now(),
});
const toGoodsReceiptLine = (l) => ({
  _id: l.id, id: l.id, grnId: l.grnId == null ? null : String(l.grnId),
  poLineId: l.poLineId == null ? null : String(l.poLineId),
  itemId: l.itemId == null ? null : String(l.itemId),
  itemCode: l.itemCode || null, itemName: l.itemName || null, unit: l.unit || null,
  qty: Number(l.qty || 0), unitCost: Number(l.unitCost || 0), amount: Number(l.amount || 0),
  beforeQty: Number(l.beforeQty || 0), afterQty: Number(l.afterQty || 0),
  avgCostAfter: Number(l.avgCostAfter || 0), note: l.note || null, createdAt: l.createdAt || now(),
});
const toGoodsReceipt = (g, lines = null) => ({
  _id: g.id, id: g.id, orgId: g.orgId, storeId: g.storeId, grnNo: g.grnNo,
  poId: g.poId == null ? null : String(g.poId), poNo: g.poNo || null,
  supplierId: g.supplierId == null ? null : String(g.supplierId),
  supplierName: g.supplierName || null,
  total: Number(g.total || 0), status: g.status || 'posted', note: g.note || null,
  receivedAt: g.receivedAt || now(),
  voidedAt: g.voidedAt || null, voidReason: g.voidReason || null,
  ...(lines ? { lines: lines.map(toGoodsReceiptLine) } : {}),
  createdBy: g.createdBy == null ? null : String(g.createdBy),
  createdByName: g.createdByName || null, createdAt: g.createdAt || now(),
});
const toStockTransferLine = (l) => ({
  _id: l.id, id: l.id, transferId: l.transferId == null ? null : String(l.transferId),
  itemId: l.itemId == null ? null : String(l.itemId),
  toItemId: l.toItemId == null ? null : String(l.toItemId),
  itemCode: l.itemCode || null, itemName: l.itemName || null, unit: l.unit || null,
  qty: Number(l.qty || 0), unitCost: Number(l.unitCost || 0), amount: Number(l.amount || 0),
  beforeQty: Number(l.beforeQty || 0), afterQty: Number(l.afterQty || 0),
  avgCostAfter: Number(l.avgCostAfter || 0),
  note: l.note || null, createdAt: l.createdAt || now(),
});
const toStockTransfer = (t, lines = null) => ({
  _id: t.id, id: t.id, orgId: t.orgId, storeId: t.storeId, transferNo: t.transferNo,
  fromLocation: t.fromLocation || null, toLocation: t.toLocation || null,
  status: t.status || 'posted', totalCost: Number(t.totalCost || 0), note: t.note || null,
  voidedAt: t.voidedAt || null, voidReason: t.voidReason || null,
  ...(lines ? { lines: lines.map(toStockTransferLine) } : {}),
  createdBy: t.createdBy == null ? null : String(t.createdBy),
  createdByName: t.createdByName || null, createdAt: t.createdAt || now(),
});
const toRefund = (r) => ({ _id: r.id, id: r.id, refundNo: r.refundNo, orderId: String(r.orderId), orderNo: r.orderNo, amount: Number(r.amount || 0), method: r.method || 'cash', reason: r.reason || '', items: r.items || [], restock: !!r.restock, createdBy: r.createdBy, createdAt: r.createdAt });
const toPromotion = (p) => ({ _id: p.id, id: p.id, code: p.code, name: p.name, type: p.type, value: Number(p.value || 0), minSpend: Number(p.minSpend || 0), validFrom: p.validFrom || null, validUntil: p.validUntil || null, isActive: !!p.isActive, createdAt: p.createdAt });
const toCustomerStock = (c) => ({ _id: c.id, id: c.id, memberId: String(c.memberId), memberNo: c.memberNo, itemName: c.itemName, qty: Number(c.qty || 0), unit: c.unit || 'pcs', note: c.note || '', createdAt: c.createdAt });
const toStockTake = (s) => ({ _id: s.id, id: s.id, takeNo: s.takeNo, status: s.status, lines: s.lines || [], createdBy: s.createdBy, createdAt: s.createdAt, postedAt: s.postedAt || null });
const toReportTemplate = (t) => ({ _id: t.id, id: t.id, type: t.type, name: t.name, columns: t.columns || [], filters: t.filters || {}, sort: t.sort || null, format: t.format || 'csv', isSystem: !!t.isSystem, createdAt: t.createdAt });
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

const dayOf = (d) => String(d || '').slice(0, 10);

// 进行中(可转台 / 可并台 / 可加菜)的订单状态
const RUNNING_STATUS = ['open', 'hold', 'kitchen', 'preparing', 'ready', 'served'];

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
  // 支持 ?token= —— 浏览器直接下载/新窗口打开导出文件时无法带 Authorization 头
  const h = req.headers.authorization;
  const bearer = h?.startsWith('Bearer ') ? h.slice(7) : null;
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const d = jwt.verify(token, JWT_SECRET);
    const u = store.users.find((x) => x.id === String(d.sub));
    if (!u || !u.isActive) return res.status(401).json({ error: 'unauthorized' });
    req.user = { id: u.id, orgId: u.orgId, storeId: u.storeId, role: u.role, name: u.name, phone: u.phone };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

// ---- 按键权限(dev 版,与 middleware/auth.js 口径一致) ----
const devPinAttempts = new Map(); // PIN 登录失败节流
function devPermissions(role) {
  return resolveRolePermissions(role, store.rolePermissions);
}
function devRequirePerm(...keys) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    const perms = devPermissions(req.user.role);
    const missing = keys.filter((k) => !hasPermission(perms, k));
    if (missing.length) return res.status(403).json({ error: 'forbidden', missing });
    next();
  };
}

// ---- 库存引擎的内存适配器:与生产 inventoryStore.js 同一份契约 ----
const devInventoryAdapter = {
  async getItem(_orgId, _storeId, itemId) {
    if (itemId == null || itemId === '') return null;
    const inv = store.inventory.find((x) => x.id === String(itemId));
    return inv ? toInventoryItem(inv) : null;
  },
  async saveItem(item, patch) {
    const inv = store.inventory.find((x) => x.id === String(item.id));
    if (!inv) return;
    inv.quantity = Number(patch.quantity || 0);
    inv.avgCost = Number(patch.avgCost || 0);
    inv.lastCost = Number(patch.lastCost || 0);
    inv.updatedAt = now();
  },
  async appendMovement(mv) {
    const row = { id: nid(), ...mv, createdAt: now() };
    store.stockMovements.push(row);
    return toStockMovement(row);
  },
};
/**
 * 用与生产完全相同的 zod schema 校验请求体。
 * 生产路由直接 schema.parse() 抛错给全局错误处理;预览里手动转成 400,
 * 保证「同样的输入,两边给同样的结果」。
 */
function devParse(schema, body) {
  const r = schema.safeParse(body || {});
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error?.issues?.[0];
  return {
    ok: false,
    message: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'validation_failed',
    issues: r.error?.issues || [],
  };
}

/** 落库后检查是否跌破安全库存并广播。 */
function devNotifyLow(io, itemIds) {
  const low = [];
  for (const id of itemIds) {
    const inv = store.inventory.find((x) => x.id === String(id));
    if (inv && Number(inv.quantity) < Number(inv.threshold)) {
      low.push({ itemId: String(inv.id), name: inv.name, quantity: Number(inv.quantity) });
    }
  }
  if (low.length && io) io.to('store:1').emit('inventory:low', low);
}

// ---- 采购单行明细(内存) ----
// 注意:这里返回的是 store 里的**原始行对象**(便于直接改 receivedQty),
// 所以字段是 camelCase 且**没有** outstandingQty —— 那是 mapper 算出来的。
const devPoLines = (poId) => store.purchaseOrderLines
  .filter((l) => String(l.poId) === String(poId))
  .sort((a, b) => Number(a.lineNo) - Number(b.lineNo));

/** 未收数量 = 订购 - 已收(不小于 0)。 */
const devOutstanding = (l) => round3(Math.max(0, Number(l.qty || 0) - Number(l.receivedQty || 0)));

/** 按行重算 小计 / 税额 / 合计,与生产 routes/purchasing.js 同一算法。 */
function devComputeTotals(lines, defaultTaxRate = 0) {
  let subtotal = 0, taxAmount = 0;
  for (const l of lines) {
    const amount = round2(Number(l.qty || 0) * Number(l.unitCost || 0));
    subtotal += amount;
    const rate = l.taxRate == null || l.taxRate === '' ? Number(defaultTaxRate || 0) : Number(l.taxRate);
    taxAmount += (amount * rate) / 100;
  }
  subtotal = round2(subtotal);
  taxAmount = round2(taxAmount);
  return { subtotal, taxAmount, total: round2(subtotal + taxAmount) };
}

/** 覆盖式写入行明细(先删后插),行内快照物料编码/名称/单位。 */
function devWritePoLines(poId, lines, defaultTaxRate) {
  store.purchaseOrderLines = store.purchaseOrderLines.filter((l) => String(l.poId) !== String(poId));
  let lineNo = 1;
  const out = [];
  for (const l of lines) {
    const item = store.inventory.find((x) => x.id === String(l.itemId));
    if (!item) { const e = new Error('item_not_found'); e.itemId = l.itemId; throw e; }
    const amount = round2(Number(l.qty || 0) * Number(l.unitCost || 0));
    const rate = l.taxRate == null || l.taxRate === '' ? Number(defaultTaxRate || 0) : Number(l.taxRate);
    const row = {
      id: nid(), poId: String(poId), lineNo: lineNo++,
      itemId: String(l.itemId), itemCode: item.code || null, itemName: item.name, unit: item.unit || null,
      qty: Number(l.qty || 0), receivedQty: 0,
      unitCost: Number(l.unitCost || 0), taxRate: rate, amount,
      note: l.note || null, createdAt: now(),
    };
    store.purchaseOrderLines.push(row);
    out.push(row);
  }
  return out.map(toPurchaseOrderLine);
}

/** 重新推导 PO 状态(收货/作废后调用),返回状态字符串。 */
function devRefreshPoStatus(po) {
  po.status = derivePoStatus(devPoLines(po.id), po.status);
  po.updatedAt = now();
  return po.status;
}

// ---------------------------------------------------------------------------
// 报表数据集:把内存 store 整理成 reportEngine 需要的统一结构。
// 关键在 enrich —— 订单行项目补上 category / station,订单补上桌号、收银员、会员。
// ---------------------------------------------------------------------------
function buildReportDataset() {
  const userById = (id) => store.users.find((u) => u.id === String(id));
  const tableById = (id) => store.tables.find((t) => t.id === String(id));
  const memberById = (id) => store.members.find((m) => m.id === String(id));

  const variantById = new Map(store.variants.map((v) => [String(v.id), v]));
  const baseById = new Map(store.bases.map((b) => [String(b.id), b]));
  const catById = new Map(store.categories.map((c) => [String(c.id), c]));

  const decorateItem = (it) => {
    const v = variantById.get(String(it.variantId || it.itemId));
    const b = v ? baseById.get(String(v.baseId)) : null;
    const c = b ? catById.get(String(b.categoryId)) : null;
    return {
      ...it,
      code: it.code || (v ? v.code : ''),
      name: it.name || (v ? v.name : ''),
      qty: Number(it.qty || 0),
      unitPrice: Number(it.unitPrice || 0),
      amount: Number(it.qty || 0) * Number(it.unitPrice || 0),
      category: c ? c.name : 'Uncategorised',
      station: c ? (c.station || 'Kitchen') : 'Kitchen',
    };
  };

  const orders = store.orders.map((o) => {
    const u = userById(o.createdBy);
    const t = tableById(o.tableId);
    const m = memberById(o.memberId);
    return {
      ...o,
      items: (o.items || []).map(decorateItem),
      tableNo: t ? t.number : null,
      cashierName: u ? u.name : 'Unknown',
      salesPersonName: (userById(o.salesPersonId) || u || {}).name || 'Unknown',
      memberNo: m ? m.memberNo : null,
      memberName: m ? m.name : null,
      subtotal: Number(o.subtotal || 0),
      discount: Number(o.discount || 0),
      serviceCharge: Number(o.serviceCharge || 0),
      tax: Number(o.tax || 0),
      total: Number(o.total || 0),
    };
  });

  return {
    orders,
    payments: store.payments.map((p) => ({ ...p, amount: Number(p.amount || 0) })),
    refunds: store.refunds.map((x) => ({ ...x, amount: Number(x.amount || 0) })),
    unsettles: store.unsettles.map((x) => ({ ...x, amount: Number(x.amount || 0) })),
    cashMovements: store.cashMovements.map((x) => ({ ...x, amount: Number(x.amount || 0) })),
    shifts: store.shifts.map((s) => ({
      ...s,
      openAmount: Number(s.openAmount || 0), expectedAmount: Number(s.expectedAmount || 0),
      closeAmount: Number(s.closeAmount || 0), difference: Number(s.difference || 0),
    })),
    members: store.members.map((m) => ({ ...m, points: Number(m.points || 0), creditBalance: Number(m.creditBalance || 0), rebateBalance: Number(m.rebateBalance || 0) })),
    memberTopups: store.memberTopups.map((t) => ({ ...t, amount: Number(t.amount || 0) })),
    pointsLedger: store.pointsLedger,
    invoices: store.invoices.map((v) => ({ ...v, amount: Number(v.amount || 0), tax: Number(v.tax || 0) })),
    creditNotes: store.creditNotes.map((c) => ({ ...c, total: Number(c.total || 0) })),
    variants: store.variants.map((v) => ({ ...v, stockQty: Number(v.stockQty || 0), stockThreshold: Number(v.stockThreshold || 0), cost: Number(v.cost || 0) })),
    customerStock: store.customerStock,
    stockTakes: store.stockTakes,
    suppliers: store.suppliers.map(toSupplier),
    purchaseOrders: store.purchaseOrders.map((p) => toPurchaseOrder(p)),
    // 采购行本身不带单头信息,报表要按日期/状态/供应商过滤,这里补上单头快照
    purchaseOrderLines: store.purchaseOrderLines.map((l) => {
      const po = store.purchaseOrders.find((p) => String(p.id) === String(l.poId)) || {};
      return {
        ...toPurchaseOrderLine(l),
        poNo: po.poNo || null,
        poDate: po.createdAt || null,
        poStatus: po.status || 'draft',
        supplierId: po.supplierId == null ? null : String(po.supplierId),
      };
    }),
    stockMovements: store.stockMovements.map(toStockMovement),
    inventoryItems: store.inventory.map(toInventoryItem),
    goodsReceipts: store.goodsReceipts.map((g) => toGoodsReceipt(g)),
    goodsReceiptLines: store.goodsReceiptLines.map(toGoodsReceiptLine),
    stockTransfers: store.stockTransfers.map((t) => toStockTransfer(t)),
    stockTransferLines: store.stockTransferLines.map(toStockTransferLine),
    attendance: store.attendance,
    reprintLogs: store.reprintLogs,
    orderTransfers: store.orderTransfers,
    vouchers: store.vouchers.map(toVoucher),
    voucherTxns: store.voucherTxns.map(toVoucherTxn),
    rebates: store.rebates.map(toRebate),
    dayEnds: store.dayEnds.map((d) => ({ ...d, expectedCash: Number(d.expectedCash || 0), countedCash: Number(d.countedCash || 0), difference: Number(d.difference || 0) })),
    settings: getSettings(),
  };
}

export function createDevRouter(io) {
  const r = Router();

  // auth
  r.post('/auth/login', async (req, res) => {
    const { phone, password } = req.body || {};
    const u = store.users.find((x) => x.phone === phone);
    if (!u || !bcrypt.compareSync(password || '', u.password)) return res.status(401).json({ error: 'invalid credentials' });
    if (u.isActive === false) return res.status(403).json({ error: 'account disabled' });
    u.lastLoginAt = now();
    const { access: accessToken, refresh: refreshToken } = signTokens(toUser(u));
    res.json({ accessToken, refreshToken, user: publicUser(u), permissions: devPermissions(u.role) });
  });
  // PIN 快捷登录(换班/收银台切换):带 phone 精确匹配,只带 storeId 时在本店已设 PIN 的员工里逐个比对。
  r.post('/auth/pin-login', (req, res) => {
    const { phone, storeId, pin } = req.body || {};
    const raw = String(pin || '');
    if (!/^\d{4,6}$/.test(raw)) return res.status(400).json({ error: 'invalid pin format' });
    const key = String(phone || storeId || 'dev');
    const a = devPinAttempts.get(key);
    if (a?.until && a.until > Date.now()) {
      const wait = Math.ceil((a.until - Date.now()) / 1000);
      return res.status(429).json({ error: `too many attempts, retry in ${wait}s`, retryAfter: wait });
    }
    const candidates = phone
      ? store.users.filter((x) => x.phone === String(phone))
      : store.users.filter((x) => x.storeId === String(storeId || '1') && x.isActive !== false && x.pin);
    const u = candidates.find((x) => x.pin && bcrypt.compareSync(raw, x.pin));
    if (!u || u.isActive === false) {
      const cur = devPinAttempts.get(key) || { count: 0, until: 0 };
      cur.count += 1;
      if (cur.count >= 5) { cur.until = Date.now() + 60_000; cur.count = 0; }
      devPinAttempts.set(key, cur);
      return res.status(401).json({ error: 'invalid pin' });
    }
    devPinAttempts.delete(key);
    u.lastLoginAt = now();
    const { access: accessToken, refresh: refreshToken } = signTokens(toUser(u));
    res.json({ accessToken, refreshToken, user: publicUser(u), permissions: devPermissions(u.role) });
  });
  r.post('/auth/refresh', (req, res) => {
    const { access: accessToken, refresh: refreshToken } = signTokens(toUser(req.user));
    res.json({ accessToken, refreshToken });
  });

  r.use(devAuthenticate);
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), permissions: devPermissions(req.user.role) }));
  r.get('/auth/permissions', (req, res) => res.json({ role: req.user.role, permissions: devPermissions(req.user.role) }));

  // 改自己的密码:验旧密码 + 新旧不能相同
  r.put('/auth/password', (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'old and new password required' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    const u = store.users.find((x) => x.id === String(req.user.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    if (!bcrypt.compareSync(String(oldPassword), u.password)) return res.status(401).json({ error: 'current password is incorrect' });
    if (bcrypt.compareSync(String(newPassword), u.password)) return res.status(400).json({ error: 'new password must differ from the current one' });
    u.password = bcrypt.hashSync(String(newPassword), 10);
    res.json({ ok: true });
  });

  // 设置/清除自己的 PIN(需要密码确认)
  r.put('/auth/pin', (req, res) => {
    const { password, pin } = req.body || {};
    if (!password) return res.status(400).json({ error: 'password required' });
    const u = store.users.find((x) => x.id === String(req.user.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    if (!bcrypt.compareSync(String(password), u.password)) return res.status(401).json({ error: 'password is incorrect' });
    const raw = pin == null ? '' : String(pin).trim();
    if (raw === '') { u.pin = null; return res.json({ ok: true, hasPin: false }); }
    if (!/^\d{4,6}$/.test(raw)) return res.status(400).json({ error: 'pin must be 4-6 digits' });
    u.pin = bcrypt.hashSync(raw, 10);
    res.json({ ok: true, hasPin: true });
  });

  // ---- 权限矩阵 ----
  r.get('/roles/permissions', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const roles = {};
    for (const role of ROLES) roles[role] = devPermissions(role);
    res.json({
      catalog: PERMISSION_GROUPS, all: ALL_PERMISSIONS, roles,
      defaults: ROLES.reduce((a, role) => (a[role] = defaultPermissions(role), a), {}),
    });
  });
  r.put('/roles/:role/permissions', devRequirePerm('permission.manage'), (req, res) => {
    const role = String(req.params.role);
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'unknown role' });
    if (role === 'admin') return res.status(400).json({ error: 'admin permissions cannot be restricted' });
    const list = Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : null;
    if (!list) return res.status(400).json({ error: 'permissions must be an array' });
    const unknown = list.filter((k) => !ALL_PERMISSIONS.includes(k));
    if (unknown.length) return res.status(400).json({ error: `unknown permission: ${unknown.join(', ')}` });
    const clean = [...new Set(list)];
    store.rolePermissions[role] = clean;
    res.json({ ok: true, role, permissions: clean });
  });

  // ---- 员工主档 CRUD ----
  r.get('/users', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const q = String(req.query.q || '').trim().toLowerCase();
    const role = req.query.role ? String(req.query.role) : null;
    const status = req.query.status ? String(req.query.status) : null;
    let list = store.users.slice();
    if (q) list = list.filter((u) => [u.name, u.phone, u.employeeNo].some((v) => String(v || '').toLowerCase().includes(q)));
    if (role) list = list.filter((u) => u.role === role);
    if (status === 'active') list = list.filter((u) => u.isActive !== false);
    if (status === 'inactive') list = list.filter((u) => u.isActive === false);
    list.sort((a, b) => (Number(b.isActive !== false) - Number(a.isActive !== false)) || a.role.localeCompare(b.role) || String(a.name).localeCompare(String(b.name)));
    res.json(list.map(toStaff));
  });
  r.post('/users', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    const role = String(b.role || 'cashier');
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'unknown role' });
    if (req.user.role === 'manager' && role === 'admin') return res.status(403).json({ error: 'manager cannot create admin' });
    if (String(b.password || '').length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    if (store.users.some((u) => u.phone === phone)) return res.status(400).json({ error: 'phone already in use' });
    const u = {
      id: nid(), orgId: '1', storeId: '1', name, phone, email: b.email ? String(b.email) : null,
      role, employeeNo: b.employeeNo ? String(b.employeeNo) : null, joinDate: b.joinDate ? String(b.joinDate) : null,
      password: bcrypt.hashSync(String(b.password), 10), pin: null, lastLoginAt: null,
      isActive: true, createdAt: now(),
    };
    store.users.push(u);
    res.status(201).json(toStaff(u));
  });
  r.get('/users/:id', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const u = store.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json(toStaff(u));
  });
  r.put('/users/:id', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const u = store.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (req.user.role === 'manager' && u.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });
    const b = req.body || {};
    if (b.name != null) { const v = String(b.name).trim(); if (!v) return res.status(400).json({ error: 'name required' }); u.name = v; }
    if (b.phone != null) {
      const v = String(b.phone).trim();
      if (!v) return res.status(400).json({ error: 'phone required' });
      if (store.users.some((x) => x.phone === v && x.id !== u.id)) return res.status(400).json({ error: 'phone already in use' });
      u.phone = v;
    }
    if (b.email !== undefined) u.email = b.email ? String(b.email) : null;
    if (b.employeeNo !== undefined) u.employeeNo = b.employeeNo ? String(b.employeeNo) : null;
    if (b.joinDate !== undefined) u.joinDate = b.joinDate ? String(b.joinDate) : null;
    if (b.role != null) {
      const v = String(b.role);
      if (!ROLES.includes(v)) return res.status(400).json({ error: 'unknown role' });
      if (req.user.role === 'manager' && v === 'admin') return res.status(403).json({ error: 'manager cannot grant admin' });
      if (u.role === 'admin' && v !== 'admin') {
        const others = store.users.filter((x) => x.role === 'admin' && x.isActive !== false && x.id !== u.id).length;
        if (others === 0) return res.status(400).json({ error: 'cannot demote the last admin' });
      }
      u.role = v;
    }
    res.json(toStaff(u));
  });
  r.put('/users/:id/status', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const u = store.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (req.user.role === 'manager' && u.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });
    if (u.id === String(req.user.id)) return res.status(400).json({ error: 'cannot change your own status' });
    const isActive = req.body?.isActive === undefined ? u.isActive === false : !!req.body.isActive;
    if (!isActive && u.role === 'admin') {
      const others = store.users.filter((x) => x.role === 'admin' && x.isActive !== false && x.id !== u.id).length;
      if (others === 0) return res.status(400).json({ error: 'cannot disable the last admin' });
    }
    u.isActive = isActive;
    res.json(toStaff(u));
  });
  r.put('/users/:id/password', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const u = store.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (req.user.role === 'manager' && u.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });
    const np = String(req.body?.newPassword || '');
    if (np.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    u.password = bcrypt.hashSync(np, 10);
    res.json({ ok: true });
  });
  r.put('/users/:id/pin', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const u = store.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (req.user.role === 'manager' && u.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });
    const raw = req.body?.pin == null ? '' : String(req.body.pin).trim();
    if (raw === '') { u.pin = null; return res.json({ ok: true, hasPin: false }); }
    if (!/^\d{4,6}$/.test(raw)) return res.status(400).json({ error: 'pin must be 4-6 digits' });
    u.pin = bcrypt.hashSync(raw, 10);
    res.json({ ok: true, hasPin: true });
  });
  r.delete('/users/:id', (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const u = store.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.id === String(req.user.id)) return res.status(400).json({ error: 'cannot delete your own account' });
    if (req.user.role === 'manager' && u.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });
    if (u.role === 'admin') {
      const others = store.users.filter((x) => x.role === 'admin' && x.isActive !== false && x.id !== u.id).length;
      if (others === 0) return res.status(400).json({ error: 'cannot delete the last admin' });
    }
    u.isActive = false;
    res.json({ ok: true, deactivated: true });
  });

  // ---- 菜单 CRUD ----
  r.get('/menu/categories', (req, res) => res.json(store.categories.map(toMenuCategory)));
  r.post('/menu/categories', devRequirePerm('menu.edit'), (req, res) => {
    const c = { id: nid(), orgId: '1', storeId: '1', name: req.body.name, color: req.body.color ?? null, sortOrder: req.body.sortOrder || store.categories.length + 1, isActive: true };
    store.categories.push(c); res.status(201).json(toMenuCategory(c));
  });
  r.put('/menu/categories/:id', devRequirePerm('menu.edit'), (req, res) => {
    const c = store.categories.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (req.body.name !== undefined) c.name = req.body.name;
    if (req.body.color !== undefined) c.color = req.body.color;
    if (req.body.sortOrder !== undefined) c.sortOrder = req.body.sortOrder;
    if (req.body.isActive !== undefined) c.isActive = req.body.isActive;
    res.json(toMenuCategory(c));
  });
  r.delete('/menu/categories/:id', devRequirePerm('menu.edit'), (req, res) => {
    store.categories = store.categories.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/bases', (req, res) => {
    let list = store.bases;
    if (req.query.category) list = list.filter((b) => b.categoryId === String(req.query.category));
    res.json(list.map(toMenuBase));
  });
  r.post('/menu/bases', devRequirePerm('menu.edit'), (req, res) => {
    const b = { id: nid(), orgId: '1', storeId: '1', categoryId: req.body.categoryId || null, name: req.body.name, basePrice: req.body.basePrice ?? 0, sortOrder: req.body.sortOrder || 1, isActive: true };
    store.bases.push(b); res.status(201).json(toMenuBase(b));
  });
  r.put('/menu/bases/:id', devRequirePerm('menu.edit'), (req, res) => {
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
  r.delete('/menu/bases/:id', devRequirePerm('menu.edit'), (req, res) => {
    store.bases = store.bases.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/modifiers', (req, res) => res.json(store.modifiers.map(toModifier)));
  r.post('/menu/modifiers', devRequirePerm('menu.edit'), (req, res) => {
    const m = { id: nid(), orgId: '1', storeId: '1', code: req.body.code, label: req.body.label ?? null, defaultDelta: req.body.defaultDelta ?? 0, sortOrder: req.body.sortOrder || store.modifiers.length + 1, isActive: true };
    store.modifiers.push(m); res.status(201).json(toModifier(m));
  });
  r.put('/menu/modifiers/:id', devRequirePerm('menu.edit'), (req, res) => {
    const m = store.modifiers.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    Object.assign(m, {
      code: req.body.code ?? m.code, label: req.body.label ?? m.label,
      defaultDelta: req.body.defaultDelta ?? m.defaultDelta, sortOrder: req.body.sortOrder ?? m.sortOrder,
      isActive: req.body.isActive ?? m.isActive,
    });
    res.json(toModifier(m));
  });
  r.delete('/menu/modifiers/:id', devRequirePerm('menu.edit'), (req, res) => {
    store.modifiers = store.modifiers.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  r.get('/menu/base-modifiers', (req, res) => {
    let list = store.baseModifiers;
    if (req.query.baseId) list = list.filter((x) => x.baseId === String(req.query.baseId));
    res.json(list.map(toBaseModifier));
  });
  r.post('/menu/base-modifiers', devRequirePerm('menu.edit'), (req, res) => {
    const bm = { id: nid(), orgId: '1', storeId: '1', baseId: String(req.body.baseId), modifierId: String(req.body.modifierId), delta: req.body.delta == null ? null : req.body.delta };
    store.baseModifiers.push(bm); res.status(201).json(toBaseModifier(bm));
  });
  r.delete('/menu/base-modifiers/:id', devRequirePerm('menu.edit'), (req, res) => {
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
  r.post('/menu/variants', devRequirePerm('menu.edit'), (req, res) => {
    const b = req.body;
    const v = {
      id: nid(), orgId: '1', storeId: '1', baseId: String(b.baseId), categoryId: b.categoryId || null,
      code: b.code, name: b.name, modifierIds: b.modifierIds || [],
      price: b.price ?? 0, cost: b.cost ?? 0, stockQty: b.stockQty ?? 0, stockThreshold: b.stockThreshold ?? 0,
      barcode: b.barcode || null, sortOrder: b.sortOrder || store.variants.length + 1, isActive: true,
    };
    store.variants.push(v); res.status(201).json(toVariant(v));
  });
  r.put('/menu/variants/:id', devRequirePerm('menu.edit'), (req, res) => {
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
  r.delete('/menu/variants/:id', devRequirePerm('menu.edit'), (req, res) => {
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
    // 手动改状态时同步清掉占用关系，避免遗留 currentOrderId 指向已结单的订单
    if (t.status !== 'occupied') t.currentOrderId = null;
    io.to(`store:${t.storeId}`).emit('tables:changed', toTable(t));
    res.json(toTable(t));
  });

  // ---- 订单（item 引用 variantId） ----
  r.get('/orders', (req, res) => {
    let list = store.orders;
    if (req.query.status === 'running') list = list.filter((o) => RUNNING_STATUS.includes(o.status));
    else if (req.query.status) list = list.filter((o) => o.status === req.query.status);
    res.json(list.map(toOrder));
  });
  r.get('/orders/:id', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    res.json(toOrder(o));
  });
  r.post('/orders', devRequirePerm('order.create'), (req, res) => {
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
      createdBy: req.user.id, salesPersonId: b.salesPersonId ? String(b.salesPersonId) : null,
      memberId: b.memberId ? String(b.memberId) : null, voucherDiscount: 0, rebateRedeemed: 0,
      shiftId: store.shifts.find((s) => s.status === 'open')?.id || null, voidReason: null,
      createdAt: now(), updatedAt: now(),
    };
    store.orders.push(o);
    if (!held && o.type === 'dine_in' && o.tableId) {
      const t = store.tables.find((x) => x.id === o.tableId);
      if (t) { t.status = 'occupied'; t.currentOrderId = o.id; }
    }
    res.status(201).json(toOrder(o));
  });
  r.post('/orders/:id/items', devRequirePerm('order.create'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'open') return res.status(400).json({ error: 'order not open' });
    o.items.push({ ...req.body, status: 'pending' });
    const totals = computeOrderTotals(o.items, o.discount);
    Object.assign(o, totals); o.updatedAt = now();
    res.json(toOrder(o));
  });
  // 整单替换明细（取单后编辑再送厨房用）
  r.put('/orders/:id/items', devRequirePerm('order.create'), (req, res) => {
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
  // ---- 转台:把进行中的订单移到另一张桌 ----
  r.post('/orders/:id/transfer', devRequirePerm('order.transfer'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (!RUNNING_STATUS.includes(o.status)) return res.status(400).json({ error: 'only running orders can be transferred' });
    const targetId = req.body.tableId == null ? null : String(req.body.tableId);
    const target = store.tables.find((t) => t.id === targetId);
    if (!target) return res.status(404).json({ error: 'target table not found' });
    if (String(o.tableId) === targetId) return res.status(400).json({ error: 'already on this table' });
    if (target.status === 'occupied' && String(target.currentOrderId) !== String(o.id)) return res.status(400).json({ error: 'target table is occupied' });

    const from = store.tables.find((t) => t.id === String(o.tableId)) || null;
    if (from) { from.status = 'free'; from.currentOrderId = null; }
    target.status = 'occupied'; target.currentOrderId = o.id;
    o.tableId = target.id; o.type = 'dine_in'; o.updatedAt = now();

    const record = {
      id: nid(), orgId: '1', storeId: '1', type: 'transfer', orderId: o.id, orderNo: o.orderNo,
      fromTableId: from ? from.id : null, fromTableNo: from ? from.number : null,
      toTableId: target.id, toTableNo: target.number,
      mergedOrderIds: [], mergedOrderNos: [],
      amount: Number(o.total || 0), reason: req.body.reason || '', createdBy: req.user.id, createdByName: req.user.name, createdAt: now(),
    };
    store.orderTransfers.unshift(record);
    io.to(`store:${o.storeId}`).emit('order:created', toOrder(o));
    io.to(`store:${o.storeId}`).emit('tables:changed');
    res.json({ order: toOrder(o), transfer: record });
  });

  // ---- 并台:把多张进行中的单合并到第一张(或指定的主单) ----
  r.post('/orders/merge', devRequirePerm('order.merge'), (req, res) => {
    const ids = (req.body.orderIds || []).map(String);
    if (ids.length < 2) return res.status(400).json({ error: 'need at least 2 orders' });
    const list = ids.map((id) => store.orders.find((x) => x.id === id)).filter(Boolean);
    if (list.length !== ids.length) return res.status(404).json({ error: 'some orders not found' });
    for (const o of list) {
      if (!RUNNING_STATUS.includes(o.status)) return res.status(400).json({ error: `order ${o.orderNo} is not mergeable` });
    }
    const primary = (req.body.targetOrderId && list.find((x) => x.id === String(req.body.targetOrderId))) || list[0];
    const others = list.filter((o) => o.id !== primary.id);
    if (!others.length) return res.status(400).json({ error: 'nothing to merge' });

    primary.items = [...primary.items, ...others.flatMap((o) => o.items)];
    primary.discount = round2(Number(primary.discount || 0) + others.reduce((s, o) => s + Number(o.discount || 0), 0));
    Object.assign(primary, computeOrderTotals(primary.items, primary.discount));
    primary.updatedAt = now();

    const targetId = req.body.tableId != null ? String(req.body.tableId) : (primary.tableId ? String(primary.tableId) : null);
    const targetTable = targetId ? store.tables.find((t) => t.id === targetId) : null;
    if (targetTable) { targetTable.status = 'occupied'; targetTable.currentOrderId = primary.id; primary.tableId = targetTable.id; }

    for (const o of others) {
      const t = o.tableId ? store.tables.find((x) => x.id === String(o.tableId)) : null;
      if (t && (!targetTable || t.id !== targetTable.id)) { t.status = 'free'; t.currentOrderId = null; }
      o.status = 'merged'; o.mergedIntoOrderId = primary.id; o.updatedAt = now();
      io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
    }

    const firstFrom = store.tables.find((t) => t.id === String(others[0].tableId)) || null;
    const record = {
      id: nid(), orgId: '1', storeId: '1', type: 'merge', orderId: primary.id, orderNo: primary.orderNo,
      fromTableId: firstFrom ? firstFrom.id : null, fromTableNo: firstFrom ? firstFrom.number : null,
      toTableId: targetTable ? targetTable.id : null, toTableNo: targetTable ? targetTable.number : null,
      mergedOrderIds: others.map((o) => o.id), mergedOrderNos: others.map((o) => o.orderNo),
      amount: round2(others.reduce((s, o) => s + Number(o.total || 0), 0)),
      reason: req.body.reason || '', createdBy: req.user.id, createdByName: req.user.name, createdAt: now(),
    };
    store.orderTransfers.unshift(record);
    io.to(`store:${primary.storeId}`).emit('order:created', toOrder(primary));
    io.to(`store:${primary.storeId}`).emit('tables:changed');
    res.json({ order: toOrder(primary), merged: others.map(toOrder), merge: record });
  });

  r.get('/transfers', (req, res) => {
    const type = req.query.type;
    res.json(type ? store.orderTransfers.filter((t) => t.type === type) : store.orderTransfers);
  });

  // ---- 销售员 ----
  r.get('/sales-persons', (req, res) => res.json(store.users.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name, role: u.role, code: u.phone }))));
  r.put('/orders/:id/sales-person', devRequirePerm('order.sales_person'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    o.salesPersonId = req.body.salesPersonId ? String(req.body.salesPersonId) : null;
    o.updatedAt = now();
    res.json(toOrder(o));
  });
  // 结账前挂/换会员:返利抵扣必须基于订单上的会员,所以允许在 Payment 之前补挂。
  r.put('/orders/:id/member', devRequirePerm('payment.settle'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status === 'paid' || o.status === 'void') return res.status(400).json({ error: 'cannot change member on a closed order' });
    const memberId = req.body.memberId ? String(req.body.memberId) : null;
    if (memberId && !memberOf(memberId)) return res.status(400).json({ error: 'member not found' });
    o.memberId = memberId;
    o.updatedAt = now();
    res.json(toOrder(o));
  });

  r.post('/orders/:id/checkout', devRequirePerm('payment.settle'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status === 'paid' || o.status === 'void') return res.status(400).json({ error: 'already closed' });

    // ---- 先校验所有抵扣（礼券 / 返利），任何一项不通过就整体不落账 ----
    const voucherInputs = (req.body.vouchers || []).map((x) => ({ code: x.code, amount: round2(x.amount) }));
    const rebateAmount = round2(req.body.rebateAmount || 0);
    const resolved = [];
    let voucherTotal = 0;
    for (const vi of voucherInputs) {
      const v = voucherByCode(vi.code);
      if (!v) return res.status(400).json({ error: `voucher not found: ${vi.code}` });
      const st = voucherStatus(v);
      if (st !== 'active') return res.status(400).json({ error: `voucher ${v.code} is ${st}` });
      if (!(vi.amount > 0)) return res.status(400).json({ error: `voucher ${v.code} amount must be positive` });
      if (vi.amount > Number(v.balance) + 0.001) return res.status(400).json({ error: `voucher ${v.code} balance insufficient (${round2(v.balance)})` });
      resolved.push({ v, amount: vi.amount });
      voucherTotal = round2(voucherTotal + vi.amount);
    }
    let rebateMember = null;
    if (rebateAmount > 0) {
      rebateMember = o.memberId ? memberOf(o.memberId) : null;
      if (!rebateMember) return res.status(400).json({ error: 'rebate requires a member on the order' });
      if (rebateAmount > Number(rebateMember.rebateBalance || 0) + 0.001) return res.status(400).json({ error: `rebate balance insufficient (${round2(rebateMember.rebateBalance)})` });
    }
    const discountTotal = round2(voucherTotal + rebateAmount);
    const dueAfterDiscount = Math.max(0, round2(Number(o.total || 0) - discountTotal));
    const paidSum = (req.body.payments || []).reduce((s, x) => s + Number(x.amount), 0);
    if (paidSum + Number(req.body.tip || 0) < dueAfterDiscount) {
      return res.status(400).json({ error: `amount not covered: due ${dueAfterDiscount}` });
    }

    // ---- 校验通过，正式落账 ----
    const appliedVouchers = [];
    for (const r0 of resolved) {
      const rr = redeemVoucher(r0.v, r0.amount, { orderId: o.id, orderNo: o.orderNo, memberId: o.memberId, reason: 'redeemed at checkout' }, req.user);
      if (!rr.ok) return res.status(400).json({ error: rr.error });   // 理论不可达，前面已校验
      appliedVouchers.push({ code: r0.v.code, voucherNo: r0.v.voucherNo, amount: r0.amount, balanceAfter: r0.v.balance });
      store.payments.push({ id: nid(), orgId: '1', storeId: '1', orderId: o.id, method: 'voucher', amount: r0.amount, tip: 0, createdAt: now() });
    }
    if (rebateAmount > 0) {
      pushRebate(rebateMember, 'redeem', rebateAmount, { orderId: o.id, orderNo: o.orderNo, orderTotal: Number(o.total || 0), reason: 'rebate redeemed at checkout' }, req.user);
      store.payments.push({ id: nid(), orgId: '1', storeId: '1', orderId: o.id, method: 'rebate', amount: rebateAmount, tip: 0, createdAt: now() });
    }
    for (const pm of normalizePayments(req.body.payments, dueAfterDiscount)) {
      store.payments.push({ id: nid(), orgId: '1', storeId: '1', orderId: o.id, method: pm.method, amount: pm.amount, tip: 0, createdAt: now() });
    }
    o.voucherDiscount = discountTotal; o.rebateRedeemed = rebateAmount;
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

    // ---- 自动返利：按 settings.rebatePercent 对实付金额计返利（会员单才计） ----
    let rebateEarned = null;
    const rebatePct = Number(s.rebatePercent || 0);
    if (rebatePct > 0 && o.memberId) {
      const earnMember = memberOf(o.memberId);
      if (earnMember) {
        const base = Math.max(0, round2(Number(o.total || 0) - discountTotal));
        const earn = round2(base * rebatePct / 100);
        if (earn > 0) {
          const days = Number(s.rebateExpiryDays || 0);
          const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
          const row = pushRebate(earnMember, 'earn', earn, {
            orderId: o.id, orderNo: o.orderNo, orderTotal: base, percent: rebatePct,
            reason: `auto rebate ${rebatePct}%`, expiresAt,
          }, req.user);
          rebateEarned = toRebate(row);
        }
      }
    }

    io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
    if (low.length) io.to(`store:${o.storeId}`).emit('inventory:low', low);
    const payments = store.payments.filter((p) => p.orderId === o.id);
    res.json({
      order: toOrder(o),
      appliedVouchers,
      rebateRedeemed: rebateAmount,
      rebateEarned,
      dueAfterDiscount,
      receipt: {
        storeName: s.companyName || 'Demo Store', address: s.address || '', phone: s.phone || '', gstNo: s.gstNo || '',
        orderNo: o.orderNo, invoiceNo: o.invoiceNo, items: o.items, subtotal: o.subtotal, discount: o.discount,
        serviceCharge: o.serviceCharge, tax: o.tax, taxRate: s.taxRate, taxInclusive: s.taxInclusive, total: o.total,
        voucherDiscount: discountTotal, rebateRedeemed: rebateAmount,
        rebateEarned: rebateEarned ? Number(rebateEarned.amount || 0) : 0,
        payments, footer: s.receiptFooter || '', createdAt: o.createdAt,
      },
    });
  });
  r.post('/orders/:id/void', devRequirePerm('order.void'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (['paid', 'void', 'void_pending'].includes(o.status)) return res.status(400).json({ error: 'cannot void this order' });
    o.status = 'void_pending'; o.voidRequestedBy = req.user.id; o.voidReason = req.body.reason || null; o.updatedAt = now();
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'free'; t.currentOrderId = null; } }
    res.json(toOrder(o));
  });
  r.post('/orders/:id/void/approve', devRequirePerm('order.void_approve'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
    o.status = 'void'; o.voidApprovedBy = req.user.id; o.updatedAt = now();
    io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'free'; t.currentOrderId = null; } }
    res.json(toOrder(o));
  });
  r.post('/orders/:id/void/reject', devRequirePerm('order.void_approve'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
    o.status = 'open'; o.voidRequestedBy = null; o.voidReason = null; o.voidRejectReason = req.body?.reason || null; o.updatedAt = now();
    io.to(`store:${o.storeId}`).emit('order:created', toOrder(o));
    res.json(toOrder(o));
  });

  // ---- 挂单 Hold / 取单 Recall ----
  r.get('/holds', (req, res) => res.json(store.orders.filter((o) => o.status === 'hold').map(toOrder)));
  r.post('/orders/:id/hold', devRequirePerm('order.hold'), (req, res) => {
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
  r.post('/orders/:id/recall', devRequirePerm('order.hold'), (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'hold') return res.status(400).json({ error: 'order is not on hold' });
    o.status = 'open'; o.heldAt = null; o.updatedAt = now();
    if (o.type === 'dine_in' && o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'occupied'; t.currentOrderId = o.id; } }
    res.json(toOrder(o));
  });

  // ---- 反结算 Unsettle：把已结算单退回未结算 ----
  r.get('/unsettles', (req, res) => res.json(store.unsettles));
  r.post('/orders/:id/unsettle', devRequirePerm('order.unsettle'), (req, res) => {
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
  r.post('/orders/:id/reprint', devRequirePerm('reprint'), (req, res) => {
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
  r.post('/orders/:id/split', devRequirePerm('order.split'), (req, res) => {
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
  r.post('/orders/:id/refund', devRequirePerm('payment.refund'), (req, res) => {
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
  r.put('/settings', devRequirePerm('settings.edit'), (req, res) => res.json(setSettings(req.body)));

  // ---- 促销 Promotion ----
  r.get('/promotions', (req, res) => res.json(store.promotions.map(toPromotion)));
  r.post('/promotions', devRequirePerm('order.discount'), (req, res) => {
    const b = req.body || {};
    const p = { id: nid(), orgId: '1', storeId: '1', code: b.code || `PROMO${store.promotions.length + 1}`, name: b.name || '', type: b.type || 'percent', value: Number(b.value || 0), minSpend: Number(b.minSpend || 0), validFrom: b.validFrom || null, validUntil: b.validUntil || null, isActive: b.isActive !== false, createdAt: now() };
    store.promotions.push(p); res.status(201).json(toPromotion(p));
  });
  r.put('/promotions/:id', devRequirePerm('order.discount'), (req, res) => {
    const p = store.promotions.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    Object.assign(p, { code: req.body.code ?? p.code, name: req.body.name ?? p.name, type: req.body.type ?? p.type, value: req.body.value !== undefined ? Number(req.body.value) : p.value, minSpend: req.body.minSpend !== undefined ? Number(req.body.minSpend) : p.minSpend, validFrom: req.body.validFrom ?? p.validFrom, validUntil: req.body.validUntil ?? p.validUntil, isActive: req.body.isActive ?? p.isActive });
    res.json(toPromotion(p));
  });
  r.delete('/promotions/:id', devRequirePerm('order.discount'), (req, res) => { store.promotions = store.promotions.filter((x) => x.id !== req.params.id); res.json({ ok: true }); });
  r.get('/promotions/apply', (req, res) => {
    const code = String(req.query.code || '').toUpperCase();
    const amount = Number(req.query.amount || 0);
    const p = store.promotions.find((x) => x.code.toUpperCase() === code && x.isActive);
    if (!p) return res.status(404).json({ error: 'promotion not found' });
    if (amount < p.minSpend) return res.status(400).json({ error: `min spend ${p.minSpend}` });
    const discount = p.type === 'percent' ? Math.round(amount * p.value) / 100 : Math.min(p.value, amount);
    res.json({ promotion: toPromotion(p), discount: Math.round(discount * 100) / 100 });
  });

  // ================= 礼券 Gift Voucher =================
  // 有效状态：过期的自动降级为 expired（惰性计算，不依赖定时任务）
  const voucherStatus = (v) => {
    if (v.status === 'void' || v.status === 'used') return v.status;
    if (v.expiresAt && new Date(v.expiresAt).getTime() < Date.now()) return 'expired';
    return v.status === 'active' ? 'active' : v.status;
  };
  const voucherByCode = (code) => store.vouchers.find((v) => String(v.code).toUpperCase() === String(code || '').trim().toUpperCase());
  const nextVoucherCode = () => {
    const prefix = getSettings().voucherPrefix || 'GV';
    let max = 1000;
    for (const v of store.vouchers) {
      const m = String(v.code).match(/(\d+)\s*$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${prefix}-${max + 1}`;
  };
  const pushVoucherTxn = (v, type, amount, balanceAfter, extra = {}, user) => {
    const row = {
      id: nid(), orgId: '1', storeId: '1', voucherId: v.id, voucherNo: v.voucherNo, code: v.code,
      type, amount: round2(amount), balanceAfter: round2(balanceAfter),
      orderId: extra.orderId || null, orderNo: extra.orderNo || null, memberId: extra.memberId || null,
      reason: extra.reason || null,
      createdBy: user ? user.id : null, createdByName: user ? user.name : null, createdAt: now(),
    };
    store.voucherTxns.push(row);
    return row;
  };
  // 核销校验 + 落账；返回 { ok, error, voucher, txn }，供 /redeem 与 checkout 复用
  const redeemVoucher = (v, amount, ctx = {}, user) => {
    if (!v) return { ok: false, error: 'voucher not found' };
    const st = voucherStatus(v);
    if (st === 'void') return { ok: false, error: 'voucher is void' };
    if (st === 'expired') return { ok: false, error: 'voucher expired' };
    if (Number(v.balance) <= 0) return { ok: false, error: 'voucher has no balance' };
    const amt = round2(amount);
    if (!(amt > 0)) return { ok: false, error: 'amount must be positive' };
    if (amt > Number(v.balance) + 0.001) return { ok: false, error: `amount exceeds balance ${round2(v.balance)}` };
    v.balance = round2(Number(v.balance) - amt);
    if (v.balance <= 0) { v.balance = 0; v.status = 'used'; }
    v.updatedAt = now();
    const txn = pushVoucherTxn(v, 'redeem', amt, v.balance, ctx, user);
    return { ok: true, voucher: v, txn };
  };

  r.get('/vouchers', (req, res) => {
    let list = store.vouchers.map(toVoucher);
    const status = req.query.status;
    if (status && status !== 'all') list = list.filter((v) => voucherStatus(v) === status);
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) list = list.filter((v) => [v.code, v.voucherNo, v.issuedToName, v.issuedToPhone].some((f) => String(f || '').toLowerCase().includes(q)));
    if (req.query.memberId) list = list.filter((v) => String(v.issuedToMemberId) === String(req.query.memberId));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(list);
  });
  // 注意：字面量路由必须排在 /:id 之前
  r.get('/vouchers/summary', (req, res) => {
    const all = store.vouchers.map((v) => ({ ...v, effectiveStatus: voucherStatus(v) }));
    const outstanding = all.filter((v) => v.effectiveStatus === 'active').reduce((s, v) => s + Number(v.balance || 0), 0);
    const faceIssued = all.reduce((s, v) => s + Number(v.faceValue || 0), 0);
    const redeemed = all.reduce((s, v) => s + (Number(v.faceValue || 0) - Number(v.balance || 0)), 0);
    const byStatus = all.reduce((a, v) => { a[v.effectiveStatus] = (a[v.effectiveStatus] || 0) + 1; return a; }, {});
    res.json({
      count: all.length, outstandingBalance: round2(outstanding),
      faceIssued: round2(faceIssued), redeemedTotal: round2(redeemed), byStatus,
    });
  });
  r.get('/vouchers/lookup', (req, res) => {
    const v = voucherByCode(req.query.code);
    if (!v) return res.status(404).json({ error: 'voucher not found' });
    const amount = Number(req.query.amount || 0);
    const st = voucherStatus(v);
    res.json({
      voucher: toVoucher(v), status: st,
      redeemable: st === 'active' && Number(v.balance) > 0,
      maxRedeemable: st === 'active' ? round2(v.balance) : 0,
      suggestedAmount: amount > 0 ? Math.min(round2(amount), round2(v.balance)) : round2(v.balance),
      recentTxns: store.voucherTxns.filter((t) => t.voucherId === v.id).slice(-5).map(toVoucherTxn),
    });
  });
  r.get('/vouchers/:id', (req, res) => {
    const v = store.vouchers.find((x) => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: 'not found' });
    res.json({ ...toVoucher(v), status: voucherStatus(v), txns: store.voucherTxns.filter((t) => t.voucherId === v.id).map(toVoucherTxn) });
  });
  r.get('/vouchers/:id/txns', (req, res) => res.json(store.voucherTxns.filter((t) => t.voucherId === req.params.id).map(toVoucherTxn)));
  r.post('/vouchers', devRequirePerm('member.voucher_issue'), (req, res) => {
    const b = req.body || {};
    const face = round2(b.faceValue);
    if (!(face > 0)) return res.status(400).json({ error: 'faceValue must be positive' });
    const code = String(b.code || '').trim() || nextVoucherCode();
    if (voucherByCode(code)) return res.status(409).json({ error: 'voucher code already exists' });
    const member = b.issuedToMemberId ? store.members.find((m) => String(m.id) === String(b.issuedToMemberId)) : null;
    const seq = store.vouchers.length + 1;
    const v = {
      id: nid(), orgId: '1', storeId: '1',
      voucherNo: b.voucherNo || `${getSettings().voucherPrefix || 'GV'}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(seq).padStart(3, '0')}`,
      code, faceValue: face, balance: b.balance !== undefined ? round2(b.balance) : face,
      status: 'active',
      issuedToMemberId: member ? member.id : null,
      issuedToName: b.issuedToName || (member ? member.name : null),
      issuedToPhone: b.issuedToPhone || (member ? member.phone : null),
      soldAmount: b.soldAmount !== undefined ? round2(b.soldAmount) : face,
      note: b.note || null,
      issuedAt: now(), expiresAt: b.expiresAt || null, voidedAt: null, voidReason: null,
      createdBy: req.user.id, createdByName: req.user.name, createdAt: now(), updatedAt: now(),
    };
    store.vouchers.push(v);
    pushVoucherTxn(v, 'issue', v.faceValue, v.balance, { memberId: v.issuedToMemberId, reason: b.note || 'voucher issued' }, req.user);
    res.status(201).json(toVoucher(v));
  });
  r.post('/vouchers/:id/redeem', (req, res) => {
    const v = store.vouchers.find((x) => x.id === req.params.id);
    const r0 = redeemVoucher(v, req.body.amount, {
      orderId: req.body.orderId || null, orderNo: req.body.orderNo || null, reason: req.body.reason || 'redeemed at cashier',
    }, req.user);
    if (!r0.ok) return res.status(400).json({ error: r0.error });
    res.json({ voucher: toVoucher(r0.voucher), txn: toVoucherTxn(r0.txn) });
  });
  r.post('/vouchers/:id/void', devRequirePerm('member.voucher_void'), (req, res) => {
    const v = store.vouchers.find((x) => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: 'not found' });
    if (v.status === 'void') return res.status(400).json({ error: 'already void' });
    const hadBalance = Number(v.balance || 0);
    v.status = 'void'; v.voidedAt = now(); v.voidReason = req.body.reason || 'voided by staff';
    v.balance = 0; v.updatedAt = now();
    pushVoucherTxn(v, 'void', hadBalance, 0, { reason: v.voidReason }, req.user);
    res.json(toVoucher(v));
  });

  // ================= 返利 Rebate =================
  const memberOf = (id) => store.members.find((m) => String(m.id) === String(id));
  const pushRebate = (m, type, amount, extra = {}, user) => {
    const delta = type === 'redeem' ? -Math.abs(round2(amount)) : round2(amount);
    m.rebateBalance = Math.max(0, round2(Number(m.rebateBalance || 0) + delta));
    const row = {
      id: nid(), orgId: '1', storeId: '1', memberId: m.id, memberNo: m.memberNo, memberName: m.name,
      type, amount: Math.abs(round2(amount)), balanceAfter: m.rebateBalance,
      orderId: extra.orderId || null, orderNo: extra.orderNo || null,
      orderTotal: extra.orderTotal || 0, percent: extra.percent || 0,
      reason: extra.reason || null, expiresAt: extra.expiresAt || null,
      createdBy: user ? user.id : null, createdByName: user ? user.name : null, createdAt: now(),
    };
    store.rebates.push(row);
    return row;
  };

  r.get('/rebates', (req, res) => {
    let list = store.rebates.map(toRebate);
    if (req.query.memberId) list = list.filter((x) => String(x.memberId) === String(req.query.memberId));
    if (req.query.type) list = list.filter((x) => x.type === req.query.type);
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(list);
  });
  r.get('/rebates/summary', (req, res) => {
    const earned = store.rebates.filter((x) => x.type === 'earn').reduce((s, x) => s + Number(x.amount), 0);
    const redeemed = store.rebates.filter((x) => x.type === 'redeem').reduce((s, x) => s + Number(x.amount), 0);
    const outstanding = store.members.reduce((s, m) => s + Number(m.rebateBalance || 0), 0);
    res.json({
      earnedTotal: round2(earned), redeemedTotal: round2(redeemed),
      outstandingBalance: round2(outstanding), entries: store.rebates.length,
      membersWithRebate: store.members.filter((m) => Number(m.rebateBalance || 0) > 0).length,
    });
  });
  r.post('/rebates', devRequirePerm('member.rebate'), (req, res) => {
    const b = req.body || {};
    const m = memberOf(b.memberId);
    if (!m) return res.status(404).json({ error: 'member not found' });
    const amt = round2(b.amount);
    if (!(amt > 0)) return res.status(400).json({ error: 'amount must be positive' });
    const type = b.type === 'redeem' ? 'redeem' : 'earn';
    if (type === 'redeem' && amt > Number(m.rebateBalance || 0) + 0.001) return res.status(400).json({ error: 'insufficient rebate balance' });
    const row = pushRebate(m, type, amt, { reason: b.reason || 'manual adjustment', expiresAt: b.expiresAt || null }, req.user);
    res.status(201).json({ member: toMember(m), entry: toRebate(row) });
  });
  r.post('/members/:id/rebate', devRequirePerm('member.rebate'), (req, res) => {
    const m = memberOf(req.params.id);
    if (!m) return res.status(404).json({ error: 'member not found' });
    const amt = round2(req.body.amount);
    if (!(amt > 0)) return res.status(400).json({ error: 'amount must be positive' });
    const type = req.body.type === 'redeem' ? 'redeem' : 'earn';
    if (type === 'redeem' && amt > Number(m.rebateBalance || 0) + 0.001) return res.status(400).json({ error: 'insufficient rebate balance' });
    const row = pushRebate(m, type, amt, {
      orderId: req.body.orderId || null, orderNo: req.body.orderNo || null,
      reason: req.body.reason || (type === 'earn' ? 'manual rebate' : 'rebate redeemed'),
    }, req.user);
    res.json({ member: toMember(m), entry: toRebate(row) });
  });
  // 会员返利流水（合并进原有 ledger）
  r.get('/members/:id/rebate-ledger', (req, res) => res.json(store.rebates.filter((x) => String(x.memberId) === String(req.params.id)).map(toRebate)));

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
  r.post('/stock-takes', devRequirePerm('stock.take'), (req, res) => {
    const lines = store.variants.map((v) => ({ itemId: v.id, code: v.code, name: v.name, systemQty: Number(v.stockQty || 0), countedQty: null, variance: 0 }));
    const st = { id: nid(), orgId: '1', storeId: '1', takeNo: `ST${Date.now()}`, status: 'draft', lines, createdBy: req.user.id, createdAt: now(), postedAt: null };
    store.stockTakes.unshift(st); res.status(201).json(toStockTake(st));
  });
  r.put('/stock-takes/:id', devRequirePerm('stock.take'), (req, res) => {
    const st = store.stockTakes.find((x) => x.id === req.params.id);
    if (!st) return res.status(404).json({ error: 'not found' });
    if (st.status !== 'draft') return res.status(400).json({ error: 'already posted' });
    for (const upd of req.body?.lines || []) {
      const line = st.lines.find((l) => String(l.itemId) === String(upd.itemId));
      if (line) { line.countedQty = Number(upd.countedQty || 0); line.variance = line.countedQty - line.systemQty; }
    }
    res.json(toStockTake(st));
  });
  r.post('/stock-takes/:id/post', devRequirePerm('stock.take'), (req, res) => {
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
  r.get('/report-templates', devRequirePerm('report.view'), (req, res) => res.json(store.reportTemplates.map(toReportTemplate)));
  r.post('/report-templates', devRequirePerm('report.design'), (req, res) => {
    const b = req.body || {};
    const t = {
      id: nid(), orgId: '1', storeId: '1',
      type: b.type || 'sales_by_date', name: b.name || 'Custom Report',
      columns: b.columns || [], filters: b.filters || {}, sort: b.sort || null,
      format: b.format || 'csv', isSystem: false, createdAt: now(),
    };
    store.reportTemplates.push(t); res.status(201).json(toReportTemplate(t));
  });
  r.put('/report-templates/:id', devRequirePerm('report.design'), (req, res) => {
    const t = store.reportTemplates.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    for (const k of ['type', 'name', 'columns', 'filters', 'sort', 'format']) if (b[k] !== undefined) t[k] = b[k];
    res.json(toReportTemplate(t));
  });
  r.delete('/report-templates/:id', devRequirePerm('report.design'), (req, res) => { store.reportTemplates = store.reportTemplates.filter((x) => x.id !== req.params.id); res.json({ ok: true }); });

  // ---- 硬件 Hardware ----
  r.get('/hardware/printers', (req, res) => res.json(store.printers.map(toPrinter)));
  r.post('/hardware/printers', devRequirePerm('printer.manage'), (req, res) => {
    const b = req.body || {};
    const p = { id: nid(), orgId: '1', storeId: '1', name: b.name || 'Printer', target: b.target || 'receipt', connection: b.connection || 'usb', width: Number(b.width || 80), isDefault: !!b.isDefault, isActive: b.isActive !== false };
    store.printers.push(p); res.status(201).json(toPrinter(p));
  });
  r.put('/hardware/printers/:id', devRequirePerm('printer.manage'), (req, res) => {
    const p = store.printers.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    Object.assign(p, { name: req.body.name ?? p.name, target: req.body.target ?? p.target, connection: req.body.connection ?? p.connection, width: req.body.width !== undefined ? Number(req.body.width) : p.width, isDefault: req.body.isDefault ?? p.isDefault, isActive: req.body.isActive ?? p.isActive });
    res.json(toPrinter(p));
  });
  r.post('/hardware/print', devRequirePerm('reprint'), (req, res) => {
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
  r.post('/hardware/drawer', devRequirePerm('payment.open_drawer'), (req, res) => {
    const job = { id: nid(), orgId: '1', storeId: '1', target: 'drawer', payload: 'ESC/POS: 1B 70 00 19 FA', status: 'sent', createdBy: req.user.id, createdAt: now() };
    store.printJobs.unshift(job);
    res.json({ ok: true, job });
  });

  // ---- GST 汇总报表(支持日期区间) ----
  r.get('/reports/gst', devRequirePerm('report.view'), (req, res) => {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const inRange = makeFilter(from, to);
    const s = getSettings();
    const paid = store.orders.filter((o) => (o.status === 'paid' || o.status === 'refunded') && inRange(o.createdAt));
    const outputTax = round2(paid.reduce((sum, o) => sum + Number(o.tax || 0), 0));
    const refunded = store.refunds.filter((x) => inRange(x.createdAt)).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const rate = Number(s.taxRate || 0);
    const refundTax = rate ? round2(refunded * (rate / (100 + rate))) : 0;
    res.json({ from, to, taxRate: s.taxRate, taxInclusive: s.taxInclusive, taxableSales: round2(paid.reduce((sum, o) => sum + Number(o.total || 0), 0)), outputTax, refundTax, netTax: round2(outputTax - refundTax), invoiceCount: store.invoices.filter((v) => inRange(v.createdAt)).length });
  });

  // ---- 重打中心：按类型/日期/桌号/收银员检索历史单据 ----
  r.get('/reports/reprint', devRequirePerm('report.view'), (req, res) => {
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
  r.get('/inventory/items', devRequirePerm('stock.view'), (req, res) => {
    let list = store.inventory;
    if (req.query.category) list = list.filter((x) => x.category === req.query.category);
    if (req.query.location) list = list.filter((x) => x.location === req.query.location);
    if (req.query.supplierId) list = list.filter((x) => String(x.supplierId) === String(req.query.supplierId));
    if (req.query.low === '1' || req.query.low === 'true') list = list.filter((x) => Number(x.quantity) < Number(x.threshold));
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((x) => String(x.name || '').toLowerCase().includes(q)
        || String(x.code || '').toLowerCase().includes(q)
        || String(x.barcode || '').toLowerCase().includes(q));
    }
    res.json(list.map(toInventoryItem));
  });
  r.post('/inventory/items', devRequirePerm('stock.take'), async (req, res) => {
    const b = req.body || {};
    const avgCost = Number(b.avgCost != null ? b.avgCost : (b.costPrice || 0));
    const inv = {
      id: nid(), orgId: '1', storeId: '1',
      code: b.code || null, name: b.name, category: b.category || null, barcode: b.barcode || null,
      unit: b.unit || null,
      quantity: 0, threshold: Number(b.threshold || 0),
      costPrice: b.costPrice == null ? null : Number(b.costPrice),
      avgCost, lastCost: Number(b.lastCost != null ? b.lastCost : avgCost),
      location: b.location || null,
      supplierId: b.supplierId || null, note: b.note || null, isActive: true,
      createdAt: now(), updatedAt: now(),
    };
    store.inventory.push(inv);
    // 期初数量走引擎,保证 quantity / avgCost / 台账三者一致
    const qty = Number(b.quantity || 0);
    if (qty !== 0) {
      const r = await applyMovements(devInventoryAdapter, [{
        itemId: inv.id, type: 'opening', qty, unitCost: avgCost, note: '新建物料期初',
      }], { orgId: '1', storeId: '1', createdBy: req.user.id, createdByName: req.user.name });
      if (!r.ok) return res.status(400).json({ error: r.errors[0].error, detail: r.errors[0] });
    }
    res.status(201).json(toInventoryItem(inv));
  });
  r.get('/inventory/items/:id', devRequirePerm('stock.view'), (req, res) => {
    const inv = store.inventory.find((x) => x.id === req.params.id);
    if (!inv) return res.status(404).json({ error: 'not found' });
    const movements = store.stockMovements
      .filter((m) => String(m.itemId) === inv.id)
      .sort((a, b) => {
        const t = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        if (t !== 0) return -t;
        return Number(b.id) - Number(a.id);
      })
      .slice(0, 50)
      .map(toStockMovement);
    res.json({ ...toInventoryItem(inv), movements });
  });
  r.put('/inventory/items/:id', devRequirePerm('stock.take'), (req, res) => {
    const inv = store.inventory.find((x) => x.id === req.params.id);
    if (!inv) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    // quantity 不允许在这里改(必须走 adjust 以便留台账)
    for (const k of ['code', 'name', 'category', 'barcode', 'unit', 'location', 'note']) {
      if (b[k] !== undefined) inv[k] = b[k];
    }
    if (b.threshold !== undefined) inv.threshold = Number(b.threshold);
    if (b.costPrice !== undefined) inv.costPrice = b.costPrice == null ? null : Number(b.costPrice);
    if (b.avgCost !== undefined) inv.avgCost = Number(b.avgCost || 0);
    if (b.lastCost !== undefined) inv.lastCost = Number(b.lastCost || 0);
    if (b.supplierId !== undefined) inv.supplierId = b.supplierId || null;
    if (b.isActive !== undefined) inv.isActive = !!b.isActive;
    inv.updatedAt = now();
    res.json(toInventoryItem(inv));
  });
  r.post('/inventory/adjust', devRequirePerm('stock.take'), async (req, res) => {
    const b = req.body || {};
    if (b.itemId == null) return res.status(400).json({ error: 'itemId required' });
    const type = b.type || 'adjustment';
    const r = await applyMovements(devInventoryAdapter, [{
      itemId: b.itemId, type, qty: b.delta, unitCost: b.unitCost,
      note: b.note || b.reason, location: b.location, refType: type, refNo: b.refNo,
    }], { orgId: '1', storeId: '1', createdBy: req.user.id, createdByName: req.user.name });
    if (!r.ok) {
      const e = r.errors[0];
      return res.status(e.error === 'item_not_found' ? 404 : 400).json({ error: e.error, detail: e });
    }
    devNotifyLow(req.app.get('io'), [b.itemId]);
    const inv = store.inventory.find((x) => x.id === String(b.itemId));
    res.json({ ...toInventoryItem(inv), movement: r.movements[0] });
  });
  // 批量盘点/调整:全通过才落库
  r.post('/inventory/adjust/batch', devRequirePerm('stock.take'), async (req, res) => {
    const b = req.body || {};
    const type = b.type || 'adjustment';
    const lines = (b.lines || []).map((l) => ({
      itemId: l.itemId, type,
      qty: l.qty != null ? l.qty : l.delta,
      unitCost: l.unitCost, note: l.note || b.reason, location: b.location, refType: type,
    }));
    if (!lines.length) return res.status(400).json({ error: 'no_lines' });
    const r = await applyMovements(devInventoryAdapter, lines, {
      orgId: '1', storeId: '1', createdBy: req.user.id, createdByName: req.user.name,
    });
    if (!r.ok) return res.status(400).json({ error: 'batch_failed', errors: r.errors });
    devNotifyLow(req.app.get('io'), lines.map((l) => l.itemId));
    res.json({ ok: true, count: r.movements.length, movements: r.movements });
  });
  r.get('/inventory/valuation', devRequirePerm('stock.view'), (req, res) => {
    res.json(valuationOf(store.inventory.map(toInventoryItem)));
  });
  r.get('/inventory/movements', devRequirePerm('stock.view'), (req, res) => {
    // 与生产同一口径:created_at DESC, 再按 id DESC 兜底 ——
    // 同一毫秒内写入的多笔必须有确定顺序,否则台账顺序会随机。
    let list = [...store.stockMovements].sort((a, b) => {
      const t = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      if (t !== 0) return -t;
      return Number(b.id) - Number(a.id);
    });
    if (req.query.itemId) list = list.filter((m) => String(m.itemId) === String(req.query.itemId));
    if (req.query.type) list = list.filter((m) => m.type === req.query.type);
    if (req.query.refType) list = list.filter((m) => m.refType === req.query.refType);
    if (req.query.refId) list = list.filter((m) => String(m.refId) === String(req.query.refId));
    if (req.query.from) list = list.filter((m) => String(m.createdAt || '').slice(0, 10) >= String(req.query.from));
    if (req.query.to) list = list.filter((m) => String(m.createdAt || '').slice(0, 10) <= String(req.query.to));
    const limit = Number(req.query.limit || 200);
    res.json(list.slice(0, limit).map(toStockMovement));
  });

  // ---- 报表 ----
  r.get('/reports/sales', devRequirePerm('report.view'), (req, res) => {
    const paid = store.orders.filter((o) => o.status === 'paid');
    const total = paid.reduce((s, o) => s + Number(o.total || 0), 0);
    const byMethod = {};
    for (const p of store.payments) byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount || 0);
    res.json({ from: now(), to: now(), total, count: paid.length, byMethod });
  });
  r.get('/reports/daily-close', devRequirePerm('report.view'), (req, res) => {
    const paid = store.orders.filter((o) => o.status === 'paid');
    const total = paid.reduce((s, o) => s + Number(o.total || 0), 0);
    const byMethod = {};
    for (const p of store.payments) byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount || 0);
    res.json({ date: now(), total, orderCount: paid.length, byMethod, saleMovements: 0 });
  });

  // ---- 会员 / 会员充值 / 积分 / Knock Off ----
  r.get('/members', (req, res) => res.json(store.members.map(toMember)));
  r.post('/members', devRequirePerm('member.create'), (req, res) => {
    const b = req.body || {};
    const m = { id: nid(), orgId: '1', storeId: '1', memberNo: b.memberNo || `M${String(store.members.length + 1).padStart(4, '0')}`, name: b.name || '', phone: b.phone || '', creditBalance: Number(b.creditBalance || 0), points: Number(b.points || 0), status: 'active', createdAt: now() };
    store.members.push(m); res.status(201).json(toMember(m));
  });
  r.put('/members/:id', devRequirePerm('member.create'), (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    Object.assign(m, { memberNo: req.body.memberNo ?? m.memberNo, name: req.body.name ?? m.name, phone: req.body.phone ?? m.phone, status: req.body.status ?? m.status });
    res.json(toMember(m));
  });
  r.post('/members/:id/top-up', devRequirePerm('member.topup'), (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id);
    const amount = Number(req.body.amount || 0);
    if (!m || amount <= 0) return res.status(400).json({ error: 'invalid member or amount' });
    m.creditBalance += amount;
    const topup = { id: nid(), memberId: m.id, receiptNo: `TU${Date.now()}`, amount, createdAt: now(), createdBy: req.user.id };
    store.memberTopups.push(topup); res.json({ member: toMember(m), topup });
  });
  r.get('/members/:id/ledger', (req, res) => res.json({ topups: store.memberTopups.filter((x) => x.memberId === req.params.id), points: store.pointsLedger.filter((x) => x.memberId === req.params.id) }));
  r.post('/members/:id/points', devRequirePerm('member.points'), (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id); const delta = Number(req.body.delta || 0);
    if (!m) return res.status(404).json({ error: 'not found' });
    m.points = Math.max(0, m.points + delta); const row = { id: nid(), memberId: m.id, delta, reason: req.body.reason || 'manual', createdAt: now() }; store.pointsLedger.push(row); res.json({ member: toMember(m), entry: row });
  });
  r.post('/members/:id/knock-off', devRequirePerm('payment.settle'), (req, res) => {
    const m = store.members.find((x) => x.id === req.params.id); const amount = Number(req.body.amount || 0);
    if (!m || amount <= 0 || amount > m.creditBalance) return res.status(400).json({ error: 'invalid amount' });
    m.creditBalance -= amount; res.json({ member: toMember(m), knockedOff: amount, receiptNo: `RV${Date.now()}` });
  });

  // ---- Cash In / Withdraw / Payment / Received / Credit Note ----
  r.get('/finance/movements', (req, res) => res.json(store.cashMovements.map(toMovement)));
  r.post('/finance/movements', devRequirePerm('payment.cash_move'), (req, res) => {
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
  r.post('/finance/credit-notes', devRequirePerm('payment.credit_note'), (req, res) => {
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
  r.post('/finance/credit-notes/:id/post', devRequirePerm('payment.credit_note'), (req, res) => {
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
  r.delete('/finance/credit-notes/:id', devRequirePerm('payment.credit_note'), (req, res) => {
    const c = store.creditNotes.find((x) => x.id === req.params.id);
    if (c && c.status === 'posted') return res.status(400).json({ error: 'posted note cannot be deleted' });
    store.creditNotes = store.creditNotes.filter((x) => x.id !== req.params.id);
    res.json({ ok: true });
  });

  // ---- 日结 Day End ----
  r.get('/reports/day-end', devRequirePerm('report.view'), (req, res) => res.json(dayEndSummary(req.query.date)));
  r.get('/reports/day-end/history', devRequirePerm('report.view'), (req, res) => res.json(store.dayEnds));
  r.get('/reports/day-end/:id', devRequirePerm('report.view'), (req, res) => {
    const d = store.dayEnds.find((x) => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'not found' });
    res.json(d);
  });
  r.post('/reports/day-end/close', devRequirePerm('day_end'), (req, res) => {
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
  r.post('/attendance', devRequirePerm('shift.manage'), (req, res) => {
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
  r.post('/shifts/open', devRequirePerm('shift.manage'), (req, res) => { const s = { id: nid(), orgId: '1', storeId: '1', cashierId: req.user.id, openAmount: Number(req.body.openAmount || 0), expectedAmount: Number(req.body.openAmount || 0), closeAmount: 0, difference: 0, status: 'open', openedAt: now(), closedAt: null }; store.shifts.push(s); res.status(201).json(toShift(s)); });
  r.post('/shifts/:id/close', devRequirePerm('shift.manage'), (req, res) => {
    const s = store.shifts.find((x) => x.id === req.params.id); if (!s || s.status !== 'open') return res.status(404).json({ error: 'open shift not found' });
    s.closeAmount = Number(req.body.closeAmount || 0); const paid = store.orders.filter((o) => o.status === 'paid' && o.shiftId === s.id); s.expectedAmount = s.openAmount + paid.reduce((sum, o) => sum + Number(o.total || 0), 0); s.difference = s.closeAmount - s.expectedAmount; s.status = 'closed'; s.closedAt = now(); res.json(toShift(s));
  });

  // ---- Suppliers / Purchase Order / GRN ----
  // ---- 供应商主档(带对账单 / 软删除) ----
  r.get('/suppliers', devRequirePerm('stock.view'), (req, res) => {
    let list = store.suppliers;
    if (req.query.status) list = list.filter((x) => (x.status || 'active') === req.query.status);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((x) => [x.name, x.code, x.phone, x.contactPerson, x.contact]
        .some((v) => String(v || '').toLowerCase().includes(q)));
    }
    list = [...list].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
    res.json(list.map(toSupplier));
  });
  const devNextSupplierCode = () => {
    let max = 0;
    for (const s of store.suppliers) {
      const n = parseInt(String(s.code || '').replace(/^SUP-/, ''), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `SUP-${String(max + 1).padStart(3, '0')}`;
  };
  r.get('/suppliers/next-code', devRequirePerm('stock.purchase'), (req, res) => res.json({ code: devNextSupplierCode() }));
  r.post('/suppliers', devRequirePerm('stock.purchase'), (req, res) => {
    const v = devParse(supplierSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: 'validation_failed', message: v.message });
    const b = v.data;
    const s = {
      id: nid(), orgId: '1', storeId: '1',
      code: b.code || devNextSupplierCode(), name: b.name,
      phone: b.phone || null, contact: b.contactPerson || b.contact || null,
      contactPerson: b.contactPerson || null,
      email: b.email || null, address: b.address || null, taxNo: b.taxNo || null,
      paymentTerms: b.paymentTerms || null, creditTermsDays: Number(b.creditTermsDays || 0),
      note: b.note || null, status: b.status === 'inactive' ? 'inactive' : 'active',
      createdAt: now(), updatedAt: now(),
    };
    store.suppliers.push(s);
    res.status(201).json(toSupplier(s));
  });
  r.get('/suppliers/:id', devRequirePerm('stock.view'), (req, res) => {
    const s = store.suppliers.find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json({
      ...toSupplier(s),
      purchaseOrders: store.purchaseOrders.filter((p) => String(p.supplierId) === s.id).map((p) => toPurchaseOrder(p)),
      items: store.inventory.filter((i) => String(i.supplierId) === s.id).map(toInventoryItem),
    });
  });
  r.put('/suppliers/:id', devRequirePerm('stock.purchase'), (req, res) => {
    const s = store.suppliers.find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const v = devParse(supplierSchema.partial(), req.body);
    if (!v.ok) return res.status(400).json({ error: 'validation_failed', message: v.message });
    const b = v.data;
    for (const k of ['code', 'name', 'phone', 'email', 'address', 'taxNo', 'paymentTerms', 'note', 'status']) {
      if (b[k] !== undefined) s[k] = b[k];
    }
    if (b.contactPerson !== undefined) { s.contactPerson = b.contactPerson; s.contact = b.contactPerson; }
    else if (b.contact !== undefined) s.contact = b.contact;
    if (b.creditTermsDays !== undefined) s.creditTermsDays = Number(b.creditTermsDays || 0);
    s.updatedAt = now();
    res.json(toSupplier(s));
  });
  r.put('/suppliers/:id/status', devRequirePerm('stock.purchase'), (req, res) => {
    const s = store.suppliers.find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    s.status = req.body?.status === 'inactive' ? 'inactive' : 'active';
    s.updatedAt = now();
    res.json(toSupplier(s));
  });
  r.delete('/suppliers/:id', devRequirePerm('stock.purchase'), (req, res) => {
    const idx = store.suppliers.findIndex((x) => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });
    // 有采购单往来就软删除,避免历史单据断链
    const used = store.purchaseOrders.some((p) => String(p.supplierId) === req.params.id);
    if (used) {
      store.suppliers[idx].status = 'inactive';
      store.suppliers[idx].updatedAt = now();
      return res.json({ ok: true, softDeleted: true, reason: 'has_purchase_orders' });
    }
    store.suppliers.splice(idx, 1);
    res.json({ ok: true, softDeleted: false });
  });
  // ---- 供应商对账单 ----
  r.get('/suppliers/:id/statement', devRequirePerm('stock.view'), (req, res) => {
    const s = store.suppliers.find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const from = req.query.from || null, to = req.query.to || null;
    const inRange = (d) => {
      const day = String(d || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    };
    const pos = store.purchaseOrders.filter((p) => String(p.supplierId) === s.id && inRange(p.createdAt));
    const grns = store.goodsReceipts.filter((g) => String(g.supplierId) === s.id && inRange(g.createdAt));
    const activePos = pos.filter((p) => p.status !== 'cancelled');
    const postedGrns = grns.filter((g) => g.status !== 'void');
    const entries = [];
    for (const p of activePos) {
      entries.push({ date: p.createdAt, type: 'po', refNo: p.poNo, poNo: p.poNo, status: p.status, ordered: Number(p.total || 0), received: 0, running: 0 });
    }
    for (const g of postedGrns) {
      entries.push({ date: g.createdAt, type: 'grn', refNo: g.grnNo, poNo: g.poNo, status: g.status, ordered: 0, received: Number(g.total || 0), running: 0 });
    }
    entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let running = 0;
    for (const e of entries) { running = round2(running + e.received); e.running = running; }
    const poTotal = round2(activePos.reduce((x, p) => x + Number(p.total || 0), 0));
    const receivedTotal = round2(postedGrns.reduce((x, g) => x + Number(g.total || 0), 0));
    res.json({
      supplier: toSupplier(s), from, to,
      summary: {
        poCount: activePos.length, poTotal,
        grnCount: postedGrns.length, receivedTotal,
        outstanding: round2(poTotal - receivedTotal),
        cancelledCount: pos.length - activePos.length,
        voidedGrnCount: grns.length - postedGrns.length,
        lastOrderAt: activePos.length ? activePos[activePos.length - 1].createdAt : null,
      },
      entries,
      purchaseOrders: activePos.map((p) => toPurchaseOrder(p)),
      goodsReceipts: postedGrns.map((g) => toGoodsReceipt(g)),
    });
  });
  // ---- 采购订单 PO 全生命周期 ----
  r.get('/purchases', devRequirePerm('stock.view'), (req, res) => {
    let list = store.purchaseOrders;
    if (req.query.status) list = list.filter((p) => (p.status || 'draft') === req.query.status);
    if (req.query.supplierId) list = list.filter((p) => String(p.supplierId) === String(req.query.supplierId));
    if (req.query.q) list = list.filter((p) => String(p.poNo || '').toLowerCase().includes(String(req.query.q).toLowerCase()));
    if (req.query.from) list = list.filter((p) => String(p.createdAt || '').slice(0, 10) >= req.query.from);
    if (req.query.to) list = list.filter((p) => String(p.createdAt || '').slice(0, 10) <= req.query.to);
    res.json([...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((p) => {
      const lines = devPoLines(p.id);
      return {
        ...toPurchaseOrder(p),
        lineCount: lines.length,
        totalQty: round3(lines.reduce((s, l) => s + Number(l.qty || 0), 0)),
        receivedQty: round3(lines.reduce((s, l) => s + Number(l.receivedQty || 0), 0)),
      };
    }));
  });
  r.post('/purchases', devRequirePerm('stock.purchase'), (req, res) => {
    const v = devParse(purchaseOrderSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: 'validation_failed', message: v.message });
    const b = v.data;
    const lines = b.lines || [];
    if (!lines.length) return res.status(400).json({ error: 'no_lines' });
    let supplierName = null;
    if (b.supplierId) {
      const sup = store.suppliers.find((x) => x.id === String(b.supplierId));
      if (!sup) return res.status(400).json({ error: 'supplier_not_found' });
      supplierName = sup.name;
    }
    const totals = devComputeTotals(lines, b.taxRate);
    const po = {
      id: nid(), orgId: '1', storeId: '1',
      poNo: makeDocNo('PO', store.purchaseOrders.map((p) => p.poNo)),
      supplierId: b.supplierId ? String(b.supplierId) : null, supplierName,
      subtotal: totals.subtotal, taxAmount: totals.taxAmount, total: totals.total,
      status: 'draft', expectedDate: b.expectedDate || null, note: b.note || null,
      receivedAt: null, approvedAt: null, approvedBy: null, approvedByName: null,
      cancelledAt: null, cancelReason: null,
      createdBy: req.user.id, createdByName: req.user.name,
      createdAt: now(), updatedAt: now(),
    };
    store.purchaseOrders.unshift(po);
    let rows;
    try { rows = devWritePoLines(po.id, lines, b.taxRate); }
    catch (e) {
      store.purchaseOrders = store.purchaseOrders.filter((x) => x.id !== po.id);
      store.purchaseOrderLines = store.purchaseOrderLines.filter((l) => String(l.poId) !== po.id);
      if (e.message === 'item_not_found') return res.status(400).json({ error: 'item_not_found', itemId: e.itemId });
      throw e;
    }
    res.status(201).json(toPurchaseOrder(po, rows));
  });
  r.get('/purchases/:id', devRequirePerm('stock.view'), (req, res) => {
    const po = store.purchaseOrders.find((x) => x.id === req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    const lines = devPoLines(po.id);
    res.json({
      ...toPurchaseOrder(po, lines),
      receipts: store.goodsReceipts.filter((g) => String(g.poId) === po.id).map((g) => toGoodsReceipt(g)),
      outstandingQty: round3(lines.reduce((s, l) => s + Math.max(0, Number(l.qty || 0) - Number(l.receivedQty || 0)), 0)),
    });
  });
  r.put('/purchases/:id', devRequirePerm('stock.purchase'), (req, res) => {
    const po = store.purchaseOrders.find((x) => x.id === req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    if ((po.status || 'draft') !== 'draft') return res.status(409).json({ error: 'not_editable', status: po.status });
    const b = req.body || {};
    if (b.supplierId !== undefined) {
      if (b.supplierId) {
        const sup = store.suppliers.find((x) => x.id === String(b.supplierId));
        if (!sup) return res.status(400).json({ error: 'supplier_not_found' });
        po.supplierId = String(b.supplierId); po.supplierName = sup.name;
      } else { po.supplierId = null; po.supplierName = null; }
    }
    if (b.expectedDate !== undefined) po.expectedDate = b.expectedDate || null;
    if (b.note !== undefined) po.note = b.note;
    if (Array.isArray(b.lines)) {
      const v = devParse(purchaseOrderSchema, { ...b, lines: b.lines });
      if (!v.ok) return res.status(400).json({ error: 'validation_failed', message: v.message });
      if (!v.data.lines.length) return res.status(400).json({ error: 'no_lines' });
      const totals = devComputeTotals(v.data.lines, v.data.taxRate);
      po.subtotal = totals.subtotal; po.taxAmount = totals.taxAmount; po.total = totals.total;
      try { devWritePoLines(po.id, v.data.lines, v.data.taxRate); }
      catch (e) {
        if (e.message === 'item_not_found') return res.status(400).json({ error: 'item_not_found', itemId: e.itemId });
        throw e;
      }
    }
    po.updatedAt = now();
    res.json(toPurchaseOrder(po, devPoLines(po.id)));
  });
  r.post('/purchases/:id/approve', devRequirePerm('stock.purchase'), (req, res) => {
    const po = store.purchaseOrders.find((x) => x.id === req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    if ((po.status || 'draft') !== 'draft') return res.status(409).json({ error: 'not_approvable', status: po.status });
    const lines = devPoLines(po.id);
    if (!lines.length) return res.status(400).json({ error: 'no_lines' });
    po.status = 'approved'; po.approvedAt = now();
    po.approvedBy = req.user.id; po.approvedByName = req.user.name; po.updatedAt = now();
    res.json(toPurchaseOrder(po, lines));
  });
  r.post('/purchases/:id/cancel', devRequirePerm('stock.purchase'), (req, res) => {
    const po = store.purchaseOrders.find((x) => x.id === req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    if (po.status === 'cancelled') return res.status(409).json({ error: 'already_cancelled' });
    if (po.status === 'received' || po.status === 'partial') {
      return res.status(409).json({ error: 'has_receipts', status: po.status });
    }
    po.status = 'cancelled'; po.cancelledAt = now(); po.cancelReason = req.body?.reason || null;
    po.updatedAt = now();
    res.json(toPurchaseOrder(po, devPoLines(po.id)));
  });
  r.delete('/purchases/:id', devRequirePerm('stock.purchase'), (req, res) => {
    const po = store.purchaseOrders.find((x) => x.id === req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    if ((po.status || 'draft') !== 'draft') return res.status(409).json({ error: 'only_draft_deletable', status: po.status });
    store.purchaseOrderLines = store.purchaseOrderLines.filter((l) => String(l.poId) !== po.id);
    store.purchaseOrders = store.purchaseOrders.filter((x) => x.id !== po.id);
    res.json({ ok: true });
  });

  // ---- 库位调拨(按库位拆行:源行出、目标行入) ----
  r.post('/stock-transfers', devRequirePerm('stock.take'), async (req, res) => {
    const v = devParse(stockTransferSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: 'validation_failed', message: v.message });
    const p = v.data;
    if (p.fromLocation === p.toLocation) return res.status(400).json({ error: 'same_location' });

    // ---- pass 1:校验源行与可用量 ----
    const plan = [];
    const errors = [];
    const used = new Map();
    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      const srcRow = store.inventory.find((x) => x.id === String(l.itemId));
      if (!srcRow) { errors.push({ index: i, error: 'item_not_found', itemId: l.itemId }); continue; }
      const source = toInventoryItem(srcRow);
      if ((source.location || '') !== p.fromLocation) {
        errors.push({
          index: i, error: 'location_mismatch', itemId: source.id, itemName: source.name,
          expected: p.fromLocation, actual: source.location,
        });
        continue;
      }
      const qty = round3(l.qty);
      if (!(qty > 0)) { errors.push({ index: i, error: 'invalid_qty', itemId: source.id }); continue; }
      const already = used.get(String(source.id)) || 0;
      if (already + qty > source.quantity + 1e-9) {
        errors.push({
          index: i, error: 'insufficient', itemId: source.id, itemName: source.name,
          requested: qty, available: round3(source.quantity - already),
        });
        continue;
      }
      used.set(String(source.id), round3(already + qty));
      plan.push({ source, qty, note: l.note ?? null, dest: null });
    }
    if (errors.length) return res.status(400).json({ error: 'transfer_failed', errors });

    // ---- 目标行:先确保存在 ----
    const createdIds = [];
    for (const x of plan) {
      let dest = store.inventory.find((d) => (d.location || '') === p.toLocation
        && (x.source.code ? d.code === x.source.code : (d.name === x.source.name && (d.unit || null) === (x.source.unit || null))));
      if (!dest) {
        dest = {
          id: nid(), orgId: '1', storeId: '1',
          code: x.source.code, name: x.source.name, category: x.source.category, barcode: x.source.barcode,
          unit: x.source.unit, quantity: 0, threshold: Number(x.source.threshold || 0),
          costPrice: x.source.costPrice, avgCost: Number(x.source.avgCost || 0),
          lastCost: Number(x.source.lastCost || 0), location: p.toLocation,
          supplierId: x.source.supplierId || null,
          note: `库位调拨自动创建(来自 ${x.source.location || '-'})`, isActive: true,
          createdAt: now(), updatedAt: now(),
        };
        store.inventory.push(dest);
        createdIds.push(dest.id);
      }
      x.dest = { ...toInventoryItem(dest) };
    }

    const trNo = makeDocNo('TR', store.stockTransfers.map((t) => t.transferNo));
    const totalCost = round2(plan.reduce((s, x) => s + x.qty * Number(x.source.avgCost || 0), 0));
    const tr = {
      id: nid(), orgId: '1', storeId: '1', transferNo: trNo,
      fromLocation: p.fromLocation, toLocation: p.toLocation,
      status: 'posted', totalCost, note: p.note ?? null,
      voidedAt: null, voidReason: null,
      createdBy: req.user.id, createdByName: req.user.name, createdAt: now(),
    };
    store.stockTransfers.unshift(tr);

    // 每行两条台账,同一单价 → 总金额守恒
    const mvLines = [];
    for (const x of plan) {
      mvLines.push({ itemId: x.source.id, type: 'transfer_out', qty: x.qty, refType: 'stock_transfer', refId: tr.id, refNo: trNo, note: x.note });
      mvLines.push({ itemId: x.dest.id, type: 'transfer_in', qty: x.qty, unitCost: Number(x.source.avgCost || 0), refType: 'stock_transfer', refId: tr.id, refNo: trNo, note: x.note });
    }
    const mv = await applyMovements(devInventoryAdapter, mvLines,
      { orgId: '1', storeId: '1', createdBy: req.user.id, createdByName: req.user.name });

    if (!mv.ok) {
      store.stockTransfers = store.stockTransfers.filter((t) => t.id !== tr.id);
      store.inventory = store.inventory.filter((i) => !createdIds.includes(i.id));
      return res.status(400).json({ error: 'transfer_failed', errors: mv.errors });
    }

    for (let i = 0; i < plan.length; i++) {
      const x = plan[i];
      const out = mv.movements[i * 2];
      const inn = mv.movements[i * 2 + 1];
      store.stockTransferLines.push({
        id: nid(), transferId: tr.id,
        itemId: x.source.id, toItemId: x.dest.id,
        itemCode: x.source.code, itemName: x.source.name, unit: x.source.unit,
        qty: x.qty, unitCost: Number(x.source.avgCost || 0), amount: round2(x.qty * Number(x.source.avgCost || 0)),
        beforeQty: out.before, afterQty: out.after, avgCostAfter: inn.avgCostAfter,
        note: x.note, createdAt: now(),
      });
    }

    devNotifyLow(req.app.get('io'), plan.map((x) => x.source.id));
    res.status(201).json({
      ...toStockTransfer(tr, store.stockTransferLines.filter((l) => l.transferId === tr.id)),
      createdItems: createdIds.length
        ? store.inventory.filter((i) => createdIds.includes(i.id)).map(toInventoryItem)
        : [],
      movements: mv.movements,
    });
  });
  r.get('/stock-transfers', devRequirePerm('stock.view'), (req, res) => {
    let list = store.stockTransfers;
    if (req.query.status) list = list.filter((t) => (t.status || 'posted') === req.query.status);
    if (req.query.fromLocation) list = list.filter((t) => t.fromLocation === req.query.fromLocation);
    if (req.query.toLocation) list = list.filter((t) => t.toLocation === req.query.toLocation);
    if (req.query.q) list = list.filter((t) => String(t.transferNo || '').toLowerCase().includes(String(req.query.q).toLowerCase()));
    if (req.query.from) list = list.filter((t) => String(t.createdAt || '').slice(0, 10) >= req.query.from);
    if (req.query.to) list = list.filter((t) => String(t.createdAt || '').slice(0, 10) <= req.query.to);
    res.json([...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((t) => toStockTransfer(t)));
  });
  r.get('/stock-transfers/:id', devRequirePerm('stock.view'), (req, res) => {
    const t = store.stockTransfers.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json(toStockTransfer(t, store.stockTransferLines.filter((l) => l.transferId === t.id)));
  });
  r.post('/stock-transfers/:id/void', devRequirePerm('stock.take'), async (req, res) => {
    const t = store.stockTransfers.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    if (t.status === 'void') return res.status(409).json({ error: 'already_void' });
    const lines = store.stockTransferLines.filter((l) => l.transferId === t.id);
    if (!lines.length) return res.status(400).json({ error: 'no_lines' });

    const mvLines = [];
    for (const l of lines) {
      const dest = store.inventory.find((d) => d.id === String(l.toItemId));
      if (!dest) return res.status(400).json({ error: 'dest_item_missing', itemId: l.toItemId });
      const reason = req.body?.reason || `作废调拨 ${t.transferNo}`;
      mvLines.push({ itemId: l.toItemId, type: 'transfer_out', qty: Number(l.qty), refType: 'stock_transfer_void', refId: t.id, refNo: t.transferNo, note: reason });
      mvLines.push({ itemId: l.itemId, type: 'transfer_in', qty: Number(l.qty), unitCost: Number(dest.avgCost || 0), refType: 'stock_transfer_void', refId: t.id, refNo: t.transferNo, note: reason });
    }
    const mv = await applyMovements(devInventoryAdapter, mvLines,
      { orgId: '1', storeId: '1', allowNegative: true, createdBy: req.user.id, createdByName: req.user.name });
    if (!mv.ok) return res.status(400).json({ error: 'void_failed', errors: mv.errors });

    t.status = 'void'; t.voidedAt = now(); t.voidReason = req.body?.reason || null;
    devNotifyLow(req.app.get('io'), lines.map((l) => l.itemId));
    res.json({ ...toStockTransfer(t, lines), movements: mv.movements });
  });
  r.post('/purchases/:id/receive', devRequirePerm('stock.purchase'), async (req, res) => {
    const v = devParse(goodsReceiptSchema, req.body || {});
    if (!v.ok) return res.status(400).json({ error: 'validation_failed', message: v.message });
    const p = v.data;
    const po = store.purchaseOrders.find((x) => x.id === req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    if (!['approved', 'partial'].includes(po.status)) {
      return res.status(409).json({ error: 'not_receivable', status: po.status });
    }
    const poLines = devPoLines(po.id);
    if (!poLines.length) return res.status(400).json({ error: 'no_lines' });

    // ---- pass 1:全部校验,不落库 ----
    const reqLines = (Array.isArray(p.lines) && p.lines.length)
      ? p.lines
      : poLines.filter((l) => devOutstanding(l) > 0)
        .map((l) => ({ poLineId: l.id, itemId: l.itemId, qty: devOutstanding(l) }));
    if (!reqLines.length) return res.status(400).json({ error: 'nothing_to_receive' });

    const plan = [];
    const errors = [];
    const used = new Map();
    for (let i = 0; i < reqLines.length; i++) {
      const rl = reqLines[i];
      const line = rl.poLineId
        ? poLines.find((l) => String(l.id) === String(rl.poLineId))
        : poLines.find((l) => String(l.itemId) === String(rl.itemId) && devOutstanding(l) > 0);
      if (!line) { errors.push({ index: i, error: 'po_line_not_found', itemId: rl.itemId ?? null }); continue; }
      const qty = round3(rl.qty);
      if (!(qty > 0)) { errors.push({ index: i, error: 'invalid_qty', poLineId: line.id }); continue; }
      const already = used.get(String(line.id)) || 0;
      if (already + qty > devOutstanding(line) + 1e-9) {
        errors.push({
          index: i, error: 'over_receipt', poLineId: line.id, itemName: line.itemName,
          requested: qty, outstanding: round3(devOutstanding(line) - already),
        });
        continue;
      }
      used.set(String(line.id), round3(already + qty));
      plan.push({
        line, qty,
        unitCost: rl.unitCost != null ? round4(rl.unitCost) : Number(line.unitCost || 0),
        note: rl.note ?? null,
      });
    }
    if (errors.length) return res.status(400).json({ error: 'receive_failed', errors });

    const total = round2(plan.reduce((s, x) => s + x.qty * x.unitCost, 0));
    const grnNo = makeDocNo('GRN', store.goodsReceipts.map((g) => g.grnNo));
    const grn = {
      id: nid(), orgId: '1', storeId: '1', grnNo,
      poId: po.id, poNo: po.poNo,
      supplierId: po.supplierId || null, supplierName: po.supplierName || null,
      total, status: 'posted', note: p.note ?? null,
      receivedAt: now(), voidedAt: null, voidReason: null,
      createdBy: req.user.id, createdByName: req.user.name, createdAt: now(),
    };
    store.goodsReceipts.unshift(grn);

    const mv = await applyMovements(devInventoryAdapter, plan.map((x) => ({
      itemId: x.line.itemId, type: 'purchase_receipt', qty: x.qty, unitCost: x.unitCost,
      refType: 'goods_receipt', refId: grn.id, refNo: grnNo,
      note: x.note || `收货 ${po.poNo}`,
    })), { orgId: '1', storeId: '1', createdBy: req.user.id, createdByName: req.user.name });

    if (!mv.ok) {
      store.goodsReceipts = store.goodsReceipts.filter((g) => g.id !== grn.id);
      return res.status(400).json({ error: 'receive_failed', errors: mv.errors });
    }

    for (let i = 0; i < plan.length; i++) {
      const x = plan[i];
      const m = mv.movements[i];
      store.goodsReceiptLines.push({
        id: nid(), grnId: grn.id, poLineId: x.line.id,
        itemId: x.line.itemId, itemCode: x.line.itemCode, itemName: x.line.itemName, unit: x.line.unit,
        qty: x.qty, unitCost: x.unitCost, amount: round2(x.qty * x.unitCost),
        beforeQty: m.before, afterQty: m.after, avgCostAfter: m.avgCostAfter,
        note: x.note, createdAt: now(),
      });
      x.line.receivedQty = round3(Number(x.line.receivedQty || 0) + x.qty);
    }

    const newStatus = devRefreshPoStatus(po);
    if (newStatus === 'received') po.receivedAt = now();
    devNotifyLow(req.app.get('io'), plan.map((x) => x.line.itemId));
    res.status(201).json({
      ...toGoodsReceipt(grn, store.goodsReceiptLines.filter((l) => l.grnId === grn.id)),
      poStatus: newStatus,
      movements: mv.movements,
    });
  });
  r.get('/goods-receipts', devRequirePerm('stock.view'), (req, res) => {
    let list = store.goodsReceipts;
    if (req.query.status) list = list.filter((g) => (g.status || 'posted') === req.query.status);
    if (req.query.poId) list = list.filter((g) => String(g.poId) === String(req.query.poId));
    if (req.query.supplierId) list = list.filter((g) => String(g.supplierId) === String(req.query.supplierId));
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((g) => String(g.grnNo || '').toLowerCase().includes(q) || String(g.poNo || '').toLowerCase().includes(q));
    }
    if (req.query.from) list = list.filter((g) => String(g.createdAt || '').slice(0, 10) >= req.query.from);
    if (req.query.to) list = list.filter((g) => String(g.createdAt || '').slice(0, 10) <= req.query.to);
    res.json([...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((g) => toGoodsReceipt(g)));
  });
  r.get('/goods-receipts/:id', devRequirePerm('stock.view'), (req, res) => {
    const g = store.goodsReceipts.find((x) => x.id === req.params.id);
    if (!g) return res.status(404).json({ error: 'not found' });
    res.json(toGoodsReceipt(g, store.goodsReceiptLines.filter((l) => l.grnId === g.id)));
  });
  r.post('/goods-receipts/:id/void', devRequirePerm('stock.purchase'), async (req, res) => {
    const g = store.goodsReceipts.find((x) => x.id === req.params.id);
    if (!g) return res.status(404).json({ error: 'not found' });
    if (g.status === 'void') return res.status(409).json({ error: 'already_void' });
    const lines = store.goodsReceiptLines.filter((l) => l.grnId === g.id);
    if (!lines.length) return res.status(400).json({ error: 'no_lines' });

    const mv = await applyMovements(devInventoryAdapter, lines.map((l) => ({
      itemId: l.itemId, type: 'receipt_void', qty: Number(l.qty),
      refType: 'goods_receipt_void', refId: g.id, refNo: g.grnNo,
      note: req.body?.reason || `作废收货 ${g.grnNo}`,
    })), {
      orgId: '1', storeId: '1', allowNegative: true,
      createdBy: req.user.id, createdByName: req.user.name,
    });
    if (!mv.ok) return res.status(400).json({ error: 'void_failed', errors: mv.errors });

    for (const l of lines) {
      const poLine = store.purchaseOrderLines.find((x) => String(x.id) === String(l.poLineId));
      if (poLine) poLine.receivedQty = round3(Math.max(0, Number(poLine.receivedQty || 0) - Number(l.qty)));
    }
    g.status = 'void'; g.voidedAt = now(); g.voidReason = req.body?.reason || null;

    let poStatus = null;
    const po = store.purchaseOrders.find((x) => String(x.id) === String(g.poId));
    if (po) {
      po.status = derivePoStatus(devPoLines(po.id), po.status === 'received' ? 'approved' : po.status);
      poStatus = po.status;
      if (poStatus !== 'received') po.receivedAt = null;
      po.updatedAt = now();
    }
    devNotifyLow(req.app.get('io'), lines.map((l) => l.itemId));
    res.json({ ...toGoodsReceipt(g, lines), poStatus, movements: mv.movements });
  });

  // ---- 报表目录:前端据此渲染分组下拉与列定义 ----
  r.get('/reports/catalog', devRequirePerm('report.view'), (req, res) => res.json({ categories: REPORT_CATEGORIES, reports: REPORT_CATALOG }));

  // ---- 通用报表查询(统一走 reportEngine,开发预览与生产口径一致) ----
  r.get('/reports/query', devRequirePerm('report.view'), (req, res) => {
    const type = req.query.type || 'sales_by_date';
    res.json(runReport(type, buildReportDataset(), { from: req.query.from, to: req.query.to }));
  });

  // ---- 报表导出:CSV / Excel(xlsx) / 打印页(浏览器另存为 PDF) ----
  r.get('/reports/export', devRequirePerm('report.export'), (req, res) => {
    const type = req.query.type || 'sales_by_date';
    const format = String(req.query.format || 'csv').toLowerCase();
    const from = req.query.from || null;
    const to = req.query.to || null;
    const ds = buildReportDataset();
    const result = runReport(type, ds, { from, to });
    const columns = reportColumns(type, result.rows);
    const title = reportTitle(type);
    const rangeLabel = from || to ? `${from || '...'} → ${to || '...'}` : 'All dates';
    const meta = [['Report', title], ['Period', rangeLabel], ['Store', ds.settings.companyName || '-'], ['Rows', result.rows.length]];
    const fileBase = `${type}_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'xlsx' || format === 'excel') {
      const buf = buildXlsx(title, columns, result.rows, { title, subtitle: rangeLabel });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
      return res.end(buf);
    }
    if (format === 'html' || format === 'pdf') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(buildPrintHtml({ title, subtitle: `${rangeLabel} · ${ds.settings.companyName || ''}`, columns, rows: result.rows, meta }));
    }
    const csv = buildCsv(columns, result.rows, { Report: title, Period: rangeLabel, Store: ds.settings.companyName || '' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
    res.end(csv);
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
