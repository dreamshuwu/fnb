import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export default function KDSPage() {
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    // 跨域部署时通过 VITE_SOCKET_URL / VITE_API_URL 指向后端；留空则同源
    const socketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || undefined;
    const socket = io(socketUrl, { auth: { token: localStorage.getItem('token') } });
    socket.on('kds:snapshot', (list) => setTickets(list));
    socket.on('kds:ticket', (o) =>
      setTickets((prev) => [o, ...prev.filter((t) => t._id !== o._id)])
    );
    socket.on('order:created', (o) =>
      setTickets((prev) => [o, ...prev.filter((t) => t._id !== o._id)])
    );
    socket.on('order:closed', (id) =>
      setTickets((prev) => prev.filter((t) => t._id !== id))
    );
    return () => socket.disconnect();
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">KDS 厨房出单</h2>
      <div className="grid grid-cols-3 gap-4">
        {tickets.map((o) => (
          <div key={o._id} className="bg-white rounded shadow p-4">
            <div className="flex justify-between font-bold">
              <span>{o.orderNo}</span>
              <span>{o.type === 'dine_in' ? '堂食' : '外带'}</span>
            </div>
            <ul className="mt-2 text-sm">
              {o.items.map((it, idx) => (
                <li key={idx}>
                  {it.qty} x {it.name}
                  {it.modifiers?.length ? ' (' + it.modifiers.join(',') + ')' : ''}
                  {it.note ? ' [' + it.note + ']' : ''}
                </li>
              ))}
            </ul>
            <div className="text-xs text-slate-400 mt-2">
              {new Date(o.createdAt).toLocaleTimeString()}
            </div>
          </div>
        ))}
        {!tickets.length && <div className="text-slate-400">暂无待出单</div>}
      </div>
    </div>
  );
}
