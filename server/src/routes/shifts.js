import { Router } from 'express';
import { Models } from '../models.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.post('/open', rbac('admin', 'manager', 'cashier'), async (req, res) => {
  const existing = await Models.Shift.findOne({ ...tenant(req), cashierId: req.user._id, status: 'open' });
  if (existing) return res.status(400).json({ error: 'shift already open' });
  const s = await Models.Shift.create({
    ...tenant(req),
    cashierId: req.user._id,
    openAmount: req.body.openAmount || 0,
    status: 'open',
  });
  res.status(201).json(s);
});

router.post('/close', rbac('admin', 'manager', 'cashier'), async (req, res) => {
  const s = await Models.Shift.findOne({ ...tenant(req), cashierId: req.user._id, status: 'open' });
  if (!s) return res.status(400).json({ error: 'no open shift' });
  s.closeAmount = req.body.closeAmount || 0;
  s.status = 'closed';
  await s.save();
  res.json(s);
});

router.get('/current', async (req, res) => {
  const s = await Models.Shift.findOne({ ...tenant(req), cashierId: req.user._id, status: 'open' }).lean();
  res.json(s);
});

export default router;
