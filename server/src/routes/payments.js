import { Router } from 'express';
import { Models } from '../models.js';
import { authenticate, tenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const f = tenant(req);
  if (req.query.orderId) f.orderId = req.query.orderId;
  const list = await Models.Payment.find(f).sort('-createdAt').lean();
  res.json(list);
});

export default router;
