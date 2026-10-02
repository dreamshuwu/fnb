import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, getRow, insert, stringifyJSON } from '../db.js';
import { authenticate, rbac, requirePermission, invalidatePermissionCache } from '../middleware/auth.js';
import {
  ROLES, PERMISSION_GROUPS, ALL_PERMISSIONS, defaultPermissions, resolveRolePermissions,
} from '../permissions.js';

const router = Router();
router.use(authenticate);

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD = 6;
const PIN_RE = /^\d{4,6}$/;
const VALID_ROLES = new Set(ROLES);

const staffRow = (r) => ({
  id: r.id, _id: r.id, orgId: r.org_id, storeId: r.store_id,
  name: r.name, phone: r.phone, email: r.email || null, role: r.role,
  employeeNo: r.employee_no || null,
  joinDate: r.join_date == null ? null : (r.join_date instanceof Date ? r.join_date.toISOString().slice(0, 10) : String(r.join_date).slice(0, 10)),
  lastLoginAt: r.last_login_at == null ? null : (r.last_login_at instanceof Date ? r.last_login_at.toISOString() : String(r.last_login_at)),
  hasPin: !!r.pin, isActive: !!r.is_active,
  createdAt: r.created_at == null ? null : (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
});

function bad(res, msg) { return res.status(400).json({ error: msg }); }

/** 该店还有几个「启用中的 admin」——用来拦住把最后一个管理员停用/删除的操作。 */
async function activeAdminCount(orgId, storeId, excludeId) {
  const r = await getRow(
    `SELECT COUNT(*) AS c FROM users
     WHERE org_id=? AND store_id=? AND role='admin' AND is_active=1 ${excludeId ? 'AND id<>?' : ''}`,
    excludeId ? [orgId, storeId, excludeId] : [orgId, storeId],
  );
  return Number(r?.c || 0);
}

// ---------------------------------------------------------------------------
// 权限矩阵(放在 /:id 之前,避免被参数路由吃掉)
// ---------------------------------------------------------------------------
router.get('/roles/permissions', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const rows = await query('SELECT role, permissions FROM role_permissions WHERE org_id=? AND store_id=?', [orgId, storeId]);
  const overrides = {};
  for (const r of rows) {
    try { overrides[r.role] = typeof r.permissions === 'string' ? JSON.parse(r.permissions || '[]') : (r.permissions || []); }
    catch { overrides[r.role] = []; }
  }
  const roles = {};
  for (const role of ROLES) roles[role] = resolveRolePermissions(role, overrides);
  res.json({ catalog: PERMISSION_GROUPS, all: ALL_PERMISSIONS, roles, defaults: ROLES.reduce((a, r) => (a[r] = defaultPermissions(r), a), {}) });
});

router.put('/roles/:role/permissions', requirePermission('permission.manage'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const role = String(req.params.role);
  if (!VALID_ROLES.has(role)) return bad(res, 'unknown role');
  if (role === 'admin') return bad(res, 'admin permissions cannot be restricted');

  const list = Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : null;
  if (!list) return bad(res, 'permissions must be an array');
  const unknown = list.filter((k) => !ALL_PERMISSIONS.includes(k));
  if (unknown.length) return bad(res, `unknown permission: ${unknown.join(', ')}`);
  const clean = [...new Set(list)];

  await query(
    `INSERT INTO role_permissions (org_id, store_id, role, permissions, updated_by, updated_by_name)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE permissions=VALUES(permissions), updated_by=VALUES(updated_by), updated_by_name=VALUES(updated_by_name)`,
    [orgId, storeId, role, stringifyJSON(clean), req.user.id, req.user.name],
  );
  invalidatePermissionCache(orgId, storeId);
  res.json({ ok: true, role, permissions: clean });
});

// ---------------------------------------------------------------------------
// 员工主档 CRUD
// ---------------------------------------------------------------------------
router.get('/', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const q = String(req.query.q || '').trim();
  const role = req.query.role ? String(req.query.role) : null;
  const status = req.query.status ? String(req.query.status) : null;

  const where = ['org_id=?', 'store_id=?'];
  const params = [orgId, storeId];
  if (q) { where.push('(name LIKE ? OR phone LIKE ? OR employee_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (role) { where.push('role=?'); params.push(role); }
  if (status === 'active') where.push('is_active=1');
  if (status === 'inactive') where.push('is_active=0');

  const rows = await query(
    `SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY is_active DESC, role, name`,
    params,
  );
  res.json(rows.map(staffRow));
});

router.post('/', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const phone = String(b.phone || '').trim();
  const role = String(b.role || 'cashier');
  if (!name) return bad(res, 'name required');
  if (!phone) return bad(res, 'phone required');
  if (!VALID_ROLES.has(role)) return bad(res, 'unknown role');
  // 店长不能造管理员,否则等于绕过权限边界
  if (req.user.role === 'manager' && role === 'admin') return res.status(403).json({ error: 'manager cannot create admin' });
  const password = String(b.password || '');
  if (password.length < MIN_PASSWORD) return bad(res, `password must be at least ${MIN_PASSWORD} characters`);

  const dup = await getRow('SELECT id FROM users WHERE phone=?', [phone]);
  if (dup) return bad(res, 'phone already in use');

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id = await insert(
    `INSERT INTO users (org_id, store_id, name, phone, email, role, employee_no, join_date, password_hash, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,1)`,
    [orgId, storeId, name, phone, b.email ? String(b.email) : null, role,
      b.employeeNo ? String(b.employeeNo) : null, b.joinDate ? String(b.joinDate) : null, hash],
  );
  res.status(201).json(staffRow(await getRow('SELECT * FROM users WHERE id=?', [id])));
});

router.get('/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const r = await getRow('SELECT * FROM users WHERE id=? AND org_id=? AND store_id=?', [Number(req.params.id), orgId, storeId]);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(staffRow(r));
});

router.put('/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const id = Number(req.params.id);
  const cur = await getRow('SELECT * FROM users WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  if (!cur) return res.status(404).json({ error: 'not found' });
  // 店长不能碰管理员账号
  if (req.user.role === 'manager' && cur.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });

  const b = req.body || {};
  const fields = [];
  const params = [];
  if (b.name != null) { const v = String(b.name).trim(); if (!v) return bad(res, 'name required'); fields.push('name=?'); params.push(v); }
  if (b.phone != null) {
    const v = String(b.phone).trim();
    if (!v) return bad(res, 'phone required');
    const dup = await getRow('SELECT id FROM users WHERE phone=? AND id<>?', [v, id]);
    if (dup) return bad(res, 'phone already in use');
    fields.push('phone=?'); params.push(v);
  }
  if (b.email !== undefined) { fields.push('email=?'); params.push(b.email ? String(b.email) : null); }
  if (b.employeeNo !== undefined) { fields.push('employee_no=?'); params.push(b.employeeNo ? String(b.employeeNo) : null); }
  if (b.joinDate !== undefined) { fields.push('join_date=?'); params.push(b.joinDate ? String(b.joinDate) : null); }
  if (b.role != null) {
    const v = String(b.role);
    if (!VALID_ROLES.has(v)) return bad(res, 'unknown role');
    if (req.user.role === 'manager' && v === 'admin') return res.status(403).json({ error: 'manager cannot grant admin' });
    // 不能把最后一个管理员降级
    if (cur.role === 'admin' && v !== 'admin') {
      const others = await activeAdminCount(orgId, storeId, id);
      if (others === 0) return bad(res, 'cannot demote the last admin');
    }
    fields.push('role=?'); params.push(v);
  }
  if (!fields.length) return bad(res, 'nothing to update');

  params.push(id, orgId, storeId);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id=? AND org_id=? AND store_id=?`, params);
  invalidatePermissionCache(orgId, storeId);
  res.json(staffRow(await getRow('SELECT * FROM users WHERE id=?', [id])));
});

router.put('/:id/status', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const id = Number(req.params.id);
  const cur = await getRow('SELECT * FROM users WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'manager' && cur.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });
  if (id === Number(req.user.id)) return bad(res, 'cannot change your own status');

  const isActive = req.body?.isActive === undefined ? !cur.is_active : !!req.body.isActive;
  if (!isActive && cur.role === 'admin') {
    const others = await activeAdminCount(orgId, storeId, id);
    if (others === 0) return bad(res, 'cannot disable the last admin');
  }
  await query('UPDATE users SET is_active=? WHERE id=? AND org_id=? AND store_id=?', [isActive ? 1 : 0, id, orgId, storeId]);
  res.json(staffRow(await getRow('SELECT * FROM users WHERE id=?', [id])));
});

/** 管理员重置他人密码(不需要旧密码)。 */
router.put('/:id/password', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const id = Number(req.params.id);
  const cur = await getRow('SELECT * FROM users WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'manager' && cur.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });

  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < MIN_PASSWORD) return bad(res, `password must be at least ${MIN_PASSWORD} characters`);
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await query('UPDATE users SET password_hash=? WHERE id=? AND org_id=? AND store_id=?', [hash, id, orgId, storeId]);
  res.json({ ok: true });
});

/** 管理员设置/清除他人 PIN。 */
router.put('/:id/pin', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const id = Number(req.params.id);
  const cur = await getRow('SELECT * FROM users WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'manager' && cur.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });

  const raw = req.body?.pin == null ? '' : String(req.body.pin).trim();
  if (raw === '') {
    await query('UPDATE users SET pin=NULL WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
    return res.json({ ok: true, hasPin: false });
  }
  if (!PIN_RE.test(raw)) return bad(res, 'pin must be 4-6 digits');
  const hash = await bcrypt.hash(raw, BCRYPT_ROUNDS);
  await query('UPDATE users SET pin=? WHERE id=? AND org_id=? AND store_id=?', [hash, id, orgId, storeId]);
  res.json({ ok: true, hasPin: true });
});

/** 删除 = 停用(软删除),保留历史单据上的收银员/服务员引用。 */
router.delete('/:id', rbac('admin', 'manager'), async (req, res) => {
  const { orgId, storeId } = { orgId: req.user.orgId, storeId: req.user.storeId };
  const id = Number(req.params.id);
  const cur = await getRow('SELECT * FROM users WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (id === Number(req.user.id)) return bad(res, 'cannot delete your own account');
  if (req.user.role === 'manager' && cur.role === 'admin') return res.status(403).json({ error: 'manager cannot modify admin' });
  if (cur.role === 'admin') {
    const others = await activeAdminCount(orgId, storeId, id);
    if (others === 0) return bad(res, 'cannot delete the last admin');
  }
  await query('UPDATE users SET is_active=0 WHERE id=? AND org_id=? AND store_id=?', [id, orgId, storeId]);
  res.json({ ok: true, deactivated: true });
});

export default router;
