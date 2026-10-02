import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';

const TABS = [
  ['members', 'Members'], ['finance', 'Cash / Vouchers'], ['voids', 'Void Approval'], ['refunds', 'Refunds'],
  ['reprint', 'Reprint / Unsettle'], ['attendance', 'Attendance'], ['shifts', 'Close Shift'], ['suppliers', 'Suppliers'],
  ['purchases', 'Purchase / GRN'], ['reports', 'Reports'],
];

const REPRINT_TYPES = [
  ['bill', 'Bill / Tax Invoice'], ['receipt', 'Receipt'], ['order', 'Order Slip'],
  ['payout', 'Payout / Withdraw'], ['closeshift', 'Close Shift'], ['dayend', 'Day End'],
];

const DOC_KINDS = [['bill', 'Bill'], ['receipt', 'Receipt'], ['order', 'Order Slip'], ['kitchen', 'Kitchen'], ['bar', 'Bar']];

const REPORT_TYPES = [
  ['sales_by_date', 'Sales By Date'], ['sales_by_product', 'Sales By Product'], ['sales_by_payment', 'Sales By Payment Type'],
  ['sales_by_hour', 'Sales By Hour'], ['sales_by_cashier', 'Sales By Cashier'], ['sales_by_table', 'Sales By Table'],
  ['sales_by_department', 'Sales By Department'], ['top_products', 'Top Products'],
  ['void_report', 'Void / Cancellation'], ['refund_report', 'Refund Report'], ['discount_report', 'Discount Report'],
  ['stock_report', 'Stock Report'], ['customer_stock', 'Customer Stock'], ['member_points', 'Member Points'],
  ['knock_off', 'Knock Off'], ['cash_bill', 'Cash Bill'], ['payout', 'Payout / Withdraw'],
  ['credit_note', 'Credit Note'], ['close_shift', 'Close Shift'], ['gst_summary', 'GST Summary'],
];

export default function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'members';
  const active = TABS.some(([key]) => key === tab) ? tab : 'members';
  return <div className="operations-page"><div className="operations-heading"><div><div className="modern-eyebrow">SMPOS / BACK OFFICE</div><h1>Operations Center</h1><p>会员、财务、取消审批、退款、班结、采购和报表</p></div><div className="operations-date">{new Date().toLocaleDateString('en-GB')}</div></div><div className="operations-tabs">{TABS.map(([key, label]) => <button key={key} className={active === key ? 'active' : ''} onClick={() => setParams({ tab: key })}>{label}</button>)}</div><div className="operations-content">{active === 'members' && <MembersPanel />} {active === 'finance' && <FinancePanel />} {active === 'voids' && <VoidPanel />} {active === 'refunds' && <RefundPanel />} {active === 'reprint' && <ReprintPanel />} {active === 'attendance' && <AttendancePanel />} {active === 'shifts' && <ShiftPanel />} {active === 'suppliers' && <SupplierPanel />} {active === 'purchases' && <PurchasePanel />} {active === 'reports' && <ReportPanel />}</div></div>;
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

function FinancePanel() {
  const [rows, setRows] = useState([]); const [form, setForm] = useState({ type: 'cash_in', amount: '', payTo: '', reason: '', method: 'cash' }); const [note, setNote] = useState({ customerName: '', orderNo: '', reason: '' });
  const load = async () => setRows((await api.get('/finance/movements')).data); useEffect(() => { load(); }, []);
  const save = async () => { if (!form.amount) return; await api.post('/finance/movements', { ...form, amount: Number(form.amount) }); setForm({ ...form, amount: '', payTo: '', reason: '' }); load(); };
  const saveNote = async () => { await api.post('/finance/credit-notes', note); setNote({ customerName: '', orderNo: '', reason: '' }); alert('Credit Note saved'); };
  return <div className="ops-grid two"><Panel title="Cash Movement" subtitle="Cash In · Withdraw · Payment / Pay Out · Received"><div className="ops-form"><label className="ops-field"><span>Movement Type</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="cash_in">Cash In</option><option value="withdraw">Withdraw</option><option value="payout">Payment / Pay Out</option><option value="received">Received Payment</option></select></label><Input label="Amount" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /><Input label="Pay To / A/C No." value={form.payTo} onChange={(v) => setForm({ ...form, payTo: v })} /><Input label="For / Remark" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} /><label className="ops-field"><span>Method</span><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option></select></label><Action onClick={save}>Save Voucher</Action></div><div className="ops-table"><div className="ops-row ops-head"><span>Type</span><span>Voucher</span><span>Amount</span><span>Date</span></div>{rows.map((r) => <div className="ops-row" key={r.id}><span>{r.type}</span><span>{r.voucherNo}</span><span>¥{r.amount.toFixed(2)}</span><span>{new Date(r.createdAt).toLocaleString()}</span></div>)}{!rows.length && <Empty />}</div></Panel><Panel title="Credit Note" subtitle="Customer return / GST credit note"><div className="ops-form"><Input label="Customer" value={note.customerName} onChange={(v) => setNote({ ...note, customerName: v })} /><Input label="Invoice / Order No." value={note.orderNo} onChange={(v) => setNote({ ...note, orderNo: v })} /><Input label="Reason" value={note.reason} onChange={(v) => setNote({ ...note, reason: v })} /><Action tone="secondary" onClick={saveNote}>Create Credit Note</Action></div></Panel></div>;
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
  const [rows, setRows] = useState([]); const [name, setName] = useState(''); const load = async () => setRows((await api.get('/suppliers')).data); useEffect(() => { load(); }, []); const add = async () => { if (!name) return; await api.post('/suppliers', { name }); setName(''); load(); };
  return <Panel title="Suppliers" subtitle="Supplier master file for Smcin back-office"><div className="ops-form inline"><Input label="Supplier Name" value={name} onChange={setName} /><Action onClick={add}>Add Supplier</Action></div><div className="ops-table"><div className="ops-row ops-head"><span>Code</span><span>Name</span><span>Phone</span><span>Status</span></div>{rows.map((r) => <div className="ops-row" key={r.id}><span>{r.code}</span><span>{r.name}</span><span>{r.phone || '-'}</span><span>{r.status}</span></div>)}</div></Panel>;
}

function PurchasePanel() {
  const [rows, setRows] = useState([]); const [form, setForm] = useState({ supplierId: '', itemId: '', qty: '', total: '' }); const load = async () => setRows((await api.get('/purchases')).data); useEffect(() => { load(); }, []); const add = async () => { await api.post('/purchases', { supplierId: form.supplierId, total: Number(form.total || 0), items: [{ itemId: form.itemId, qty: Number(form.qty || 0) }] }); setForm({ supplierId: '', itemId: '', qty: '', total: '' }); load(); };
  return <Panel title="Purchase Order / GRN" subtitle="Create purchase order and receive goods into inventory"><div className="ops-form"><Input label="Supplier ID" value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} /><Input label="Inventory Item ID" value={form.itemId} onChange={(v) => setForm({ ...form, itemId: v })} /><Input label="Quantity" type="number" value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /><Input label="Total" type="number" value={form.total} onChange={(v) => setForm({ ...form, total: v })} /><Action onClick={add}>Create PO</Action></div><div className="ops-table"><div className="ops-row ops-head"><span>PO No.</span><span>Supplier</span><span>Total</span><span>Status</span></div>{rows.map((r) => <div className="ops-row" key={r.id}><span>{r.poNo}</span><span>{r.supplierId || '-'}</span><span>¥{r.total.toFixed(2)}</span><span>{r.status} {r.status === 'open' && <button className="mini-action" onClick={async () => { await api.post(`/purchases/${r.id}/receive`); load(); }}>Receive GRN</button>}</span></div>)}{!rows.length && <Empty />}</div></Panel>;
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

function ReportPanel() {
  const [type, setType] = useState('sales_by_date'); const [report, setReport] = useState(null); const run = async () => setReport((await api.get(`/reports/query?type=${type}`)).data); const columns = report?.rows?.length ? Object.keys(report.rows[0]) : [];
  return <Panel title="Reports" subtitle="20+ report templates · Sales · Void · Refund · Stock · GST"><div className="ops-form inline"><label className="ops-field"><span>Report Type</span><select value={type} onChange={(e) => setType(e.target.value)}>{REPORT_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label><Action onClick={run}>Run Report</Action><Action tone="secondary" onClick={() => window.print()}>Print</Action></div>{report && <div className="report-result"><div className="report-kpis"><span>Total <b>¥{Number(report.total).toFixed(2)}</b></span><span>Rows <b>{report.count}</b></span></div><div className="ops-table"><div className="ops-row ops-head">{columns.map((c) => <span key={c}>{c}</span>)}</div>{report.rows.map((row, i) => <div className="ops-row" key={i}>{columns.map((c) => <span key={c}>{typeof row[c] === 'number' ? Number(row[c]).toFixed(2) : String(row[c] ?? '-')}</span>)}</div>)}{!report.rows.length && <Empty text="No data for this report" />}</div></div>}</Panel>;
}
