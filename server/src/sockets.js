import jwt from 'jsonwebtoken';
import { Models } from './models.js';
import { JWT_SECRET } from './middleware/auth.js';

export function initSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await Models.User.findById(decoded.sub);
      if (!user) return next(new Error('unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const { orgId, storeId } = socket.user;
    const room = `store:${storeId}`;
    socket.join(room);
    // 连接时把当前在厨房的订单快照发给该客户端(KDS 用)
    const snapshot = await Models.Order.find({ orgId, storeId, status: 'kitchen' }).lean();
    socket.emit('kds:snapshot', snapshot);
  });
}

export function emitToStore(io, storeId, event, payload) {
  io.to(`store:${storeId}`).emit(event, payload);
}
