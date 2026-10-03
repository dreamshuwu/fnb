// ⚠️ 必须是第一个 import:它会修补 express.Router,让 async handler 的抛错
// 走 next(err) 而不是变成 unhandledRejection 杀掉进程。
// ESM 按 import 顺序求值,放第一位才能早于下面所有 routes/*.js 生效。
import { errorHandler } from './middleware/errors.js';

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { initSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import menuRoutes from './routes/menu.js';
import tableRoutes from './routes/tables.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import inventoryRoutes from './routes/inventory.js';
import reportRoutes from './routes/reports.js';
import shiftRoutes from './routes/shifts.js';
import businessRoutes from './routes/business.js';
import purchasingRoutes from './routes/purchasing.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- 单机/共享主机部署:由同一个 Node 进程直接托管前端静态文件(SPA) ----
// 这样无需单独静态服务器、子域或 .htaccess;前端用同源 /api 调接口。
// 静态目录默认 server/public(构建后复制进来),可用 WEB_DIST_PATH 覆盖。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = process.env.WEB_DIST_PATH || path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA 回退:非 /api、非 /socket.io 的请求都返回 index.html
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

const server = http.createServer(app);
const { Server } = await import('socket.io');
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*' } });
app.set('io', io);

const PORT = process.env.PORT || 4000;

// 开发预览模式(免 MySQL):DEV_NO_DB=1 时用一个内存假数据后端,便于本地/预览直接看完整界面
if (process.env.DEV_NO_DB === '1') {
  const { seedDev, createDevRouter, initDevSockets } = await import('./devMode.js');
  seedDev();
  app.use('/api', createDevRouter(io));
  initDevSockets(io);
  server.listen(PORT, () => console.log(`[dev-mode] listening on :${PORT} (no MySQL)`));
} else {
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/menu', menuRoutes);
  app.use('/api/tables', tableRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api', businessRoutes);
  app.use('/api', purchasingRoutes);
  app.use('/api/shifts', shiftRoutes);
  const { initSockets } = await import('./sockets.js');
  initSockets(io);
  initSchema()
    .then(() => seedIfEmpty())
    .then(() => {
      server.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

// 兜底错误中间件:必须挂在所有路由之后。
// 走到这里的通常是 next(err) 传下来的异常(含 zod 校验失败)。
app.use(errorHandler);
