import { Router } from 'express';
import { Models } from '../models.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { inventoryItemSchema, adjustSchema } from '../validators.js';
import { emitToStore } from '../sockets.js';

const router = Router();
router.use(authenticate);

router.get('/items', async (req, res) => {
  const list = await Models.InventoryItem.find(tenant(req)).lean();
  res.json(list);
});
router.post('/items', rbac('admin', 'manager'), async (req, res) => {
  const p = inventoryItemSchema.parse(req.body);
  const d = await Models.InventoryItem.create({ ...tenant(req), ...p });
  res.status(201).json(d);
});
router.put('/items/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = inventoryItemSchema.parse(req.body);
  const d = await Models.InventoryItem.findOneAndUpdate({ _id: req.params.id, ...tenant(req) }, p, { new: true });
  res.json(d);
});

// 补货 / 调整 / 盘点
router.post('/adjust', rbac('admin', 'manager'), async (req, res) => {
  const p = adjustSchema.parse(req.body);
  const item = await Models.InventoryItem.findOne({ _id: req.body.itemId, ...tenant(req) });
  if (!item) return res.status(404).json({ error: 'not found' });
  const before = item.quantity;
  const after = p.type === 'count' ? Math.max(0, p.delta) : Math.max(0, before + p.delta);
  item.quantity = after;
  await item.save();
  await Models.StockMovement.create({
    ...tenant(req),
    itemId: item._id,
    type: p.type,
    delta: p.delta,
    before,
    after,
    createdBy: req.user._id,
  });
  const io = req.app.get('io');
  if (item.quantity < item.threshold) {
    emitToStore(io, req.user.storeId, 'inventory:low', [{ itemId: String(item._id), name: item.name, quantity: item.quantity }]);
  }
  res.json(item);
});

router.get('/movements', async (req, res) => {
  const f = tenant(req);
  if (req.query.itemId) f.itemId = req.query.itemId;
  const list = await Models.StockMovement.find(f).sort('-createdAt').limit(200).lean();
  res.json(list);
});

export default router;
