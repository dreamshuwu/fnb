import { Router } from 'express';
import { query, getRow, toPayment } from '../db.js';
import { authenticate, tenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM payments WHERE org_id=? AND store_id=?';
  if (req.query.orderId) { sql += ' AND order_id=?'; params.push(Number(req.query.orderId)); }
  sql += ' ORDER BY created_at DESC';
  const list = await query(sql, params);
  res.json(list.map(toPayment));
});

export default router;
