import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api/client.js';

const NEXT = { kitchen: ['preparing', 'ready'], preparing: ['ready'], ready: ['served'] };

export default function KDSPage() {
  const [tickets, setTickets] = useState([]);
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || undefined;
    const socket = io(socketUrl, { auth: { token: localStorage.getItem('token') } });
    socket.on('kds:snapshot', (list) => setTickets(list));
    const receive = (o) => setTickets((prev) => [o, ...prev.filter((t) => t._id !== o._id)]);
    socket.on('kds:ticket', receive); socket.on('order:created', receive);
    socket.on('order:closed', (id) => setTickets((prev) => prev.filter((t) => t._id !== id)));
    return () => socket.disconnect();
  }, []);
  const update = async (order, status) => {
    const r = await api.put(`/orders/${order._id}/status`, { status });
    if (status === 'served') setTickets((prev) => prev.filter((t) => t._id !== order._id));
    else setTickets((prev) => [r.data, ...prev.filter((t) => t._id !== order._id)]);
  };
  return <div className="kds-modern"><div className="kds-heading"><div><div className="modern-eyebrow">SMPOS / KITCHEN DISPLAY</div><h1>Kitchen Orders</h1><p>Send 后订单会实时出现在这里</p></div><span>{tickets.length} active tickets</span></div><div className="kds-grid">{tickets.map((o) => <Ticket key={o._id} order={o} onUpdate={update} />)}{!tickets.length && <div className="ops-empty">暂无待制作订单</div>}</div></div>;
}

function Ticket({ order, onUpdate }) {
  const next = NEXT[order.status] || [];
  return <article className={`kds-ticket status-${order.status}`}><div className="kds-ticket-top"><div><strong>{order.orderNo}</strong><small>{order.type === 'dine_in' ? 'Dine in' : 'Takeaway'} · {new Date(order.createdAt).toLocaleTimeString()}</small></div><span>{order.status}</span></div><ul>{order.items.map((it, idx) => <li key={idx}><b>{it.qty} ×</b><span>{it.code ? `${it.code} ` : ''}{it.name}</span></li>)}</ul><div className="kds-ticket-actions">{next.map((status) => <button key={status} onClick={() => onUpdate(order, status)}>{status === 'preparing' ? 'Accept / Preparing' : status === 'ready' ? 'Ready' : 'Served'}</button>)}</div></article>;
}
