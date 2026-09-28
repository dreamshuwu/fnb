import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import mongoose from 'mongoose';

import { initSockets } from './sockets.js';
import { seedIfEmpty } from './seed.js';
import authRoutes from './routes/auth.js';
import menuRoutes from './routes/menu.js';
import tableRoutes from './routes/tables.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import inventoryRoutes from './routes/inventory.js';
import reportRoutes from './routes/reports.js';
import shiftRoutes from './routes/shifts.js';

async function connectDB() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  } else if (process.env.USE_MEMORY_DB !== '0') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  } else {
    await mongoose.connect('mongodb://localhost:27017/fnbpos');
  }
  console.log('[db] MongoDB connected');
}

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/shifts', shiftRoutes);

const server = http.createServer(app);
const { Server } = await import('socket.io');
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*' } });
initSockets(io);
app.set('io', io);

const PORT = process.env.PORT || 4000;
connectDB()
  .then(() => seedIfEmpty())
  .then(() => {
    server.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
