import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, tenant, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.get('/sales', requirePermission('report.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const from = req.query.from ? new Date(req.query.from) : startOfDay();
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const orders = await query(
    'SELECT * FROM orders WHERE org_id=? AND store_id=? AND status=? AND created_at >= ? AND created_at <= ?',
    [orgId, storeId, 'paid', from, to]
  );
  const total = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const pays = await query(
    'SELECT * FROM payments WHERE org_id=? AND store_id=? AND created_at >= ? AND created_at <= ?',
    [orgId, storeId, from, to]
  );
  const byMethod = {};
  for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount || 0);
  res.json({ from, to, total, count: orders.length, byMethod });
});

router.get('/daily-close', requirePermission('report.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const day = startOfDay();
  const orders = await query(
    'SELECT * FROM orders WHERE org_id=? AND store_id=? AND status=? AND created_at >= ?',
    [orgId, storeId, 'paid', day]
  );
  const total = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const pays = await query(
    'SELECT * FROM payments WHERE org_id=? AND store_id=? AND created_at >= ?',
    [orgId, storeId, day]
  );
  const byMethod = {};
  for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount || 0);
  const movements = await query(
    'SELECT * FROM stock_movements WHERE org_id=? AND store_id=? AND created_at >= ? AND type=?',
    [orgId, storeId, day, 'sale']
  );
  res.json({ date: day, total, orderCount: orders.length, byMethod, saleMovements: movements.length });
});

export default router;
