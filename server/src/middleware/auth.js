import jwt from 'jsonwebtoken';
import { getUserById, normalizeUser } from '../db.js';

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
  };
}
