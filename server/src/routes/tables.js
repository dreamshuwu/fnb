import { Router } from 'express';
import { Models } from '../models.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { tableSchema } from '../validators.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const list = await Models.Table.find(tenant(req)).sort('number').lean();
  res.json(list);
});
router.post('/', rbac('admin', 'manager'), async (req, res) => {
  const p = tableSchema.parse(req.body);
  const d = await Models.Table.create({ ...tenant(req), ...p });
  res.status(201).json(d);
});
router.put('/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = tableSchema.parse(req.body);
  const d = await Models.Table.findOneAndUpdate({ _id: req.params.id, ...tenant(req) }, p, { new: true });
  res.json(d);
});
router.post('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const d = await Models.Table.findOneAndUpdate(
    { _id: req.params.id, ...tenant(req) },
    { status },
    { new: true }
  );
  res.json(d);
});

export default router;
