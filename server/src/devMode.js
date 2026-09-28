// 开发预览模式(免 MySQL):当 DEV_NO_DB=1 时启用。
// 用内存假数据实现前端所需的全部接口 + Socket.IO KDS,不改变生产 MySQL 路径。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { signTokens, JWT_SECRET } from './middleware/auth.js';

const store = {
  users: [], categories: [], items: [], tables: [], orders: [], inventory: [], payments: [], seq: 1,
};
const nid = () => String(store.seq++);
const now = () => new Date().toISOString();

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
    store.users.push({
      id: nid(), orgId: '1', storeId: '1', name, phone, role,
      password: bcrypt.hashSync(pw, 10), isActive: true,
    });
  }
  const cat1 = { id: nid(), orgId: '1', storeId: '1', name: '饮品', sortOrder: 1, isActive: true };
  const cat2 = { id: nid(), orgId: '1', storeId: '1', name: '主食', sortOrder: 2, isActive: true };
  store.categories.push(cat1, cat2);
  const inv = { id: nid(), orgId: '1', storeId: '1', name: '咖啡豆', unit: 'kg', quantity: 5, threshold: 2, costPrice: 80 };
  store.inventory.push(inv);
  store.items.push({
    id: nid(), orgId: '1', storeId: '1', categoryId: cat1.id, name: '美式咖啡', price: 18, imageUrl: '',
    modifierGroups: [{ name: '杯型', type: 'single', required: true, options: [{ label: '大杯', priceDelta: 3 }, { label: '小杯', priceDelta: 0 }] }],
    trackInventory: true, inventoryItemId: inv.id, isSoldOut: false, isActive: true,
  });
  store.items.push({
    id: nid(), orgId: '1', storeId: '1', categoryId: cat2.id, name: '牛肉饭', price: 38, imageUrl: '',
    modifierGroups: [], trackInventory: false, inventoryItemId: null, isSoldOut: false, isActive: true,
  });
  for (const n of ['A1', 'A2', 'B1']) {
    store.tables.push({ id: nid(), orgId: '1', storeId: '1', number: n, zone: '大厅', seats: 4, status: 'free', currentOrderId: null });
  }
}

// ---- mappers(与 db.js 输出保持一致,前端按这些字段渲染) ----
const toUser = (u) => ({ id: u.id, _id: u.id, name: u.name, phone: u.phone, role: u.role, orgId: u.orgId, storeId: u.storeId });
const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, orgId: u.orgId, storeId: u.storeId, phone: u.phone });
const toMenuCategory = (c) => ({ _id: c.id, id: c.id, orgId: c.orgId, storeId: c.storeId, name: c.name, sortOrder: c.sortOrder, isActive: !!c.isActive, createdAt: now(), updatedAt: now() });
const toMenuItem = (it) => ({
  _id: it.id, id: it.id, orgId: it.orgId, storeId: it.storeId,
  categoryId: it.categoryId == null ? null : String(it.categoryId), name: it.name,
  price: Number(it.price || 0), imageUrl: it.imageUrl || '', modifierGroups: it.modifierGroups || [],
  trackInventory: !!it.trackInventory, inventoryItemId: it.inventoryItemId == null ? null : String(it.inventoryItemId),
  isSoldOut: !!it.isSoldOut, isActive: !!it.isActive, createdAt: now(), updatedAt: now(),
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

  // auth:免认证(登录/刷新)
  r.post('/auth/login', async (req, res) => {
    const { phone, password } = req.body || {};
    const u = store.users.find((x) => x.phone === phone);
    if (!u || !bcrypt.compareSync(password || '', u.password)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const { access: accessToken, refresh: refreshToken } = signTokens(toUser(u));
    res.json({ accessToken, refreshToken, user: publicUser(u) });
  });
  r.post('/auth/refresh', (req, res) => {
    const { access: accessToken, refresh: refreshToken } = signTokens(toUser(req.user));
    res.json({ accessToken, refreshToken });
  });

  // 以下接口需要登录
  r.use(devAuthenticate);

  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

  // menu
  r.get('/menu/categories', (req, res) => res.json(store.categories.map(toMenuCategory)));
  r.get('/menu/items', (req, res) => res.json(store.items.filter((i) => i.isActive).map(toMenuItem)));
  r.post('/menu/categories', (req, res) => {
    const c = { id: nid(), orgId: '1', storeId: '1', name: req.body.name, sortOrder: req.body.sortOrder || store.categories.length + 1, isActive: true };
    store.categories.push(c); res.status(201).json(toMenuCategory(c));
  });
  r.post('/menu/items', (req, res) => {
    const b = req.body;
    const it = {
      id: nid(), orgId: '1', storeId: '1', categoryId: b.categoryId || null, name: b.name, price: b.price,
      imageUrl: b.imageUrl || '', modifierGroups: b.modifierGroups || [], trackInventory: !!b.trackInventory,
      inventoryItemId: b.inventoryItemId || null, isSoldOut: false, isActive: true,
    };
    store.items.push(it); res.status(201).json(toMenuItem(it));
  });
  r.delete('/menu/items/:id', (req, res) => {
    store.items = store.items.filter((i) => i.id !== req.params.id);
    res.json({ ok: true });
  });

  // tables
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

  // orders
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
    // 扣库存
    for (const it of o.items) {
      const mi = store.items.find((m) => m.id === String(it.itemId));
      if (!mi || !mi.trackInventory || !mi.inventoryItemId) continue;
      const inv = store.inventory.find((x) => x.id === mi.inventoryItemId);
      if (!inv) continue;
      inv.quantity = Math.max(0, Number(inv.quantity) - Number(it.qty));
    }
    if (o.tableId) { const t = store.tables.find((x) => x.id === o.tableId); if (t) { t.status = 'needs_clean'; t.currentOrderId = null; } }
    io.to(`store:${o.storeId}`).emit('order:closed', String(o.id));
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

  // inventory
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

  // reports
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
