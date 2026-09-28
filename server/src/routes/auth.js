import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getUserById, getUserByPhone, getUserByEmail } from '../db.js';
import { authenticate, signTokens, publicUser, JWT_SECRET } from '../middleware/auth.js';
import { loginSchema } from '../validators.js';

const router = Router();

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid input' });
  const { phone, email, password } = parsed.data;
  const user = phone ? await getUserByPhone(phone) : await getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const { access, refresh } = signTokens(user);
  res.json({ accessToken: access, refreshToken: refresh, user: publicUser(user) });
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

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;
