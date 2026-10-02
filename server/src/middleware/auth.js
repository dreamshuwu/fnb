import jwt from 'jsonwebtoken';
import { getUserById, normalizeUser, getRolePermissionOverrides } from '../db.js';
import { hasPermission, resolveRolePermissions } from '../permissions.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export function signTokens(user) {
  const payload = {
    sub: String(user.id ?? user._id),
    orgId: String(user.orgId),
    storeId: String(user.storeId),
    role: user.role,
  };
  const access = jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '2h' });
  const refresh = jwt.sign({ sub: payload.sub }, JWT_SECRET, { expiresIn: process.env.REFRESH_EXPIRES_IN || '7d' });
  return { access, refresh };
}

export async function authenticate(req, res, next) {
  // 支持 ?token= —— 浏览器直接下载/新窗口打开导出文件时无法带 Authorization 头
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.sub);
    if (!user || !user.isActive) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

export function rbac(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

export const isSupervisor = (role) => role === 'admin' || role === 'manager';

// 多租户隔离:在查询条件中强制注入 orgId / storeId
export function tenant(req, extra = {}) {
  return { orgId: req.user.orgId, storeId: req.user.storeId, ...extra };
}

export function publicUser(u) {
  return {
    id: String(u.id ?? u._id),
    name: u.name,
    role: u.role,
    orgId: String(u.orgId),
    storeId: String(u.storeId),
    phone: u.phone,
    email: u.email || null,
    employeeNo: u.employeeNo || null,
    joinDate: u.joinDate || null,
    lastLoginAt: u.lastLoginAt || null,
    // 只回「有没有设 PIN」,绝不回 bcrypt 哈希
    hasPin: !!u.hasPin,
    isActive: u.isActive !== false,
  };
}

// ---------------------------------------------------------------------------
// 按键级权限(与 permissions.js 目录对应)
// 权限矩阵存在 role_permissions 表里,每个请求都查库太贵,按门店缓存 15 秒。
// 后台改完权限后调用 invalidatePermissionCache 立即失效。
// ---------------------------------------------------------------------------
const permCache = new Map(); // `${orgId}:${storeId}` -> { at, overrides }
const PERM_TTL = 15_000;

export function invalidatePermissionCache(orgId, storeId) {
  permCache.delete(`${orgId}:${storeId}`);
}

async function loadOverrides(orgId, storeId) {
  const key = `${orgId}:${storeId}`;
  const hit = permCache.get(key);
  if (hit && Date.now() - hit.at < PERM_TTL) return hit.overrides;
  let overrides = {};
  try {
    overrides = await getRolePermissionOverrides(orgId, storeId);
  } catch {
    overrides = {}; // 表还没建好时回落到默认值,不阻断业务
  }
  permCache.set(key, { at: Date.now(), overrides });
  return overrides;
}

/** 某用户当前生效的权限清单(角色默认值 + 本店覆盖值)。 */
export async function effectivePermissions(user) {
  if (!user) return [];
  const overrides = await loadOverrides(user.orgId, user.storeId);
  return resolveRolePermissions(user.role, overrides);
}

/** 路由守卫:要求当前用户具备全部指定按键权限。 */
export function requirePermission(...keys) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    const perms = await effectivePermissions(req.user);
    const missing = keys.filter((k) => !hasPermission(perms, k));
    if (missing.length) return res.status(403).json({ error: 'forbidden', missing });
    next();
  };
}
