import { Router } from 'express';
import { query, getRow, insert, toShift } from '../db.js';
import { authenticate, rbac, tenant, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.post('/open', requirePermission('shift.manage'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const existing = await getRow(
    'SELECT * FROM shifts WHERE org_id=? AND store_id=? AND cashier_id=? AND status=?',
    [orgId, storeId, req.user.id, 'open']
  );
  if (existing) return res.status(400).json({ error: 'shift already open' });
  const id = await insert(
    'INSERT INTO shifts (org_id, store_id, cashier_id, open_amount, status) VALUES (?,?,?,?,?)',
    [orgId, storeId, req.user.id, req.body.openAmount || 0, 'open']
  );
  res.status(201).json(toShift(await getRow('SELECT * FROM shifts WHERE id=?', [id])));
});

router.post('/close', requirePermission('shift.manage'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const s = await getRow(
    'SELECT * FROM shifts WHERE org_id=? AND store_id=? AND cashier_id=? AND status=?',
    [orgId, storeId, req.user.id, 'open']
  );
  if (!s) return res.status(400).json({ error: 'no open shift' });
  await query('UPDATE shifts SET close_amount=?, status=? WHERE id=?', [req.body.closeAmount || 0, 'closed', s.id]);
  res.json(toShift(await getRow('SELECT * FROM shifts WHERE id=?', [s.id])));
});

router.get('/current', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const s = await getRow(
    'SELECT * FROM shifts WHERE org_id=? AND store_id=? AND cashier_id=? AND status=?',
    [orgId, storeId, req.user.id, 'open']
  );
  res.json(s ? toShift(s) : null);
});

export default router;
