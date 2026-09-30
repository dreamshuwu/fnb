import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const DEFAULT_SECTIONS = [
  { id: 'one', label: 'Section One', numbers: Array.from({ length: 64 }, (_, i) => String(i + 1)) },
  { id: 'two', label: 'Section Two', numbers: [...Array.from({ length: 36 }, (_, i) => String(i + 65)), 'TA1', 'TA2', 'TA3', 'TA4', 'TA5', 'TA6', 'ST1', 'ST2', 'ST3'] },
  { id: 'three', label: 'Section Three', numbers: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
];

export default function TablesPage() {
  const [tables, setTables] = useState([]);
  const [section, setSection] = useState(DEFAULT_SECTIONS[0].id);
  const [viewSales, setViewSales] = useState(false);
  const [num, setNum] = useState('');
  const load = async () => { const r = await api.get('/tables'); setTables(r.data); };
  useEffect(() => { load(); }, []);
  const current = DEFAULT_SECTIONS.find((s) => s.id === section);
  const lookup = useMemo(() => Object.fromEntries(tables.map((t) => [t.number, t])), [tables]);
  const add = async () => { if (!num) return; await api.post('/tables', { number: num, zone: section, seats: 4 }); setNum(''); load(); };
  const setStatus = async (id, status) => { await api.post(`/tables/${id}/status`, { status }); load(); };
  const statusClass = (t) => !t ? 'table-unconfigured' : t.status === 'free' ? 'table-free' : t.status === 'occupied' ? 'table-occupied' : 'table-clean';
  return (
    <div className="table-screen">
      <div className="table-screen-header"><div><b>Table / Floor Plan</b><span> · View Current Sales</span></div><div className="table-actions"><button onClick={load}>Refresh</button><button onClick={() => setViewSales(true)}>View Sales</button><button onClick={() => history.back()}>Exit</button></div></div>
      <div className="table-section-tabs">{DEFAULT_SECTIONS.map((s) => <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>{s.label}</button>)}</div>
      <div className="table-legend"><span><i className="dot free" />Free</span><span><i className="dot occupied" />Occupied</span><span><i className="dot clean" />Needs Clean</span><span><i className="dot missing" />Not Configured</span></div>
      <div className="table-grid">{current.numbers.map((n) => { const t = lookup[n]; return <button key={n} className={`floor-table ${statusClass(t)}`} onClick={() => t && setStatus(t._id, t.status === 'free' ? 'occupied' : 'free')}><b>{n}</b><small>{t ? (t.status === 'free' ? 'FREE' : t.status === 'occupied' ? 'BUSY' : 'CLEAN') : '—'}</small></button>; })}</div>
      <div className="table-create"><input value={num} placeholder="新增桌号（如 A1 / TA1）" onChange={(e) => setNum(e.target.value)} /><button onClick={add}>Add Table</button></div>
      {viewSales && <CurrentSales tables={tables} onClose={() => setViewSales(false)} />}
    </div>
  );
}

function CurrentSales({ tables, onClose }) {
  return <div className="legacy-window-wrap"><section className="legacy-window large"><header><span>▣ View Current Sales</span><button onClick={onClose}>×</button></header><div className="legacy-window-body"><h2>View Current Sales</h2><div className="legacy-table"><div className="legacy-table-head"><span>DATE</span><span>CASHIER</span><span>SALES PERSON</span><span>TABLE</span><span>ORDNUM</span><span>STIME</span><span>AMOUNT</span><span>MINIT</span></div>{tables.filter((t) => t.status === 'occupied').map((t) => <div className="legacy-empty-row" key={t._id}>{new Date().toLocaleDateString()}　—　—　{t.number}　—　—　—　—</div>)}{!tables.some((t) => t.status === 'occupied') && <div className="legacy-empty-row">暂无进行中的销售</div>}</div><div className="legacy-window-actions"><button className="legacy-btn blue">Re-Print Last Receipt</button><button className="legacy-btn yellow">Re-Print Last Bill</button><button className="legacy-btn green">Cust Info</button><button className="legacy-btn pink" onClick={onClose}>Exit</button></div></div></section></div>;
}
