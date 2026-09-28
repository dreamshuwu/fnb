import { Router } from 'express';
import { query, getRow, insert, toOrder, toStore, toPayment, stringifyJSON, parseJSON } from '../db.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
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

async function getOrder(id, orgId, storeId) {
  const r = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  return r ? toOrder(r) : null;
}

router.post('/', async (req, res) => {
  const p = createOrderSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const store = await getRow('SELECT * FROM stores WHERE id=?', [storeId]);
  const taxRate = Number(store?.tax_rate || 0);
  const items = p.items.map((i) => ({ ...i, status: 'pending' }));
  const { subtotal, tax, total } = computeTotals(items, taxRate);
  const id = await insert(
    `INSERT INTO orders
      (org_id, store_id, order_no, type, table_id, customer_name, phone, items, subtotal, tax, total, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orgId, storeId, orderNo(), p.type, p.tableId ? Number(p.tableId) : null,
      p.customerName ?? null, p.phone ?? null, stringifyJSON(items),
      subtotal, tax, total, req.user.id,
    ]
  );
  if (p.type === 'dine_in' && p.tableId) {
    await query(
      'UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?',
      ['occupied', id, Number(p.tableId), orgId, storeId]
    );
  }
  res.status(201).json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [id])));
});

router.get('/', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM orders WHERE org_id=? AND store_id=?';
  if (req.query.status) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.type) { sql += ' AND type=?'; params.push(req.query.type); }
  sql += ' ORDER BY created_at DESC';
  const list = await query(sql, params);
  res.json(list.map(toOrder));
});

router.get('/:id', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const o = await getOrder(req.params.id, orgId, storeId);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

router.post('/:id/items', async (req, res) => {
  const p = orderItemSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'open') return res.status(400).json({ error: 'order not open' });
  const items = parseJSON(row.items);
  items.push({ ...p, status: 'pending' });
  const store = await getRow('SELECT * FROM stores WHERE id=?', [storeId]);
  const totals = computeTotals(items, Number(store?.tax_rate || 0));
  await query(
    'UPDATE orders SET items=?, subtotal=?, tax=?, total=? WHERE id=?',
    [stringifyJSON(items), totals.subtotal, totals.tax, totals.total, row.id]
  );
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

router.put('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (status === 'kitchen' && row.status === 'open') {
    await query('UPDATE orders SET status=? WHERE id=?', ['kitchen', row.id]);
    const io = req.app.get('io');
    const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
    emitToStore(io, storeId, 'order:created', order);
    emitToStore(io, storeId, 'kds:ticket', order);
    return res.json(order);
  }
  return res.status(400).json({ error: 'invalid transition' });
});

async function deductInventory(order, user, io) {
  const low = [];
  for (const it of order.items) {
    const mi = await getRow('SELECT * FROM menu_items WHERE id=?', [Number(it.itemId)]);
    if (!mi || !mi.track_inventory || !mi.inventory_item_id) continue;
    const inv = await getRow('SELECT * FROM inventory_items WHERE id=?', [mi.inventory_item_id]);
    if (!inv) continue;
    const before = Number(inv.quantity || 0);
    const after = Math.max(0, before - it.qty);
    await query('UPDATE inventory_items SET quantity=? WHERE id=?', [after, inv.id]);
    await insert(
      `INSERT INTO stock_movements (org_id, store_id, item_id, type, delta, before, after, ref_order_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [user.orgId, user.storeId, inv.id, 'sale', -it.qty, before, after, order.id, user.id]
    );
    if (after < Number(inv.threshold || 0)) low.push({ itemId: String(inv.id), name: inv.name, quantity: after });
  }
  if (low.length) emitToStore(io, user.storeId, 'inventory:low', low);
}

router.post('/:id/checkout', async (req, res) => {
  const p = checkoutSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status === 'paid' || row.status === 'void') return res.status(400).json({ error: 'already closed' });
  const paidSum = p.payments.reduce((s, x) => s + x.amount, 0);
  if (paidSum + (p.tip || 0) < Number(row.total || 0)) return res.status(400).json({ error: 'amount not covered' });
  for (const pm of p.payments) {
    await insert(
      `INSERT INTO payments (org_id, store_id, order_id, method, amount, tip, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [orgId, storeId, row.id, pm.method, pm.amount, 0, req.user.id]
    );
  }
  await query('UPDATE orders SET status=? WHERE id=?', ['paid', row.id]);
  const io = req.app.get('io');
  const order = toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id]));
  await deductInventory(order, req.user, io);
  emitToStore(io, storeId, 'order:closed', String(order.id));
  if (order.tableId) {
    await query(
      'UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?',
      ['needs_clean', null, Number(order.tableId), orgId, storeId]
    );
  }
  const store = await getRow('SELECT * FROM stores WHERE id=?', [storeId]);
  const payments = await query('SELECT * FROM payments WHERE order_id=?', [row.id]);
  res.json({
    order,
    receipt: {
      storeName: store?.name || 'Store',
      orderNo: order.orderNo,
      items: order.items,
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      payments: payments.map(toPayment),
      createdAt: order.createdAt,
    },
  });
});

router.post('/:id/void', async (req, res) => {
  const p = voidSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (['paid', 'void', 'void_pending'].includes(row.status)) return res.status(400).json({ error: 'cannot void this order' });
  await query(
    'UPDATE orders SET status=?, void_requested_by=?, void_reason=? WHERE id=?',
    ['void_pending', req.user.id, p.reason, row.id]
  );
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

router.post('/:id/void/approve', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const row = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'void_pending') return res.status(400).json({ error: 'not pending' });
  await query('UPDATE orders SET status=?, void_approved_by=? WHERE id=?', ['void', req.user.id, row.id]);
  emitToStore(req.app.get('io'), storeId, 'order:closed', String(row.id));
  if (row.table_id) {
    await query(
      'UPDATE tables SET status=?, current_order_id=? WHERE id=? AND org_id=? AND store_id=?',
      ['free', null, row.table_id, orgId, storeId]
    );
  }
  res.json(toOrder(await getRow('SELECT * FROM orders WHERE id=?', [row.id])));
});

export default router;
