import { Router } from 'express';
import { Models } from '../models.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { categorySchema, itemSchema } from '../validators.js';

const router = Router();
router.use(authenticate);

router.get('/categories', async (req, res) => {
  const list = await Models.MenuCategory.find(tenant(req)).sort('sortOrder').lean();
  res.json(list);
});
router.post('/categories', rbac('admin', 'manager'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const doc = await Models.MenuCategory.create({ ...tenant(req), ...p });
  res.status(201).json(doc);
});
router.put('/categories/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = categorySchema.parse(req.body);
  const d = await Models.MenuCategory.findOneAndUpdate({ _id: req.params.id, ...tenant(req) }, p, { new: true });
  res.json(d);
});
router.delete('/categories/:id', rbac('admin', 'manager'), async (req, res) => {
  await Models.MenuCategory.findOneAndDelete({ _id: req.params.id, ...tenant(req) });
  res.json({ ok: true });
});

router.get('/items', async (req, res) => {
  const f = tenant(req);
  if (req.query.category) f.categoryId = req.query.category;
  const list = await Models.MenuItem.find(f).lean();
  res.json(list);
});
router.post('/items', rbac('admin', 'manager'), async (req, res) => {
  const p = itemSchema.parse(req.body);
  const d = await Models.MenuItem.create({ ...tenant(req), ...p });
  res.status(201).json(d);
});
router.put('/items/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = itemSchema.parse(req.body);
  const d = await Models.MenuItem.findOneAndUpdate({ _id: req.params.id, ...tenant(req) }, p, { new: true });
  res.json(d);
});
router.delete('/items/:id', rbac('admin', 'manager'), async (req, res) => {
  await Models.MenuItem.findOneAndDelete({ _id: req.params.id, ...tenant(req) });
  res.json({ ok: true });
});

export default router;
