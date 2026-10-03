import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';

const TABS = [
  ['members', 'Members'], ['finance', 'Cash / Vouchers'], ['voids', 'Void Approval'], ['refunds', 'Refunds'],
  ['reprint', 'Reprint / Unsettle'], ['attendance', 'Attendance'], ['shifts', 'Close Shift'], ['day-end', 'Day End'],
  ['suppliers', 'Suppliers'], ['purchases', 'Purchase / GRN'], ['reports', 'Reports'],
];

const REPRINT_TYPES = [
  ['bill', 'Bill / Tax Invoice'], ['receipt', 'Receipt'], ['order', 'Order Slip'],
  ['payout', 'Payout / Withdraw'], ['closeshift', 'Close Shift'], ['dayend', 'Day End'],
];

const DOC_KINDS = [['bill', 'Bill'], ['receipt', 'Receipt'], ['order', 'Order Slip'], ['kitchen', 'Kitchen'], ['bar', 'Bar']];

// 报表类型由后端 /reports/catalog 动态提供(见 ReportPanel),此处不再硬编码。

export default function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'members';
  const active = TABS.some(([key]) => key === tab) ? tab : 'members';
  return <div className="operations-page"><div className="operations-heading"><div><div className="modern-eyebrow">SMPOS / BACK OFFICE</div><h1>Operations Center</h1><p>会员、财务、取消审批、退款、班结、采购和报表</p></div><div className="operations-date">{new Date().toLocaleDateString('en-GB')}</div></div><div className="operations-tabs">{TABS.map(([key, label]) => <button key={key} className={active === key ? 'active' : ''} onClick={() => setParams({ tab: key })}>{label}</button>)}</div><div className="operations-content">{active === 'members' && <MembersPanel />} {active === 'finance' && <FinancePanel />} {active === 'voids' && <VoidPanel />} {active === 'refunds' && <RefundPanel />} {active === 'reprint' && <ReprintPanel />} {active === 'attendance' && <AttendancePanel />} {active === 'shifts' && <ShiftPanel />} {active === 'day-end' && <DayEndPanel />} {active === 'suppliers' && <SupplierPanel />} {active === 'purchases' && <PurchasePanel />} {active === 'reports' && <ReportPanel />}</div></div>;
}

function Panel({ title, subtitle, children }) { return <section className="ops-panel"><div className="ops-panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>; }
function Input({ label, value, onChange, type = 'text', placeholder = '' }) { return <label className="ops-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>; }
function Action({ children, onClick, tone = 'primary' }) { return <button className={`ops-action ${tone}`} onClick={onClick}>{children}</button>; }
function Empty({ text = 'No records yet' }) { return <div className="ops-empty">{text}</div>; }

function MembersPanel() {
  const [members, setMembers] = useState([]); const [form, setForm] = useState({ name: '', phone: '', memberNo: '' }); const [selected, setSelected] = useState(''); const [amount, setAmount] = useState(''); const [points, setPoints] = useState('');
  const load = async () => setMembers((await api.get('/members')).data); useEffect(() => { load(); }, []);
  const add = async () => { if (!form.name) return; await api.post('/members', form); setForm({ name: '', phone: '', memberNo: '' }); load(); };
  const topUp = async () => { if (!selected || !amount) return; await api.post(`/members/${selected}/top-up`, { amount: Number(amount) }); setAmount(''); load(); };
  const adjustPoints = async () => { if (!selected || !points) return; await api.post(`/members/${selected}/points`, { delta: Number(points), reason: 'manual back-office adjustment' }); setPoints(''); load(); };
  return <div className="ops-grid two"><Panel title="Member Accounts" subtitle="A/C No. · Credit Balance · Points"><div className="ops-form"><Input label="Member No." value={form.memberNo} onChange={(v) => setForm({ ...form, memberNo: v })} placeholder="M0002" /><Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} /><Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /><Action onClick={add}>Add Member</Action></div><div className="ops-table"><div className="ops-row ops-head"><span>Member</span><span>Name</span><span>Credit</span><span>Points</span></div>{members.map((m) => <button key={m.id} className={`ops-row ${selected === m.id ? 'selected' : ''}`} onClick={() => setSelected(m.id)}><span>{m.memberNo}</span><span>{m.name}</span><span>¥{m.creditBalance.toFixed(2)}</span><span>{m.points}</span></button>)}{!members.length && <Empty />}</div></Panel><Panel title="Member Actions" subtitle={selected ? `Selected: ${members.find((m) => m.id === selected)?.memberNo || ''}` : 'Select a member first'}><div className="ops-form"><Input label="Top Up Amount" type="number" value={amount} onChange={setAmount} /><Action onClick={topUp}>Member Top Up</Action><Input label="Points Adjustment" type="number" value={points} onChange={setPoints} /><Action tone="secondary" onClick={adjustPoints}>Calculate / Adjust Points</Action><Action tone="secondary" onClick={async () => { if (selected && amount) { await api.post(`/members/${selected}/knock-off`, { amount: Number(amount) }); setAmount(''); load(); } }}>Knock Off Bill</Action></div></Panel></div>;
}

const newCreditNote = () => ({ customerName: '', orderNo: '', reason: '', includeGst: false, restock: true, items: [] });

function FinancePanel() {
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [form, setForm] = useState({ type: 'cash_in', amount: '', payTo: '', reason: '', method: 'cash' });
  const [note, setNote] = useState(newCreditNote());
  const [variants, setVariants] = useState([]);
  const [pick, setPick] = useState('');
  const load = async () => { setRows((await api.get('/finance/movements')).data); setNotes((await api.get('/finance/credit-notes')).data); };
  useEffect(() => { load(); api.get('/menu/variants').then((r) => setVariants(r.data)); }, []);
  const save = async () => { if (!form.amount) return; await api.post('/finance/movements', { ...form, amount: Number(form.amount) }); setForm({ ...form, amount: '', payTo: '', reason: '' }); load(); };

  const addLine = (v) => setNote((n) => ({ ...n, items: [...n.items, { code: v ? v.code : '', barcode: v?.barcode || '', description: v ? v.name : '', location: '', qty: 1, uom: 'pcs', retail: v ? Number(v.price) : 0, cost: v ? Number(v.cost || 0) : 0 }] }));
  const updLine = (i, patch) => setNote((n) => ({ ...n, items: n.items.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  const delLine = (i) => setNote((n) => ({ ...n, items: n.items.filter((_, idx) => idx !== i) }));
  const lineSub = (l) => Number(l.qty || 0) * Number(l.retail || 0);
  const cnSubtotal = note.items.reduce((s, l) => s + lineSub(l), 0);
  const saveNote = async () => {
    if (!note.items.length) { alert('请至少添加一行'); return; }
    await api.post('/finance/credit-notes', { ...note, items: note.items.map((l) => ({ ...l, qty: Number(l.qty), retail: Number(l.retail), cost: Number(l.cost) })) });
    setNote(newCreditNote()); setPick(''); load();
  };
  const postNote = async (n) => { if (!window.confirm(`过账贷项凭单 ${n.creditNo}？会回补库存。`)) return; await api.post(`/finance/credit-notes/${n.id}/post`, {}); load(); };
  const delNote = async (n) => { if (!window.confirm(`删除 ${n.creditNo}？`)) return; await api.delete(`/finance/credit-notes/${n.id}`); load(); };

  return <>
    <div className="ops-grid two">
      <Panel title="Cash Movement" subtitle="Cash In · Withdraw · Payment / Pay Out · Received">
        <div className="ops-form">
          <label className="ops-field"><span>Movement Type</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="cash_in">Cash In</option><option value="withdraw">Withdraw</option><option value="payout">Payment / Pay Out</option><option value="received">Received Payment</option></select></label>
          <Input label="Amount" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
          <Input label="Pay To / A/C No." value={form.payTo} onChange={(v) => setForm({ ...form, payTo: v })} />
          <Input label="For / Remark" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
          <label className="ops-field"><span>Method</span><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option></select></label>
          <Action onClick={save}>Save Voucher</Action>
        </div>
        <div className="ops-table"><div className="ops-row ops-head"><span>Type</span><span>Voucher</span><span>Amount</span><span>Date</span></div>
          {rows.map((r) => <div className="ops-row" key={r.id}><span>{r.type}</span><span>{r.voucherNo}</span><span>¥{Number(r.amount).toFixed(2)}</span><span>{new Date(r.createdAt).toLocaleString()}</span></div>)}
          {!rows.length && <Empty />}
        </div>
      </Panel>
      <Panel title="Credit Note Records" subtitle="Draft / posted customer returns with GST">
        <div className="ops-table"><div className="ops-row ops-head"><span>Credit No.</span><span>Customer</span><span>Total</span><span>Status</span><span>Action</span></div>
          {notes.map((n) => <div className="ops-row" key={n.id}><span>{n.creditNo}</span><span>{n.customerName || '-'}</span><span>¥{Number(n.total).toFixed(2)}</span><span>{n.status}</span>
            <span className="ops-inline-actions">{n.status === 'open' && <button className="mini-action" onClick={() => postNote(n)}>Post</button>}<button className="mini-action danger" onClick={() => delNote(n)}>Delete</button></span>
          </div>)}
          {!notes.length && <Empty />}
        </div>
      </Panel>
    </div>

    <Panel title="New Credit Note" subtitle="CODE · BARCODE · DESCRIPTION · LOCATION · QTY · UOM · RETAIL · SUBTOTAL · GST · COST">
      <div className="ops-form inline">
        <Input label="Customer" value={note.customerName} onChange={(v) => setNote({ ...note, customerName: v })} />
        <Input label="Invoice / Order No." value={note.orderNo} onChange={(v) => setNote({ ...note, orderNo: v })} />
        <Input label="Reason" value={note.reason} onChange={(v) => setNote({ ...note, reason: v })} />
        <label className="ops-checkbox"><input type="checkbox" checked={note.includeGst} onChange={(e) => setNote({ ...note, includeGst: e.target.checked })} /> Include GST (F11)</label>
        <label className="ops-checkbox"><input type="checkbox" checked={note.restock} onChange={(e) => setNote({ ...note, restock: e.target.checked })} /> Restock on post</label>
      </div>
      <div className="ops-form inline">
        <label className="ops-field wide"><span>Add product line</span>
          <select value={pick} onChange={(e) => { setPick(e.target.value); const v = variants.find((x) => x.id === e.target.value); if (v) addLine(v); }}>
            <option value="">Select product…</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name} — ¥{Number(v.price).toFixed(2)}</option>)}
          </select>
        </label>
        <Action tone="secondary" onClick={() => addLine(null)}>+ Blank Line</Action>
      </div>
      <div className="ops-table cn-table">
        <div className="ops-row ops-head cols-9"><span>Code</span><span>Description</span><span>Location</span><span>Qty</span><span>UOM</span><span>Retail</span><span>Cost</span><span>Subtotal</span><span></span></div>
        {note.items.map((l, i) => <div className="ops-row cols-9" key={i}>
          <span><input className="mini-input" value={l.code} onChange={(e) => updLine(i, { code: e.target.value })} /></span>
          <span><input className="mini-input wide" value={l.description} onChange={(e) => updLine(i, { description: e.target.value })} /></span>
          <span><input className="mini-input" value={l.location} onChange={(e) => updLine(i, { location: e.target.value })} /></span>
          <span><input className="mini-input" type="number" value={l.qty} onChange={(e) => updLine(i, { qty: e.target.value })} /></span>
          <span><input className="mini-input" value={l.uom} onChange={(e) => updLine(i, { uom: e.target.value })} /></span>
          <span><input className="mini-input" type="number" value={l.retail} onChange={(e) => updLine(i, { retail: e.target.value })} /></span>
          <span><input className="mini-input" type="number" value={l.cost} onChange={(e) => updLine(i, { cost: e.target.value })} /></span>
          <span>¥{lineSub(l).toFixed(2)}</span>
          <span><button className="mini-action danger" onClick={() => delLine(i)}>×</button></span>
        </div>)}
        {!note.items.length && <Empty text="No line items yet" />}
      </div>
      <div className="cn-totals">
        <span>Subtotal <b>¥{cnSubtotal.toFixed(2)}</b></span>
        <span>GST {note.includeGst ? '(included)' : '—'}</span>
        <Action onClick={saveNote}>Save Credit Note</Action>
      </div>
    </Panel>
  </>;
}

function DayEndPanel() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const load = async () => {
    setData((await api.get(`/reports/day-end?date=${date}`)).data);
    setHistory((await api.get('/reports/day-end/history')).data);
  };
  useEffect(() => { load(); }, [date]);
  const closeDay = async () => {
    if (!data) return;
    if (data.status === 'closed') { alert('这一天已经日结了'); return; }
    if (!window.confirm(`确定对 ${date} 执行日结？\n系统应收现金 ¥${Number(data.cash.expected).toFixed(2)}，实点 ¥${Number(counted || 0).toFixed(2)}`)) return;
    await api.post('/reports/day-end/close', { date, countedCash: Number(counted || 0), note });
    setCounted(''); setNote(''); load();
  };
  const openSnapshot = async (h) => setSnapshot((await api.get(`/reports/day-end/${h.id}`)).data);
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const difference = data ? Number(counted || 0) - Number(data.cash.expected) : 0;

  return <Panel title="Day End / 日结" subtitle="当天销售、付款方式、现金对账、GST 汇总，日结后保存快照可重打">
    <div className="ops-form inline">
      <Input label="Business Date" type="date" value={date} onChange={setDate} />
      <Action tone="secondary" onClick={load}>Refresh</Action>
      <span className={`dayend-status ${data?.status === 'closed' ? 'closed' : 'open'}`}>{data?.status === 'closed' ? '已日结' : '未日结'}</span>
    </div>

    {data && <>
      <div className="shift-summary">
        <div><small>Net Sales</small><strong>{money(data.sales.net)}</strong></div>
        <div><small>Orders</small><strong>{data.sales.orders}</strong></div>
        <div><small>Discount</small><strong>{money(data.sales.discount)}</strong></div>
        <div><small>Service Charge</small><strong>{money(data.sales.serviceCharge)}</strong></div>
        <div><small>Void</small><strong>{data.sales.voids} · {money(data.sales.voidAmount)}</strong></div>
        <div><small>Refund</small><strong>{money(data.sales.refunded)}</strong></div>
        <div><small>Unsettle</small><strong>{money(data.sales.unsettled)}</strong></div>
        <div><small>Credit Notes</small><strong>{data.creditNotes.count} · {money(data.creditNotes.amount)}</strong></div>
      </div>

      <div className="ops-grid two">
        <div>
          <h3 className="dayend-sub">Payment Methods</h3>
          <div className="method-summary">
            {Object.keys(data.byMethod).length ? Object.entries(data.byMethod).map(([k, v]) => <span key={k}>{k}: {money(v)}</span>) : <span className="muted">No payments</span>}
          </div>
          <h3 className="dayend-sub">GST</h3>
          <div className="method-summary">
            <span>Rate: {data.gst.taxRate}% {data.gst.taxInclusive ? '(inclusive)' : '(exclusive)'}</span>
            <span>Output Tax: {money(data.gst.outputTax)}</span>
            <span>Refund Tax: {money(data.gst.refundTax)}</span>
            <span>Net Tax: {money(data.gst.netTax)}</span>
          </div>
        </div>
        <div>
          <h3 className="dayend-sub">Cash Reconciliation</h3>
          <div className="cash-recon">
            <div><span>Opening Float</span><b>{money(data.cash.opening)}</b></div>
            <div><span>Cash In</span><b>{money(data.cash.cashIn)}</b></div>
            <div><span>Sales (Cash)</span><b>{money(data.cash.salesCash)}</b></div>
            <div><span>Received</span><b>{money(data.cash.received)}</b></div>
            <div><span>Withdraw</span><b>-{money(data.cash.withdraw)}</b></div>
            <div><span>Payout</span><b>-{money(data.cash.payout)}</b></div>
            <div className="total"><span>Expected Cash</span><b>{money(data.cash.expected)}</b></div>
          </div>
          <div className="ops-form inline cash-count">
            <Input label="Amount Counted" type="number" value={counted} onChange={setCounted} />
            <Input label="Note" value={note} onChange={setNote} />
            <Action onClick={closeDay}>Close Day / 日结</Action>
          </div>
          {counted !== '' && <div className={`cash-diff ${difference === 0 ? 'ok' : difference > 0 ? 'over' : 'short'}`}>Difference: {money(difference)} {difference === 0 ? '(balanced)' : difference > 0 ? '(over)' : '(short)'}</div>}
        </div>
      </div>
    </>}

    <h3 className="dayend-sub">Day End History</h3>
    <div className="ops-table"><div className="ops-row ops-head"><span>Date</span><span>Expected</span><span>Counted</span><span>Difference</span><span>Closed</span><span>Action</span></div>
      {history.map((h) => <div className="ops-row" key={h.id}><span>{String(h.date).slice(0, 10)}</span><span>{money(h.expectedCash)}</span><span>{money(h.countedCash)}</span><span className={h.difference === 0 ? '' : 'variance-nonzero'}>{money(h.difference)}</span><span>{h.closedAt ? new Date(h.closedAt).toLocaleString() : '-'}</span><span><button className="mini-action" onClick={() => openSnapshot(h)}>View</button></span></div>)}
      {!history.length && <Empty text="No day-end closes yet" />}
    </div>

    {snapshot && <DayEndSnapshot snapshot={snapshot} onClose={() => setSnapshot(null)} />}
  </Panel>;
}

function DayEndSnapshot({ snapshot, onClose }) {
  const s = snapshot.snapshot || snapshot;
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  return <div className="legacy-window-wrap"><section className="legacy-window" style={{ width: 460 }}>
    <header><span>Day End · {String(snapshot.date).slice(0, 10)}</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      <div className="doc-preview">
        <h2>Day End Report</h2>
        <div className="receipt-sub">{String(snapshot.date).slice(0, 10)} · closed {snapshot.closedAt ? new Date(snapshot.closedAt).toLocaleString() : '-'}</div>
        <hr />
        <div className="flex justify-between"><span>Orders</span><span>{s.sales.orders}</span></div>
        <div className="flex justify-between"><span>Gross</span><span>{money(s.sales.gross)}</span></div>
        <div className="flex justify-between"><span>Discount</span><span>-{money(s.sales.discount)}</span></div>
        <div className="flex justify-between"><span>Service Charge</span><span>{money(s.sales.serviceCharge)}</span></div>
        <div className="flex justify-between"><span>GST</span><span>{money(s.sales.tax)}</span></div>
        <div className="flex justify-between font-bold"><span>Net Sales</span><span>{money(s.sales.net)}</span></div>
        <hr />
        {Object.entries(s.byMethod || {}).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><span>{money(v)}</span></div>)}
        <hr />
        <div className="flex justify-between"><span>Void ({s.sales.voids})</span><span>{money(s.sales.voidAmount)}</span></div>
        <div className="flex justify-between"><span>Refund</span><span>{money(s.sales.refunded)}</span></div>
        <hr />
        <div className="flex justify-between"><span>Expected Cash</span><span>{money(snapshot.expectedCash)}</span></div>
        <div className="flex justify-between"><span>Counted Cash</span><span>{money(snapshot.countedCash)}</span></div>
        <div className="flex justify-between font-bold"><span>Difference</span><span>{money(snapshot.difference)}</span></div>
        {snapshot.note && <div className="receipt-sub doc-footer">{snapshot.note}</div>}
      </div>
      <div className="legacy-window-actions"><button className="legacy-btn" onClick={() => window.print()}>Print</button><button className="legacy-btn pink" onClick={onClose}>Close</button></div>
    </div>
  </section></div>;
}

function AttendancePanel() {
  const [rows, setRows] = useState([]); const load = async () => setRows((await api.get('/attendance')).data); useEffect(() => { load(); }, []); const act = async (action) => { await api.post('/attendance', { action }); load(); };
  return <Panel title="Attendance" subtitle="Sign In · Sign Out · Early Morning Sign Out · Report"><div className="ops-actions"><Action onClick={() => act('sign_in')}>Sign In / Masuk</Action><Action tone="secondary" onClick={() => act('sign_out')}>Sign Out / Keluar</Action><Action tone="warning" onClick={() => act('early_morning')}>Early Morning</Action><Action tone="secondary" onClick={() => window.print()}>Print / Export</Action></div><div className="ops-table"><div className="ops-row ops-head"><span>Code</span><span>Name</span><span>Action</span><span>Time</span></div>{rows.map((r) => <div className="ops-row" key={r.id}><span>{r.code || '-'}</span><span>{r.userName}</span><span>{r.action}</span><span>{new Date(r.time).toLocaleString()}</span></div>)}{!rows.length && <Empty />}</div></Panel>;
}

function ShiftPanel() {
  const [data, setData] = useState(null); const [open, setOpen] = useState(''); const [close, setClose] = useState(''); const load = async () => setData((await api.get('/shifts/current')).data); useEffect(() => { load(); }, []);
  const openShift = async () => { await api.post('/shifts/open', { openAmount: Number(open || 0) }); setOpen(''); load(); }; const closeShift = async () => { if (!data?.shift) return; await api.post(`/shifts/${data.shift.id}/close`, { closeAmount: Number(close || 0) }); setClose(''); load(); };
  return <Panel title="Close Shift / Settlement" subtitle="Opening cash · Expected cash · Amount counted · Difference"><div className="shift-summary">{data && <><div><small>Expected</small><strong>¥{data.shift.expectedAmount.toFixed(2)}</strong></div><div><small>Current status</small><strong>{data.shift.status}</strong></div><div><small>Paid orders</small><strong>{data.paidOrders.length}</strong></div><div><small>Difference</small><strong>¥{data.shift.difference.toFixed(2)}</strong></div></>}</div><div className="ops-form inline"><Input label="Opening Amount" type="number" value={open} onChange={setOpen} /><Action tone="secondary" onClick={openShift}>Open Shift</Action><Input label="Amount Counted" type="number" value={close} onChange={setClose} /><Action onClick={closeShift}>Close / Settlement</Action></div>{data?.byMethod && <div className="method-summary">{Object.entries(data.byMethod).map(([k, v]) => <span key={k}>{k}: ¥{Number(v).toFixed(2)}</span>)}</div>}</Panel>;
}

function SupplierPanel() {
  const [rows, setRows] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', contactPerson: '', address: '' });
  const load = async () => setRows((await api.get('/suppliers')).data);
  useEffect(() => { load(); }, []);
  const add = async () => { if (!f.name) return; await api.post('/suppliers', f); setF({ name: '', phone: '', contactPerson: '', address: '' }); setShowForm(false); load(); };
  const toggle = async (id) => { await api.put(`/suppliers/${id}/status`); load(); };
  const del = async (id) => { if (!window.confirm('删除此供应商?')) return; await api.delete(`/suppliers/${id}`); load(); };
  return <Panel title="Suppliers" subtitle="Supplier master file for Smcin back-office"><div className="ops-actions" style={{ marginBottom: '10px' }}><Action onClick={() => setShowForm((s) => !s)}>{showForm ? 'Hide Form' : '+ New Supplier'}</Action></div>{showForm && <div className="ops-form inline" style={{ flexWrap: 'wrap' }}><Input label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} /><Input label="Phone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /><Input label="Contact" value={f.contactPerson} onChange={(v) => setF({ ...f, contactPerson: v })} /><Input label="Address" value={f.address} onChange={(v) => setF({ ...f, address: v })} /><Action onClick={add}>Create</Action></div>}<div className="ops-table tall"><div className="ops-row ops-head cols-6"><span>Code</span><span>Name</span><span>Phone</span><span>Contact</span><span>Status</span><span>Action</span></div>{rows.map((r) => <div className="ops-row cols-6" key={r.id}><span>{r.code || '-'}</span><span>{r.name}</span><span>{r.phone || '-'}</span><span>{r.contactPerson || '-'}</span><span>{r.status}</span><span className="ops-inline-actions"><button className="mini-action" onClick={() => toggle(r.id)}>{r.status === 'active' ? 'Deactivate' : 'Activate'}</button><button className="mini-action danger" onClick={() => del(r.id)}>Delete</button></span></div>)}{!rows.length && <Empty />}</div></Panel>;
}

function PurchasePanel() {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [supId, setSupId] = useState('');
  const [lines, setLines] = useState([{ itemId: '', qty: '', unitCost: '' }]);
  const [grns, setGrns] = useState([]);
  const load = async () => { setRows((await api.get('/purchases')).data); setSuppliers((await api.get('/suppliers')).data); setItems((await api.get('/inventory/items')).data); setGrns((await api.get('/goods-receipts')).data); };
  useEffect(() => { load(); }, []);
  const setL = (i, k, v) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const add = async () => {
    const clean = lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitCost: Number(l.unitCost || 0) }));
    if (!supId || !clean.length) return;
    await api.post('/purchases', { supplierId: supId, lines: clean });
    setSupId(''); setLines([{ itemId: '', qty: '', unitCost: '' }]); setShowForm(false); load();
  };
  const approve = async (id) => { await api.post(`/purchases/${id}/approve`); load(); };
  const cancel = async (id) => { const reason = window.prompt('Cancel reason?'); if (reason == null) return; await api.post(`/purchases/${id}/cancel`, { reason }); load(); };
  const del = async (id) => { if (!window.confirm('Delete this PO?')) return; await api.delete(`/purchases/${id}`); load(); };
  const receive = async (id) => {
    const po = rows.find((r) => r.id === id);
    if (!po || !po.lines) return;
    const plan = po.lines.filter((l) => l.outstandingQty > 0).map((l) => ({ poLineId: l.id, qty: Number(window.prompt(`Receive for ${l.itemName || l.itemCode || 'item'}\nOutstanding: ${l.outstandingQty}\nEnter qty to receive:`, String(l.outstandingQty)) || 0) }));
    if (!plan.some((p) => p.qty > 0)) return;
    await api.post(`/purchases/${id}/receive`, { lines: plan.filter((p) => p.qty > 0) });
    load();
  };
  return <Panel title="Purchase Order / GRN" subtitle="Create PO · Approve · Receive · Cancel"><div className="ops-actions" style={{ marginBottom: '10px' }}><Action onClick={() => setShowForm((s) => !s)}>{showForm ? 'Hide Form' : '+ New PO'}</Action></div>{showForm && <div style={{ marginBottom: '14px' }}><label className="ops-field"><span>Supplier</span><select value={supId} onChange={(e) => setSupId(e.target.value)}><option value="">-- choose --</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>{lines.map((l, i) => (<div key={i} className="ops-form inline" style={{ gap: '8px' }}><label className="ops-field" style={{ flex: 1 }}><span>Item</span><select value={l.itemId} onChange={(e) => setL(i, 'itemId', e.target.value)}><option value="">-- choose --</option>{items.map((it) => <option key={it.id} value={it.id}>{it.code || it.name} ({it.location || '-'})</option>)}</select></label><Input label="Qty" type="number" step="0.001" value={l.qty} onChange={(v) => setL(i, 'qty', v)} /><Input label="Unit Cost" type="number" step="0.01" value={l.unitCost} onChange={(v) => setL(i, 'unitCost', v)} />{lines.length > 1 && <button className="mini-action danger" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>−</button>}</div>))}</div><div className="ops-actions"><Action tone="secondary" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '', unitCost: '' }])}>+ Line</Action><Action onClick={add}>Create PO</Action></div></div>}<div className="ops-table tall"><div className="ops-row ops-head cols-7"><span>PO No.</span><span>Supplier</span><span>Lines</span><span>Total</span><span>Status</span><span>Created</span><span>Action</span></div>{rows.map((r) => <div className="ops-row cols-7" key={r.id}><span>{r.poNo}</span><span>{r.supplierName || r.supplierId || '-'}</span><span>{(r.lines || []).length}</span><span>¥{Number(r.total || 0).toFixed(2)}</span><span>{r.status}</span><span>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB') : '-'}</span><span className="ops-inline-actions">{r.status === 'draft' && <><button className="mini-action" onClick={() => approve(r.id)}>Approve</button><button className="mini-action" onClick={() => cancel(r.id)}>Cancel</button><button className="mini-action danger" onClick={() => del(r.id)}>Delete</button></>}{(r.status === 'approved' || r.status === 'partial') && <button className="mini-action" onClick={() => receive(r.id)}>Receive</button>}</span></div>)}{!rows.length && <Empty />}</div><div style={{ marginTop: '18px' }}><Panel title="Goods Receipts (GRN)" subtitle="Received records · Click to void"><div className="ops-table"><div className="ops-row ops-head cols-6"><span>GRN No.</span><span>PO No.</span><span>Supplier</span><span>Total</span><span>Status</span><span>Action</span></div>{grns.map((g) => <div className="ops-row cols-6" key={g.id}><span>{g.grnNo}</span><span>{g.poNo || '-'}</span><span>{g.supplierName || '-'}</span><span>¥{Number(g.total || 0).toFixed(2)}</span><span>{g.status}</span><span className="ops-inline-actions">{g.status !== 'void' && <button className="mini-action danger" onClick={async () => { const reason = window.prompt('Void reason?'); if (reason == null) return; await api.post(`/goods-receipts/${g.id}/void`, { reason }); load(); }}>Void</button>}</span></div>)}{!grns.length && <Empty text="No GRNs yet" />}</div></Panel></div></Panel>;
}

function VoidPanel() {
  const [rows, setRows] = useState([]);
  const load = async () => { const r = await api.get('/orders?status=void_pending'); setRows(r.data); };
  useEffect(() => { load(); }, []);
  const approve = async (o) => { if (!window.confirm(`批准取消 ${o.orderNo}?`)) return; await api.post(`/orders/${o._id}/void/approve`, {}); load(); };
  const reject = async (o) => { const reason = prompt('拒绝原因:', 'supervisor rejected'); if (reason == null) return; await api.post(`/orders/${o._id}/void/reject`, { reason }); load(); };
  return <Panel title="Void Approval" subtitle="Cancellation requests awaiting supervisor approval"><div className="ops-table"><div className="ops-row ops-head"><span>Order</span><span>Amount</span><span>Reason</span><span>Action</span></div>{rows.map((o) => <div className="ops-row" key={o._id}><span>{o.orderNo}</span><span>¥{Number(o.total).toFixed(2)}</span><span>{o.voidReason || '-'}</span><span className="ops-inline-actions"><button className="mini-action" onClick={() => approve(o)}>Approve</button><button className="mini-action danger" onClick={() => reject(o)}>Reject</button></span></div>)}{!rows.length && <Empty text="No pending void requests" />}</div></Panel>;
}

function RefundPanel() {
  const [rows, setRows] = useState([]);
  const load = async () => setRows((await api.get('/refunds')).data);
  useEffect(() => { load(); }, []);
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return <Panel title="Refund Records" subtitle="Partial / full refunds with stock restoration"><div className="report-kpis"><span>Refunds <b>{rows.length}</b></span><span>Total Refunded <b>¥{total.toFixed(2)}</b></span></div><div className="ops-table"><div className="ops-row ops-head"><span>Refund No.</span><span>Order</span><span>Amount</span><span>Method</span><span>Reason</span><span>Restock</span><span>Date</span></div>{rows.map((r) => <div className="ops-row" key={r._id}><span>{r.refundNo}</span><span>{r.orderNo}</span><span>¥{Number(r.amount).toFixed(2)}</span><span>{r.method}</span><span>{r.reason}</span><span>{r.restock ? 'Yes' : 'No'}</span><span>{new Date(r.createdAt).toLocaleString()}</span></div>)}{!rows.length && <Empty text="No refunds yet" />}</div></Panel>;
}

function ReprintPanel() {
  const [type, setType] = useState('bill');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [data, setData] = useState(null);
  const [doc, setDoc] = useState(null);
  const [kind, setKind] = useState('bill');
  const [current, setCurrent] = useState(null);
  const isOrderType = ['bill', 'receipt', 'order'].includes(type);

  const run = async () => {
    const qs = new URLSearchParams({ type });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (orderNo) qs.set('orderNo', orderNo);
    setData((await api.get(`/reports/reprint?${qs.toString()}`)).data);
  };
  const openDoc = async (row, k = 'bill') => { setCurrent(row); setKind(k); setDoc((await api.get(`/orders/${row.id}/document?kind=${k}`)).data); };
  const changeKind = async (k) => { setKind(k); if (current) setDoc((await api.get(`/orders/${current.id}/document?kind=${k}`)).data); };
  const reprint = async () => {
    if (!current) return;
    const r = await api.post(`/orders/${current.id}/reprint`, { kind });
    setDoc(r.data.document);
    run();
  };
  const unsettle = async (row) => {
    if (!window.confirm(`反结算 ${row.orderNo}？\n会回补库存、作废付款记录与发票，订单退回未结算。`)) return;
    await api.post(`/orders/${row.id}/unsettle`, { reason: 'back-office unsettle' });
    run();
  };
  const columns = data?.rows?.length ? Object.keys(data.rows[0]).filter((c) => c !== 'kind') : [];
  const colClass = `cols-${Math.min(columns.length + (isOrderType ? 1 : 0), 9)}`;

  return <Panel title="Reprint / Unsettle" subtitle="按日期、单号检索历史单据，重看/重打，或把已结算单反结算">
    <div className="ops-form inline">
      <label className="ops-field"><span>Document Type</span><select value={type} onChange={(e) => { setType(e.target.value); setData(null); }}>{REPRINT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <Input label="From" type="date" value={from} onChange={setFrom} />
      <Input label="To" type="date" value={to} onChange={setTo} />
      {isOrderType && <Input label="Order No." value={orderNo} onChange={setOrderNo} placeholder="T20261002" />}
      <Action onClick={run}>Search</Action>
    </div>
    {data && <>
      <div className="report-kpis"><span>Found <b>{data.count}</b></span><span>Type <b>{data.type}</b></span></div>
      <div className="ops-table tall">
        <div className={`ops-row ops-head ${colClass}`}>{columns.map((c) => <span key={c}>{c}</span>)}{isOrderType && <span>Action</span>}</div>
        {data.rows.map((row, i) => <div className={`ops-row ${colClass}`} key={i}>
          {columns.map((c) => <span key={c}>{typeof row[c] === 'number' ? Number(row[c]).toFixed(2) : String(row[c] ?? '-')}</span>)}
          {isOrderType && <span className="ops-inline-actions">
            <button className="mini-action" onClick={() => openDoc(row)}>View</button>
            <button className="mini-action" onClick={() => { setCurrent(row); setKind('receipt'); reprint(); }}>Reprint</button>
            {(row.status === 'paid' || row.status === 'refunded') && <button className="mini-action danger" onClick={() => unsettle(row)}>Unsettle</button>}
          </span>}
        </div>)}
        {!data.rows.length && <Empty text="No documents found" />}
      </div>
    </>}
    {doc && <DocumentModal doc={doc} kind={kind} onKind={changeKind} onReprint={reprint} onClose={() => { setDoc(null); setCurrent(null); }} />}
  </Panel>;
}

function DocumentModal({ doc, kind, onKind, onReprint, onClose }) {
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const isKitchen = doc.kind === 'kitchen' || doc.kind === 'bar';
  return <div className="legacy-window-wrap"><section className="legacy-window" style={{ width: 430 }}>
    <header><span>{doc.title} · {doc.orderNo}</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      <div className="split-mode-tabs">{DOC_KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'active' : ''} onClick={() => onKind(k)}>{l}</button>)}</div>
      <div className="doc-preview">
        <h2>{doc.header.name}</h2>
        {doc.header.address && <div className="receipt-sub">{doc.header.address}</div>}
        {doc.header.gstNo && <div className="receipt-sub">GST: {doc.header.gstNo}</div>}
        <div className="receipt-sub">{doc.title} · {doc.orderNo}{doc.invoiceNo ? ` · ${doc.invoiceNo}` : ''}</div>
        <div className="receipt-sub">{new Date(doc.date).toLocaleString()}{doc.table ? ` · Table ${doc.table}` : ''}{doc.cashier ? ` · ${doc.cashier}` : ''}</div>
        <hr />
        {doc.items.map((i, idx) => <div key={idx} className="flex justify-between"><span>{i.qty}x {i.name}</span>{!isKitchen && <span>{money(i.unitPrice * i.qty)}</span>}</div>)}
        {!isKitchen && <>
          <hr />
          {doc.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{money(doc.discount)}</span></div>}
          {doc.serviceCharge > 0 && <div className="flex justify-between"><span>Service Charge</span><span>{money(doc.serviceCharge)}</span></div>}
          <div className="flex justify-between"><span>Subtotal</span><span>{money(doc.subtotal)}</span></div>
          <div className="flex justify-between"><span>GST {doc.taxRate}%</span><span>{money(doc.tax)}</span></div>
          <div className="flex justify-between font-bold"><span>Total</span><span>{money(doc.total)}</span></div>
          {(doc.payments || []).map((p, i) => <div key={i} className="flex justify-between"><span>{p.method}</span><span>{money(p.amount)}</span></div>)}
          {doc.refundedAmount > 0 && <div className="flex justify-between"><span>Refunded</span><span>-{money(doc.refundedAmount)}</span></div>}
          {doc.footer && <div className="receipt-sub doc-footer">{doc.footer}</div>}
        </>}
        {doc.reprintCount > 0 && <div className="receipt-sub">Reprinted {doc.reprintCount} time(s)</div>}
      </div>
      <div className="legacy-window-actions"><button className="legacy-btn green" onClick={onReprint}>Reprint</button><button className="legacy-btn" onClick={() => window.print()}>Print</button><button className="legacy-btn pink" onClick={onClose}>Close</button></div>
    </div>
  </section></div>;
}

// ---------------------------------------------------------------- 报表中心
// 报表元数据由后端 /reports/catalog 提供,前端不再硬编码;支持日期区间、
// 三种导出(CSV / Excel / 打印页)与报表设计器(保存/加载模板)。
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const datePresets = () => {
  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const y = new Date(today); y.setDate(y.getDate() - 1);
  const d7 = new Date(today); d7.setDate(d7.getDate() - 6);
  const d30 = new Date(today); d30.setDate(d30.getDate() - 29);
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lmEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const lmStart = new Date(lmEnd.getFullYear(), lmEnd.getMonth(), 1);
  return [
    ['Today', iso(today), iso(today)],
    ['Yesterday', iso(y), iso(y)],
    ['Last 7 days', iso(d7), iso(today)],
    ['Last 30 days', iso(d30), iso(today)],
    ['This month', iso(mStart), iso(today)],
    ['Last month', iso(lmStart), iso(lmEnd)],
    ['All time', '', ''],
  ];
};

function exportUrl(type, format, from, to) {
  const qs = new URLSearchParams({ type, format });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const t = localStorage.getItem('token');
  if (t) qs.set('token', t);
  return `${API_BASE}/reports/export?${qs.toString()}`;
}

function ReportPanel() {
  const [catalog, setCatalog] = useState({ categories: [], reports: [] });
  const [type, setType] = useState('sales_by_date');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplName, setTplName] = useState('');

  const loadTemplates = async () => setTemplates((await api.get('/report-templates')).data);
  useEffect(() => {
    api.get('/reports/catalog').then((r) => setCatalog(r.data));
    loadTemplates();
  }, []);

  const meta = catalog.reports.find((r) => r.key === type);
  const columns = meta?.columns?.map(([key, label, kind]) => ({ key, label, kind })) || [];

  const run = async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ type });
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      setReport((await api.get(`/reports/query?${qs.toString()}`)).data);
    } finally { setBusy(false); }
  };
  useEffect(() => { if (catalog.reports.length) run(); /* eslint-disable-next-line */ }, [type, catalog.reports.length]);

  const openExport = (format) => {
    const url = exportUrl(type, format, from, to);
    if (format === 'html') window.open(url, '_blank');
    else window.location.href = url; // 触发浏览器下载
  };
  const applyPreset = (f, t) => { setFrom(f); setTo(t); };
  const saveTemplate = async () => {
    if (!tplName.trim()) { alert('请填写模板名称'); return; }
    await api.post('/report-templates', { name: tplName.trim(), type, filters: { from, to }, format: 'xlsx' });
    setTplName(''); loadTemplates();
  };
  const loadTemplate = (t) => { setType(t.type); setFrom(t.filters?.from || ''); setTo(t.filters?.to || ''); };
  const delTemplate = async (t) => { if (!window.confirm(`删除模板「${t.name}」?`)) return; await api.delete(`/report-templates/${t.id}`); loadTemplates(); };

  const fmtCell = (v, kind) => {
    if (v == null || v === '') return '-';
    if (kind === 'money') return `¥${Number(v).toFixed(2)}`;
    // qty / int 归一化成普通数字,避免 12.500000000000002 这类浮点尾巴
    if (kind === 'qty' || kind === 'int') return String(Number(v));
    if (kind === 'date') { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB', { hour12: false }); }
    return String(v);
  };
  const colCount = Math.min(columns.length, 9);

  return <>
    <Panel title="Reports" subtitle={`${catalog.reports.length} 报表模板 · 日期区间 · CSV / Excel / 打印导出`}>
      <div className="ops-form inline">
        <label className="ops-field wide"><span>Report</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {catalog.categories.map((c) => (
              <optgroup key={c.key} label={c.label}>
                {catalog.reports.filter((r) => r.category === c.key).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <Input label="From" type="date" value={from} onChange={setFrom} />
        <Input label="To" type="date" value={to} onChange={setTo} />
        <Action onClick={run}>Run Report</Action>
      </div>
      <div className="report-presets">
        {datePresets().map(([label, f, t]) => (
          <button key={label} className={from === f && to === t ? 'active' : ''} onClick={() => applyPreset(f, t)}>{label}</button>
        ))}
      </div>
      <div className="ops-actions">
        <Action tone="secondary" onClick={() => openExport('csv')}>Export CSV</Action>
        <Action tone="secondary" onClick={() => openExport('xlsx')}>Export Excel</Action>
        <Action tone="secondary" onClick={() => openExport('html')}>Print / PDF</Action>
      </div>

      {meta?.desc && <div className="report-desc">{meta.desc}</div>}

      {report && <div className="report-result">
        <div className="report-kpis">
          <span>Rows <b>{report.count}</b></span>
          <span>Total <b>¥{Number(report.total).toFixed(2)}</b></span>
          <span>Period <b>{from || to ? `${from || '…'} → ${to || '…'}` : 'All dates'}</b></span>
        </div>
        <div className="ops-table tall">
          <div className={`ops-row ops-head cols-${colCount}`}>{columns.map((c) => <span key={c.key}>{c.label}</span>)}</div>
          {report.rows.map((row, i) => (
            <div className={`ops-row cols-${colCount}`} key={i}>
              {columns.map((c) => <span key={c.key}>{fmtCell(row[c.key], c.kind)}</span>)}
            </div>
          ))}
          {!report.rows.length && <Empty text="No data for this report" />}
        </div>
      </div>}
    </Panel>

    <Panel title="Report Designer" subtitle="把当前报表类型 + 日期区间 + 导出格式存成模板,下次一键复用">
      <div className="ops-form inline">
        <Input label="Template Name" value={tplName} onChange={setTplName} placeholder="Daily Sales Snapshot" />
        <Action onClick={saveTemplate}>Save Template</Action>
      </div>
      <div className="ops-table">
        <div className="ops-row ops-head cols-5"><span>Name</span><span>Report</span><span>Period</span><span>Format</span><span>Action</span></div>
        {templates.map((t) => <div className="ops-row cols-5" key={t.id}>
          <span>{t.name}</span>
          <span>{catalog.reports.find((r) => r.key === t.type)?.label || t.type}</span>
          <span>{t.filters?.from || t.filters?.to ? `${t.filters.from || '…'} → ${t.filters.to || '…'}` : 'All dates'}</span>
          <span>{t.format || 'csv'}</span>
          <span className="ops-inline-actions">
            <button className="mini-action" onClick={() => loadTemplate(t)}>Load</button>
            {!t.isSystem && <button className="mini-action danger" onClick={() => delTemplate(t)}>Delete</button>}
          </span>
        </div>)}
        {!templates.length && <Empty text="No saved templates yet" />}
      </div>
    </Panel>
  </>;
}
