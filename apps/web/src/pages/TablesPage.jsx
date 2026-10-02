import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const DEFAULT_SECTIONS = [
  { id: 'one', label: 'Section One', numbers: Array.from({ length: 64 }, (_, i) => String(i + 1)) },
  { id: 'two', label: 'Section Two', numbers: [...Array.from({ length: 36 }, (_, i) => String(i + 65)), 'TA1', 'TA2', 'TA3', 'TA4', 'TA5', 'TA6', 'ST1', 'ST2', 'ST3'] },
  { id: 'three', label: 'Section Three', numbers: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
];

export default function TablesPage() {
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [section, setSection] = useState(DEFAULT_SECTIONS[0].id);
  const [viewSales, setViewSales] = useState(false);
  const [num, setNum] = useState('');
  const [transferFrom, setTransferFrom] = useState(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [t, o, u] = await Promise.all([
      api.get('/tables'),
      api.get('/orders?status=running'),
      api.get('/sales-persons'),
    ]);
    setTables(t.data); setOrders(o.data); setUsers(u.data);
  };
  useEffect(() => { load(); }, []);

  const current = DEFAULT_SECTIONS.find((s) => s.id === section);
  const lookup = useMemo(() => Object.fromEntries(tables.map((t) => [t.number, t])), [tables]);
  const orderByTable = useMemo(() => {
    const m = {};
    for (const o of orders) if (o.tableId != null) m[String(o.tableId)] = o;
    return m;
  }, [orders]);

  const add = async () => { if (!num) return; await api.post('/tables', { number: num, zone: section, seats: 4 }); setNum(''); load(); };
  const setStatus = async (id, status) => { await api.post(`/tables/${id}/status`, { status }); load(); };

  // 空桌 → 直接点开；占用桌 → 弹出转台选择
  const onTable = (t) => {
    if (!t) return;
    const order = orderByTable[String(t.id)];
    if (order) setTransferFrom({ table: t, order });
    else setStatus(t._id, t.status === 'free' ? 'occupied' : 'free');
  };

  const doTransfer = async (targetTableId) => {
    if (!transferFrom) return;
    try {
      const r = await api.post(`/orders/${transferFrom.order._id}/transfer`, { tableId: targetTableId, reason: 'floor plan transfer' });
      const target = tables.find((x) => String(x.id) === String(targetTableId));
      setTransferFrom(null);
      setMessage(`${r.data.order.orderNo} 已转到桌位 ${target ? target.number : targetTableId}`);
      load();
      setTimeout(() => setMessage(''), 4000);
    } catch (e) { alert(e.response?.data?.error || '转台失败'); }
  };

  const statusClass = (t) => !t ? 'table-unconfigured' : t.status === 'free' ? 'table-free' : t.status === 'occupied' ? 'table-occupied' : 'table-clean';
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;

  return (
    <div className="table-screen">
      <div className="table-screen-header"><div><b>Table / Floor Plan</b><span> · 点占用桌可转台 · View Current Sales</span></div><div className="table-actions"><button onClick={load}>Refresh</button><button onClick={() => setViewSales(true)}>View Sales</button><button onClick={() => history.back()}>Exit</button></div></div>
      {message && <div className="table-message">{message}</div>}
      <div className="table-section-tabs">{DEFAULT_SECTIONS.map((s) => <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>{s.label}</button>)}</div>
      <div className="table-legend"><span><i className="dot free" />Free</span><span><i className="dot occupied" />Occupied</span><span><i className="dot clean" />Needs Clean</span><span><i className="dot missing" />Not Configured</span></div>
      <div className="table-grid">{current.numbers.map((n) => {
        const t = lookup[n];
        const o = t ? orderByTable[String(t.id)] : null;
        return <button key={n} className={`floor-table ${statusClass(t)}`} onClick={() => onTable(t)}>
          <b>{n}</b>
          <small>{t ? (o ? money(o.total) : t.status === 'free' ? 'FREE' : t.status === 'occupied' ? 'BUSY' : 'CLEAN') : '—'}</small>
          {o && <em>{o.items.reduce((s, i) => s + Number(i.qty), 0)} items</em>}
        </button>;
      })}</div>
      <div className="table-create"><input value={num} placeholder="新增桌号（如 A1 / TA1）" onChange={(e) => setNum(e.target.value)} /><button onClick={add}>Add Table</button></div>

      {transferFrom && <TransferPicker from={transferFrom} tables={tables} onConfirm={doTransfer} onClose={() => setTransferFrom(null)} />}
      {viewSales && <CurrentSales orders={orders} tables={tables} users={users} onClose={() => setViewSales(false)} />}
    </div>
  );
}

function TransferPicker({ from, tables, onConfirm, onClose }) {
  const [pick, setPick] = useState('');
  const free = tables.filter((t) => t.status === 'free');
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window" style={{ width: 470 }}>
    <header><span>Transfer Table · {from.order.orderNo}</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      <div className="payment-amount-box"><small>FROM TABLE</small><strong>{from.table.number}</strong></div>
      <p className="settlement-note">选择目标空闲桌位，原桌位自动释放。当前单 ¥{Number(from.order.total).toFixed(2)}。</p>
      <div className="transfer-grid">
        {free.map((t) => <button key={t.id} className={pick === t.id ? 'active' : ''} onClick={() => setPick(t.id)}><b>{t.number}</b><small>{t.seats || 4} seats</small></button>)}
      </div>
      {!free.length && <div className="ops-empty">没有空闲桌位可转</div>}
      <div className="legacy-window-actions">
        <button className="legacy-btn green" disabled={!pick} onClick={() => onConfirm(pick)}>Move to Table</button>
        <button className="legacy-btn pink" onClick={onClose}>Cancel</button>
      </div>
    </div>
  </section></div>;
}

function CurrentSales({ orders, tables, users, onClose }) {
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const tableNo = (id) => (tables.find((t) => String(t.id) === String(id)) || {}).number || '—';
  const userName = (id) => (users.find((u) => String(u.id) === String(id)) || {}).name || '—';
  const total = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  return <div className="legacy-window-wrap"><section className="legacy-window large"><header><span>▣ View Current Sales</span><button onClick={onClose}>×</button></header><div className="legacy-window-body">
    <h2>View Current Sales · {orders.length} 张进行中 · {money(total)}</h2>
    <div className="legacy-table current-sales-table">
      <div className="legacy-table-head"><span>DATE</span><span>CASHIER</span><span>SALES PERSON</span><span>TABLE</span><span>ORDNUM</span><span>STIME</span><span>AMOUNT</span><span>ITEMS</span></div>
      {orders.map((o) => <div className="legacy-table-row" key={o._id}>
        <span>{new Date(o.createdAt).toLocaleDateString('en-GB')}</span>
        <span>{userName(o.createdBy)}</span>
        <span>{o.salesPersonId ? userName(o.salesPersonId) : '—'}</span>
        <span>{tableNo(o.tableId)}</span>
        <span>{o.orderNo}</span>
        <span>{new Date(o.createdAt).toLocaleTimeString('en-GB')}</span>
        <span>{money(o.total)}</span>
        <span>{o.items.reduce((s, i) => s + Number(i.qty), 0)}</span>
      </div>)}
      {!orders.length && <div className="legacy-empty-row">暂无进行中的销售</div>}
    </div>
    <div className="legacy-window-actions"><button className="legacy-btn blue">Re-Print Last Receipt</button><button className="legacy-btn yellow">Re-Print Last Bill</button><button className="legacy-btn pink" onClick={onClose}>Exit</button></div>
  </div></section></div>;
}
