// 开发预览模式(免 MySQL):当 DEV_NO_DB=1 时启用。
// 用内存假数据实现前端所需的全部接口 + Socket.IO KDS,不改变生产 MySQL 路径。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { signTokens, JWT_SECRET } from './middleware/auth.js';

const store = {
  users: [], categories: [], bases: [], modifiers: [], baseModifiers: [], variants: [],
  tables: [], orders: [], inventory: [], payments: [], seq: 1,
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
  items: o.items || [], subtotal: Number(o.subtotal || 0), discount: 0, tax: Number(o.tax || 0), total: Number(o.total || 0),
  createdBy: o.createdBy == null ? null : String(o.createdBy), shiftId: null,
  voidRequestedBy: o.voidRequestedBy == null ? null : String(o.voidRequestedBy), voidApprovedBy: null, voidReason: o.voidReason || null,
  createdAt: o.createdAt, updatedAt: o.updatedAt || o.createdAt,
});

function computeTotals(items, taxRate = 0) {
  const subtotal = items.reduce((s, i) => s + Number(i.unitPrice) * Number(i.qty), 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  return { subtotal, tax, total: subtotal + tax };
}
function orderNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `T${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
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
    const { subtotal, tax, total } = computeTotals(items, 0);
    const o = {
      id: nid(), orgId: '1', storeId: '1', orderNo: orderNo(), type: b.type || 'dine_in',
      tableId: b.tableId ? String(b.tableId) : null, customerName: b.customerName || null, phone: b.phone || null,
      status: 'open', items, subtotal, tax, total, createdBy: req.user.id, voidReason: null,
      createdAt: now(), updatedAt: now(),
    };
    store.orders.push(o);
    if (o.type === 'dine_in' && o.tableId) {
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
    const t = computeTotals(o.items, 0); o.subtotal = t.subtotal; o.tax = t.tax; o.total = t.total; o.updatedAt = now();
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
    res.json(toOrder(o));
  });
  r.post('/orders/:id/checkout', (req, res) => {
    const o = store.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status === 'paid' || o.status === 'void') return res.status(400).json({ error: 'already closed' });
    const paidSum = (req.body.payments || []).reduce((s, x) => s + Number(x.amount), 0);
    if (paidSum + Number(req.body.tip || 0) < Number(o.total || 0)) return res.status(400).json({ error: 'amount not covered' });
    for (const pm of req.body.payments || []) {
      store.payments.push({ id: nid(), orgId: '1', storeId: '1', orderId: o.id, method: pm.method, amount: pm.amount, tip: 0, createdAt: now() });
    }
    o.status = 'paid'; o.updatedAt = now();
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
      receipt: { storeName: 'Demo Store', orderNo: o.orderNo, items: o.items, subtotal: o.subtotal, tax: o.tax, total: o.total, payments, createdAt: o.createdAt },
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
