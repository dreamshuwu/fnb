import jwt from 'jsonwebtoken';
import { getRow, query, toOrder } from './db.js';
import { JWT_SECRET } from './middleware/auth.js';

export function initSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await getRow('SELECT * FROM users WHERE id = ?', [Number(decoded.sub)]);
      if (!user) return next(new Error('unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const { org_id, store_id } = socket.user;
    const room = `store:${store_id}`;
    socket.join(room);
    const snapshot = await query(
      'SELECT * FROM orders WHERE org_id=? AND store_id=? AND status=? ORDER BY created_at DESC',
      [org_id, store_id, 'kitchen']
    );
    socket.emit('kds:snapshot', snapshot.map(toOrder));
  });
}

export function emitToStore(io, storeId, event, payload) {
  io.to(`store:${storeId}`).emit(event, payload);
}
