import { Router } from 'express';
import { Models } from '../models.js';
import { authenticate, rbac, tenant, isSupervisor } from '../middleware/auth.js';
import { createOrderSchema, orderItemSchema, checkoutSchema, voidSchema } from '../validators.js';
import { emitToStore } from '../sockets.js';

const router = Router();
router.use(authenticate);

function computeTotals(items, taxRate = 0) {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  return { subtotal, tax, total: subtotal + tax };
}

function orderNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `T${ymd}-${rand}`;
}

router.post('/', async (req, res) => {
  const p = createOrderSchema.parse(req.body);
  const store = await Models.Store.findById(req.user.storeId);
  const items = p.items.map((i) => ({ ...i, status: 'pending' }));
  const { subtotal, tax, total } = computeTotals(items, store.taxRate);
  const order = await Models.Order.create({
    ...tenant(req),
    orderNo: orderNo(),
    type: p.type,
    tableId: p.tableId,
    customerName: p.customerName,
    phone: p.phone,
    items,
    subtotal,
    tax,
    total,
    discount: 0,
    createdBy: req.user._id,
  });
  if (p.type === 'dine_in' && p.tableId) {
    await Models.Table.updateOne(
      { _id: p.tableId, ...tenant(req) },
      { status: 'occupied', currentOrderId: order._id }
    );
  }
  res.status(201).json(order);
});

router.get('/', async (req, res) => {
  const f = tenant(req);
  if (req.query.status) f.status = req.query.status;
  if (req.query.type) f.type = req.query.type;
  const list = await Models.Order.find(f).sort('-createdAt').lean();
  res.json(list);
});

router.get('/:id', async (req, res) => {
  const o = await Models.Order.findOne({ _id: req.params.id, ...tenant(req) }).lean();
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

router.post('/:id/items', async (req, res) => {
  const p = orderItemSchema.parse(req.body);
  const order = await Models.Order.findOne({ _id: req.params.id, ...tenant(req) });
  if (!order) return res.status(404).json({ error: 'not found' });
  if (order.status !== 'open') return res.status(400).json({ error: 'order not open' });
  order.items.push({ ...p, status: 'pending' });
  const store = await Models.Store.findById(req.user.storeId);
  Object.assign(order, computeTotals(order.items, store.taxRate));
  await order.save();
  res.json(order);
});

router.put('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const order = await Models.Order.findOne({ _id: req.params.id, ...tenant(req) });
  if (!order) return res.status(404).json({ error: 'not found' });
  if (status === 'kitchen' && order.status === 'open') {
    order.status = 'kitchen';
    await order.save();
    const io = req.app.get('io');
    emitToStore(io, req.user.storeId, 'order:created', order);
    emitToStore(io, req.user.storeId, 'kds:ticket', order);
    return res.json(order);
  }
  return res.status(400).json({ error: 'invalid transition' });
});

async function deductInventory(order, user, io) {
  const low = [];
  for (const it of order.items) {
    const mi = await Models.MenuItem.findById(it.itemId);
    if (!mi || !mi.trackInventory || !mi.inventoryItemId) continue;
    const inv = await Models.InventoryItem.findById(mi.inventoryItemId);
    if (!inv) continue;
    const before = inv.quantity;
    const after = Math.max(0, before - it.qty);
    inv.quantity = after;
    await inv.save();
    await Models.StockMovement.create({
      ...tenant({ user }),
      itemId: inv._id,
      type: 'sale',
      delta: -it.qty,
      before,
      after,
      refOrderId: order._id,
      createdBy: user._id,
    });
    if (after < inv.threshold) low.push({ itemId: String(inv._id), name: inv.name, quantity: after });
  }
  if (low.length) emitToStore(io, user.storeId, 'inventory:low', low);
}

async function buildReceipt(order) {
  const store = await Models.Store.findById(order.storeId);
  const payments = await Models.Payment.find({ orderId: order._id });
  return {
    storeName: store.name,
    orderNo: order.orderNo,
    items: order.items,
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
    payments,
    createdAt: order.createdAt,
  };
}

router.post('/:id/checkout', async (req, res) => {
  const p = checkoutSchema.parse(req.body);
  const order = await Models.Order.findOne({ _id: req.params.id, ...tenant(req) });
  if (!order) return res.status(404).json({ error: 'not found' });
  if (order.status === 'paid' || order.status === 'void') return res.status(400).json({ error: 'already closed' });
  const paidSum = p.payments.reduce((s, x) => s + x.amount, 0);
  if (paidSum + (p.tip || 0) < order.total) return res.status(400).json({ error: 'amount not covered' });
  for (const pm of p.payments) {
    await Models.Payment.create({
      ...tenant(req),
      orderId: order._id,
      method: pm.method,
      amount: pm.amount,
      tip: 0,
      createdBy: req.user._id,
    });
  }
  order.status = 'paid';
  await order.save();
  const io = req.app.get('io');
  await deductInventory(order, req.user, io);
  emitToStore(io, req.user.storeId, 'order:closed', String(order._id));
  if (order.tableId) {
    await Models.Table.updateOne(
      { _id: order.tableId, ...tenant(req) },
      { status: 'needs_clean', currentOrderId: null }
    );
  }
  const receipt = await buildReceipt(order);
  res.json({ order, receipt });
});

// 发起取消请求(任意收银角色),需主管审批
router.post('/:id/void', async (req, res) => {
  const p = voidSchema.parse(req.body);
  const order = await Models.Order.findOne({ _id: req.params.id, ...tenant(req) });
  if (!order) return res.status(404).json({ error: 'not found' });
  if (['paid', 'void', 'void_pending'].includes(order.status)) {
    return res.status(400).json({ error: 'cannot void this order' });
  }
  order.status = 'void_pending';
  order.voidRequestedBy = req.user._id;
  order.voidReason = p.reason;
  await order.save();
  res.json(order);
});

// 主管审批取消
router.post('/:id/void/approve', rbac('admin', 'manager'), async (req, res) => {
  const order = await Models.Order.findOne({ _id: req.params.id, ...tenant(req) });
  if (!order) return res.status(404).json({ error: 'not found' });
  if (order.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
  order.status = 'void';
  order.voidApprovedBy = req.user._id;
  await order.save();
  emitToStore(req.app.get('io'), req.user.storeId, 'order:closed', String(order._id));
  if (order.tableId) {
    await Models.Table.updateOne(
      { _id: order.tableId, ...tenant(req) },
      { status: 'free', currentOrderId: null }
    );
  }
  res.json(order);
});

export default router;
