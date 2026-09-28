import { Router } from 'express';
import { Models } from '../models.js';
import { authenticate, tenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.get('/sales', async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : startOfDay();
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const match = { ...tenant(req), createdAt: { $gte: from, $lte: to } };
  const orders = await Models.Order.find({ ...match, status: 'paid' }).lean();
  const total = orders.reduce((s, o) => s + o.total, 0);
  const pays = await Models.Payment.find({ ...tenant(req), createdAt: { $gte: from, $lte: to } }).lean();
  const byMethod = {};
  for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
  res.json({ from, to, total, count: orders.length, byMethod });
});

router.get('/daily-close', async (req, res) => {
  const day = startOfDay();
  const orders = await Models.Order.find({ ...tenant(req), status: 'paid', createdAt: { $gte: day } }).lean();
  const total = orders.reduce((s, o) => s + o.total, 0);
  const pays = await Models.Payment.find({ ...tenant(req), createdAt: { $gte: day } }).lean();
  const byMethod = {};
  for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
  const movements = await Models.StockMovement.find({ ...tenant(req), createdAt: { $gte: day }, type: 'sale' }).lean();
  res.json({ date: day, total, orderCount: orders.length, byMethod, saleMovements: movements.length });
});

export default router;
