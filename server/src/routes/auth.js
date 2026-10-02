import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getUserById, getUserByPhone, getUserByEmail, normalizeUser, query } from '../db.js';
import {
  authenticate, signTokens, publicUser, JWT_SECRET, effectivePermissions,
} from '../middleware/auth.js';
import { loginSchema } from '../validators.js';

const router = Router();

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD = 6;
const PIN_RE = /^\d{4,6}$/;

// ---------------------------------------------------------------------------
// PIN 登录失败节流:同一 key 连续 5 次失败锁 60 秒。
// 单进程内存即可 —— PIN 只是「换班快捷登录」,真正的凭据还是密码。
// ---------------------------------------------------------------------------
const pinAttempts = new Map(); // key -> { count, until }
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 60_000;

function pinKey(req, body) {
  return String(body.phone || body.storeId || req.ip || 'unknown');
}
function pinLocked(key) {
  const a = pinAttempts.get(key);
  if (!a) return 0;
  if (a.until && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
  return 0;
}
function pinFail(key) {
  const a = pinAttempts.get(key) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= PIN_MAX_FAILS) { a.until = Date.now() + PIN_LOCK_MS; a.count = 0; }
  pinAttempts.set(key, a);
}
function pinOk(key) { pinAttempts.delete(key); }

async function touchLogin(userId) {
  try { await query('UPDATE users SET last_login_at=NOW() WHERE id=?', [userId]); } catch { /* 老库没这列也无所谓 */ }
}

async function respondWithSession(res, user) {
  const { access, refresh } = signTokens(user);
  const permissions = await effectivePermissions(user);
  res.json({ accessToken: access, refreshToken: refresh, user: publicUser(user), permissions });
}

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid input' });
  const { phone, email, password } = parsed.data;
  const user = phone ? await getUserByPhone(phone) : await getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  if (!user.isActive) return res.status(403).json({ error: 'account disabled' });
  await touchLogin(user.id);
  await respondWithSession(res, user);
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  try {
    const d = jwt.verify(refreshToken, JWT_SECRET);
    const user = await getUserById(d.sub);
    if (!user) return res.status(401).json({ error: 'invalid' });
    const { access, refresh } = signTokens(user);
    res.json({ accessToken: access, refreshToken: refresh });
  } catch {
    res.status(401).json({ error: 'invalid' });
  }
});

// ---- PIN 快捷登录(换班/收银台快速切换),不需要密码 ----
// 两种用法:带 phone 精确匹配;只带 storeId 时在该店已设 PIN 的员工里逐个比对。
router.post('/pin-login', async (req, res) => {
  const body = req.body || {};
  const pin = String(body.pin || '');
  if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'invalid pin format' });

  const key = pinKey(req, body);
  const wait = pinLocked(key);
  if (wait) return res.status(429).json({ error: `too many attempts, retry in ${wait}s`, retryAfter: wait });

  let candidates = [];
  if (body.phone) {
    const u = await getUserByPhone(String(body.phone));
    if (u) candidates = [u];
  } else if (body.storeId) {
    const rows = await query(
      'SELECT * FROM users WHERE store_id=? AND is_active=1 AND pin IS NOT NULL',
      [Number(body.storeId)],
    );
    candidates = rows.map(normalizeUser);
  } else {
    return res.status(400).json({ error: 'phone or storeId required' });
  }

  let matched = null;
  for (const u of candidates) {
    if (u.pinHash && await bcrypt.compare(pin, u.pinHash)) { matched = u; break; }
  }
  if (!matched || !matched.isActive) {
    pinFail(key);
    return res.status(401).json({ error: 'invalid pin' });
  }
  pinOk(key);
  await touchLogin(matched.id);
  await respondWithSession(res, matched);
});

// ---- 以下都要登录 ----
router.use(authenticate);

router.get('/me', async (req, res) => {
  const permissions = await effectivePermissions(req.user);
  res.json({ user: publicUser(req.user), permissions });
});

/** 当前用户生效的按键权限清单(前端 gate 用)。 */
router.get('/permissions', async (req, res) => {
  res.json({ role: req.user.role, permissions: await effectivePermissions(req.user) });
});

/** 改自己的密码:必须验旧密码,且新密码不能与旧密码相同。 */
router.put('/password', async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'old and new password required' });
  if (String(newPassword).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD} characters` });
  }
  const fresh = await getUserById(req.user.id);
  if (!fresh) return res.status(404).json({ error: 'user not found' });
  const ok = await bcrypt.compare(String(oldPassword), fresh.passwordHash);
  if (!ok) return res.status(401).json({ error: 'current password is incorrect' });
  const same = await bcrypt.compare(String(newPassword), fresh.passwordHash);
  if (same) return res.status(400).json({ error: 'new password must differ from the current one' });
  const hash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  await query('UPDATE users SET password_hash=? WHERE id=?', [hash, fresh.id]);
  res.json({ ok: true });
});

/** 设置 / 清除自己的 PIN。改 PIN 需要账号密码,避免旁人顺手设一个。 */
router.put('/pin', async (req, res) => {
  const { password, pin } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password required' });
  const fresh = await getUserById(req.user.id);
  if (!fresh) return res.status(404).json({ error: 'user not found' });
  const ok = await bcrypt.compare(String(password), fresh.passwordHash);
  if (!ok) return res.status(401).json({ error: 'password is incorrect' });

  const raw = pin == null ? '' : String(pin).trim();
  if (raw === '') {
    await query('UPDATE users SET pin=NULL WHERE id=?', [fresh.id]);
    return res.json({ ok: true, hasPin: false });
  }
  if (!PIN_RE.test(raw)) return res.status(400).json({ error: 'pin must be 4-6 digits' });
  const hash = await bcrypt.hash(raw, BCRYPT_ROUNDS);
  await query('UPDATE users SET pin=? WHERE id=?', [hash, fresh.id]);
  res.json({ ok: true, hasPin: true });
});

export default router;
