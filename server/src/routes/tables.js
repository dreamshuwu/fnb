import { Router } from 'express';
import { query, getRow, insert, toTable } from '../db.js';
import { authenticate, rbac, tenant } from '../middleware/auth.js';
import { tableSchema } from '../validators.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const list = await query(
    'SELECT * FROM tables WHERE org_id=? AND store_id=? ORDER BY number',
    [orgId, storeId]
  );
  res.json(list.map(toTable));
});

router.post('/', rbac('admin', 'manager'), async (req, res) => {
  const p = tableSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const id = await insert(
    'INSERT INTO tables (org_id, store_id, number, zone, seats) VALUES (?,?,?,?,?)',
    [orgId, storeId, p.number, p.zone ?? null, p.seats ?? null]
  );
  res.status(201).json(toTable(await getRow('SELECT * FROM tables WHERE id=?', [id])));
});

router.put('/:id', rbac('admin', 'manager'), async (req, res) => {
  const p = tableSchema.parse(req.body);
  const { orgId, storeId } = tenant(req);
  const sets = [], params = [];
  if (p.number !== undefined) { sets.push('number=?'); params.push(p.number); }
  if (p.zone !== undefined) { sets.push('zone=?'); params.push(p.zone); }
  if (p.seats !== undefined) { sets.push('seats=?'); params.push(p.seats); }
  if (p.status !== undefined) { sets.push('status=?'); params.push(p.status); }
  params.push(req.params.id, orgId, storeId);
  await query(`UPDATE tables SET ${sets.join(',')} WHERE id=? AND org_id=? AND store_id=?`, params);
  res.json(toTable(await getRow('SELECT * FROM tables WHERE id=?', [req.params.id])));
});

router.post('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const { orgId, storeId } = tenant(req);
  // 手动改状态时同步清掉占用关系，避免遗留 current_order_id 指向已结单的订单
  if (status && status !== 'occupied') {
    await query('UPDATE tables SET status=?, current_order_id=NULL WHERE id=? AND org_id=? AND store_id=?', [status, req.params.id, orgId, storeId]);
  } else {
    await query('UPDATE tables SET status=? WHERE id=? AND org_id=? AND store_id=?', [status, req.params.id, orgId, storeId]);
  }
  const row = await getRow('SELECT * FROM tables WHERE id=?', [req.params.id]);
  const io = req.app.get('io');
  if (io) io.to(`store:${storeId}`).emit('tables:changed', toTable(row));
  res.json(toTable(row));
});

export default router;
