import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';

const TABS = [
  ['promotions', 'Promotion'], ['vouchers', 'Gift Voucher'], ['rebates', 'Member Rebate'],
  ['customer-stock', 'Customer Stock'], ['stock-take', 'Periodical Stock'],
  ['barcode', 'Barcode'], ['gst', 'GST / Store Setup'], ['printers', 'Printers'], ['designer', 'Report Designer'],
];

export default function BackOfficePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'promotions';
  const active = TABS.some(([key]) => key === tab) ? tab : 'promotions';
  return (
    <div className="operations-page">
      <div className="operations-heading">
        <div><div className="modern-eyebrow">SMCIN / MASTER DATA</div><h1>Back Office</h1><p>促销、客户库存、定期盘点、条码、GST 设置、硬件与报表设计</p></div>
        <div className="operations-date">{new Date().toLocaleDateString('en-GB')}</div>
      </div>
      <div className="operations-tabs">{TABS.map(([key, label]) => <button key={key} className={active === key ? 'active' : ''} onClick={() => setParams({ tab: key })}>{label}</button>)}</div>
      <div className="operations-content">
        {active === 'promotions' && <PromotionPanel />}
        {active === 'vouchers' && <VoucherPanel />}
        {active === 'rebates' && <RebatePanel />}
        {active === 'customer-stock' && <CustomerStockPanel />}
        {active === 'stock-take' && <StockTakePanel />}
        {active === 'barcode' && <BarcodePanel />}
        {active === 'gst' && <GstPanel />}
        {active === 'printers' && <PrinterPanel />}
        {active === 'designer' && <DesignerPanel />}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }) { return <section className="ops-panel"><div className="ops-panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>; }
function Input({ label, value, onChange, type = 'text', placeholder = '' }) { return <label className="ops-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>; }
function Action({ children, onClick, tone = 'primary' }) { return <button className={`ops-action ${tone}`} onClick={onClick}>{children}</button>; }
function Empty({ text = 'No records yet' }) { return <div className="ops-empty">{text}</div>; }

function PromotionPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', type: 'percent', value: '', minSpend: '' });
  const load = async () => setRows((await api.get('/promotions')).data);
  useEffect(() => { load(); }, []);
  const add = async () => { if (!form.code || !form.name) return; await api.post('/promotions', { ...form, value: Number(form.value || 0), minSpend: Number(form.minSpend || 0) }); setForm({ code: '', name: '', type: 'percent', value: '', minSpend: '' }); load(); };
  const toggle = async (p) => { await api.put(`/promotions/${p.id}`, { isActive: !p.isActive }); load(); };
  const remove = async (p) => { if (!window.confirm(`删除促销 ${p.code}?`)) return; await api.delete(`/promotions/${p.id}`); load(); };
  return <Panel title="Promotion" subtitle="Percent / Amount discount with promo code and minimum spend">
    <div className="ops-form inline">
      <Input label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="HAPPY10" />
      <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      <label className="ops-field"><span>Type</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="percent">Percent %</option><option value="amount">Amount ¥</option></select></label>
      <Input label="Value" type="number" value={form.value} onChange={(v) => setForm({ ...form, value: v })} />
      <Input label="Min Spend" type="number" value={form.minSpend} onChange={(v) => setForm({ ...form, minSpend: v })} />
      <Action onClick={add}>Add Promotion</Action>
    </div>
    <div className="ops-table"><div className="ops-row ops-head"><span>Code</span><span>Name</span><span>Type</span><span>Value</span><span>Min Spend</span><span>Status</span><span>Action</span></div>
      {rows.map((p) => <div className="ops-row" key={p.id}><span>{p.code}</span><span>{p.name}</span><span>{p.type}</span><span>{p.type === 'percent' ? `${p.value}%` : `¥${p.value}`}</span><span>¥{p.minSpend}</span><span>{p.isActive ? 'Active' : 'Inactive'}</span><span className="ops-inline-actions"><button className="mini-action" onClick={() => toggle(p)}>{p.isActive ? 'Disable' : 'Enable'}</button><button className="mini-action danger" onClick={() => remove(p)}>Delete</button></span></div>)}
      {!rows.length && <Empty />}
    </div>
  </Panel>;
}

function VoucherPanel() {
  const [rows, setRows] = useState([]); const [members, setMembers] = useState([]);
  const [summary, setSummary] = useState(null); const [status, setStatus] = useState('all'); const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ code: '', faceValue: '', soldAmount: '', issuedToMemberId: '', issuedToName: '', issuedToPhone: '', expiresAt: '', note: '' });
  const load = async () => {
    const qs = new URLSearchParams(); if (status !== 'all') qs.set('status', status); if (q) qs.set('q', q);
    setRows((await api.get(`/vouchers?${qs}`)).data);
    setSummary((await api.get('/vouchers/summary')).data);
    setMembers((await api.get('/members')).data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const reset = () => setForm({ code: '', faceValue: '', soldAmount: '', issuedToMemberId: '', issuedToName: '', issuedToPhone: '', expiresAt: '', note: '' });
  const issue = async () => {
    const face = Number(form.faceValue || 0);
    if (!(face > 0)) { alert('面值必须大于 0'); return; }
    try {
      await api.post('/vouchers', {
        code: form.code.trim() || undefined, faceValue: face,
        soldAmount: form.soldAmount === '' ? face : Number(form.soldAmount),
        issuedToMemberId: form.issuedToMemberId || undefined,
        issuedToName: form.issuedToName || undefined, issuedToPhone: form.issuedToPhone || undefined,
        expiresAt: form.expiresAt || undefined, note: form.note || undefined,
      });
      reset(); load();
    } catch (e) { alert(e.response?.data?.error || '发放失败'); }
  };
  const voidVoucher = async (v) => {
    const reason = prompt(`作废礼券 ${v.code} 的原因:`, 'voided by admin');
    if (!reason) return;
    try { await api.post(`/vouchers/${v.id}/void`, { reason }); load(); }
    catch (e) { alert(e.response?.data?.error || '作废失败'); }
  };
  const openDetail = async (v) => setDetail((await api.get(`/vouchers/${v.id}`)).data);
  return <Panel title="Gift Voucher" subtitle="发放 / 查询 / 核销记录 / 作废 · 余额即未核销负债">
    {summary && <div className="report-kpis voucher-kpis">
      <span>Total <b>{summary.count}</b></span>
      <span>Face Issued <b>{money(summary.faceIssued)}</b></span>
      <span>Redeemed <b>{money(summary.redeemedTotal)}</b></span>
      <span>Outstanding <b>{money(summary.outstandingBalance)}</b></span>
      <span>Active <b>{summary.byStatus?.active || 0}</b> · Expired <b>{summary.byStatus?.expired || 0}</b> · Void <b>{summary.byStatus?.void || 0}</b></span>
    </div>}
    <div className="ops-form inline">
      <Input label="Code (auto if blank)" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="GV-2001" />
      <Input label="Face Value" type="number" value={form.faceValue} onChange={(v) => setForm({ ...form, faceValue: v })} />
      <Input label="Sold Amount" type="number" value={form.soldAmount} onChange={(v) => setForm({ ...form, soldAmount: v })} placeholder="= face" />
      <label className="ops-field"><span>Issue To Member</span>
        <select value={form.issuedToMemberId} onChange={(e) => setForm({ ...form, issuedToMemberId: e.target.value })}>
          <option value="">— walk-in / gift —</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.memberNo} · {m.name}</option>)}
        </select>
      </label>
      <Input label="Issued To Name" value={form.issuedToName} onChange={(v) => setForm({ ...form, issuedToName: v })} placeholder="Corp / walk-in" />
      <Input label="Phone" value={form.issuedToPhone} onChange={(v) => setForm({ ...form, issuedToPhone: v })} />
      <Input label="Expires" type="date" value={form.expiresAt} onChange={(v) => setForm({ ...form, expiresAt: v })} />
      <Input label="Note" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
      <Action onClick={issue}>Issue Voucher</Action>
    </div>
    <div className="ops-form inline">
      <label className="ops-field"><span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All</option><option value="active">Active</option><option value="used">Used</option>
          <option value="expired">Expired</option><option value="void">Void</option>
        </select>
      </label>
      <Input label="Search" value={q} onChange={setQ} placeholder="code / voucher no / name / phone" />
      <Action tone="secondary" onClick={load}>Search</Action>
    </div>
    <div className="ops-table tall"><div className="ops-row ops-head"><span>Voucher No.</span><span>Code</span><span>Face</span><span>Used</span><span>Balance</span><span>Issued To</span><span>Status</span><span>Expires</span><span>Action</span></div>
      {rows.map((v) => <div className="ops-row" key={v.id}>
        <span>{v.voucherNo}</span><span>{v.code}</span><span>{money(v.faceValue)}</span><span>{money(v.usedAmount)}</span>
        <span><b>{money(v.balance)}</b></span>
        <span>{v.issuedToName || v.issuedToPhone || '-'}</span>
        <span className={`voucher-status ${v.status}`}>{v.status}</span>
        <span>{v.expiresAt ? new Date(v.expiresAt).toLocaleDateString('en-GB') : '-'}</span>
        <span className="ops-inline-actions">
          <button className="mini-action" onClick={() => openDetail(v)}>Detail</button>
          {v.status !== 'void' && <button className="mini-action danger" onClick={() => voidVoucher(v)}>Void</button>}
        </span>
      </div>)}
      {!rows.length && <Empty text="No voucher yet" />}
    </div>
    {detail && <div className="voucher-detail">
      <div className="voucher-detail-head"><b>{detail.voucherNo} · {detail.code}</b><span>面值 {money(detail.faceValue)} · 余额 {money(detail.balance)} · {detail.status}</span><button className="mini-action" onClick={() => setDetail(null)}>Close</button></div>
      <div className="ops-table"><div className="ops-row ops-head cols-5"><span>When</span><span>Type</span><span>Amount</span><span>Balance After</span><span>Order / Reason</span></div>
        {(detail.txns || []).map((t) => <div className="ops-row cols-5" key={t.id}><span>{new Date(t.createdAt).toLocaleString('en-GB')}</span><span>{t.type}</span><span>{money(t.amount)}</span><span>{money(t.balanceAfter)}</span><span>{t.orderNo || t.reason || '-'}</span></div>)}
        {!(detail.txns || []).length && <Empty text="No transaction" />}
      </div>
    </div>}
  </Panel>;
}

function RebatePanel() {
  const [members, setMembers] = useState([]); const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null); const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ memberId: '', type: 'earn', amount: '', reason: '' });
  const [ledger, setLedger] = useState(null);
  const load = async () => {
    setMembers((await api.get('/members')).data);
    setSummary((await api.get('/rebates/summary')).data);
    setSettings((await api.get('/settings')).data);
  };
  useEffect(() => { load(); }, []);
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const saveSettings = async () => {
    const r = await api.put('/settings', { rebatePercent: Number(settings.rebatePercent || 0), rebateExpiryDays: Number(settings.rebateExpiryDays || 0) });
    setSettings(r.data); setMsg('已保存'); setTimeout(() => setMsg(''), 1500);
  };
  const adjust = async () => {
    if (!form.memberId) { alert('请选择会员'); return; }
    const amt = Number(form.amount || 0);
    if (!(amt > 0)) { alert('金额必须大于 0'); return; }
    try {
      await api.post(`/members/${form.memberId}/rebate`, { type: form.type, amount: amt, reason: form.reason || undefined });
      setForm({ ...form, amount: '', reason: '' }); load();
      if (ledger && String(ledger.member.id) === String(form.memberId)) openLedger(ledger.member);
    } catch (e) { alert(e.response?.data?.error || '调整失败'); }
  };
  const openLedger = async (m) => setLedger({ member: m, rows: (await api.get(`/members/${m.id}/rebate-ledger`)).data });
  const withRebate = members.filter((m) => Number(m.rebateBalance || 0) !== 0);
  return <>
    <Panel title="Member Rebate" subtitle="结账自动返利规则 + 手工调整 + 返利流水">
      {summary && <div className="report-kpis voucher-kpis">
        <span>Earned <b>{money(summary.earnedTotal)}</b></span>
        <span>Redeemed <b>{money(summary.redeemedTotal)}</b></span>
        <span>Outstanding <b>{money(summary.outstandingBalance)}</b></span>
        <span>Members <b>{summary.membersWithRebate}</b></span>
        <span>Entries <b>{summary.entries}</b></span>
      </div>}
      {settings && <div className="ops-form inline">
        <Input label="Auto Rebate %" type="number" value={settings.rebatePercent ?? 0} onChange={(v) => setSettings({ ...settings, rebatePercent: v })} />
        <Input label="Expiry (days, 0 = never)" type="number" value={settings.rebateExpiryDays ?? 0} onChange={(v) => setSettings({ ...settings, rebateExpiryDays: v })} />
        <Action onClick={saveSettings}>Save Rules</Action>{msg && <span className="ops-saved">{msg}</span>}
      </div>}
      <div className="ops-form inline">
        <label className="ops-field"><span>Member</span>
          <select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
            <option value="">Select member</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.memberNo} · {m.name} (可用 {money(m.rebateBalance)})</option>)}
          </select>
        </label>
        <label className="ops-field"><span>Type</span>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="earn">Earn 增加</option><option value="redeem">Redeem 扣减</option>
          </select>
        </label>
        <Input label="Amount" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
        <Input label="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} placeholder="goodwill / correction" />
        <Action onClick={adjust}>Apply Adjustment</Action>
      </div>
      <div className="ops-table"><div className="ops-row ops-head cols-5"><span>Member No.</span><span>Name</span><span>Points</span><span>Rebate Balance</span><span>Action</span></div>
        {members.map((m) => <div className="ops-row cols-5" key={m.id}><span>{m.memberNo}</span><span>{m.name}</span><span>{Number(m.points || 0)}</span><span><b>{money(m.rebateBalance)}</b></span><span className="ops-inline-actions"><button className="mini-action" onClick={() => openLedger(m)}>Ledger</button></span></div>)}
        {!members.length && <Empty />}
      </div>
    </Panel>
    {ledger && <Panel title={`Rebate Ledger · ${ledger.member.memberNo}`} subtitle={`${ledger.member.name} · 当前余额 ${money(ledger.member.rebateBalance)}`}>
      <div className="ops-actions"><Action tone="secondary" onClick={() => setLedger(null)}>Close</Action></div>
      <div className="ops-table tall"><div className="ops-row ops-head"><span>When</span><span>Type</span><span>Amount</span><span>Balance After</span><span>Order</span><span>Rate</span><span>Reason</span><span>By</span></div>
        {ledger.rows.map((r) => <div className="ops-row" key={r.id}><span>{new Date(r.createdAt).toLocaleString('en-GB')}</span><span>{r.type}</span><span>{money(r.amount)}</span><span>{money(r.balanceAfter)}</span><span>{r.orderNo || '-'}</span><span>{r.percent ? `${r.percent}%` : '-'}</span><span>{r.reason || '-'}</span><span>{r.createdByName || '-'}</span></div>)}
        {!ledger.rows.length && <Empty text="No rebate entry" />}
      </div>
    </Panel>}
  </>;
}

function CustomerStockPanel() {
  const [rows, setRows] = useState([]); const [members, setMembers] = useState([]);
  const [form, setForm] = useState({ memberId: '', itemName: '', qty: '', unit: 'btl', note: '' });
  const load = async () => { setRows((await api.get('/customer-stock')).data); setMembers((await api.get('/members')).data); };
  useEffect(() => { load(); }, []);
  const add = async () => { if (!form.memberId || !form.itemName) return; await api.post('/customer-stock', { ...form, qty: Number(form.qty || 0) }); setForm({ memberId: '', itemName: '', qty: '', unit: 'btl', note: '' }); load(); };
  const adjust = async (c, delta) => { await api.post(`/customer-stock/${c.id}/adjust`, { delta }); load(); };
  return <Panel title="Customer Stock" subtitle="Goods kept on behalf of members (bottle / carton service)">
    <div className="ops-form inline">
      <label className="ops-field"><span>Member</span><select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}><option value="">Select member</option>{members.map((m) => <option key={m.id} value={m.id}>{m.memberNo} · {m.name}</option>)}</select></label>
      <Input label="Item" value={form.itemName} onChange={(v) => setForm({ ...form, itemName: v })} placeholder="Heineken" />
      <Input label="Qty" type="number" value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} />
      <Input label="Unit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
      <Input label="Note" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
      <Action onClick={add}>Add Stock</Action>
    </div>
    <div className="ops-table"><div className="ops-row ops-head"><span>Member</span><span>Item</span><span>Qty</span><span>Unit</span><span>Note</span><span>Action</span></div>
      {rows.map((c) => <div className="ops-row" key={c.id}><span>{c.memberNo}</span><span>{c.itemName}</span><span>{c.qty}</span><span>{c.unit}</span><span>{c.note || '-'}</span><span className="ops-inline-actions"><button className="mini-action" onClick={() => adjust(c, 1)}>+1</button><button className="mini-action" onClick={() => adjust(c, -1)}>-1</button></span></div>)}
      {!rows.length && <Empty />}
    </div>
  </Panel>;
}

function StockTakePanel() {
  const [rows, setRows] = useState([]); const [active, setActive] = useState(null);
  const load = async () => setRows((await api.get('/stock-takes')).data);
  useEffect(() => { load(); }, []);
  const create = async () => { const r = await api.post('/stock-takes', {}); setActive(r.data); load(); };
  const setCount = (itemId, val) => setActive((prev) => ({ ...prev, lines: prev.lines.map((l) => String(l.itemId) === String(itemId) ? { ...l, countedQty: val } : l) }));
  const save = async () => { await api.put(`/stock-takes/${active.id}`, { lines: active.lines.map((l) => ({ itemId: l.itemId, countedQty: l.countedQty })) }); alert('草稿已保存'); load(); };
  const post = async () => { await api.put(`/stock-takes/${active.id}`, { lines: active.lines.map((l) => ({ itemId: l.itemId, countedQty: l.countedQty })) }); await api.post(`/stock-takes/${active.id}/post`, {}); alert('盘点已过账，库存已更新'); setActive(null); load(); };
  const variance = (l) => (l.countedQty == null ? 0 : Number(l.countedQty) - Number(l.systemQty));
  return <Panel title="Periodical Stock Take" subtitle="Snapshot system stock, enter counted quantities, post variance">
    <div className="ops-actions"><Action onClick={create}>New Stock Take</Action>{active && <><Action tone="secondary" onClick={save}>Save Draft</Action><Action tone="warning" onClick={post}>Post &amp; Update Stock</Action></>}</div>
    {active ? <div className="ops-table tall"><div className="ops-row ops-head"><span>Code</span><span>Name</span><span>System</span><span>Counted</span><span>Variance</span></div>
      {active.lines.map((l) => <div className="ops-row" key={l.itemId}><span>{l.code}</span><span>{l.name}</span><span>{l.systemQty}</span><span><input className="mini-input" type="number" value={l.countedQty ?? ''} onChange={(e) => setCount(l.itemId, e.target.value === '' ? null : Number(e.target.value))} /></span><span className={variance(l) !== 0 ? 'variance-nonzero' : ''}>{variance(l)}</span></div>)}
    </div> : <div className="ops-table"><div className="ops-row ops-head"><span>Take No.</span><span>Status</span><span>Lines</span><span>Created</span><span>Action</span></div>
      {rows.map((r) => <div className="ops-row" key={r.id}><span>{r.takeNo}</span><span>{r.status}</span><span>{r.lines.length}</span><span>{new Date(r.createdAt).toLocaleString()}</span><span>{r.status === 'draft' && <button className="mini-action" onClick={() => setActive(r)}>Open</button>}</span></div>)}
      {!rows.length && <Empty text="No stock take yet" />}
    </div>}
  </Panel>;
}

function BarcodePanel() {
  const [variants, setVariants] = useState([]); const [scan, setScan] = useState(''); const [found, setFound] = useState(null);
  useEffect(() => { api.get('/menu/variants').then((r) => setVariants(r.data)); }, []);
  const lookup = async () => { try { const r = await api.get(`/menu/variants/barcode/${encodeURIComponent(scan)}`); setFound(r.data); } catch { setFound(null); alert('未找到该条码'); } };
  const save = async (v, barcode) => { await api.put(`/menu/variants/${v.id}`, { barcode }); setVariants((prev) => prev.map((x) => x.id === v.id ? { ...x, barcode } : x)); };
  return <Panel title="Barcode" subtitle="Assign and scan product barcodes">
    <div className="ops-form inline"><Input label="Scan / Enter Barcode" value={scan} onChange={setScan} placeholder="e.g. 9556001234" /><Action onClick={lookup}>Lookup</Action>{found && <span className="barcode-found">Found: {found.code} · {found.name} · ¥{found.price}</span>}</div>
    <div className="ops-table tall"><div className="ops-row ops-head"><span>Code</span><span>Name</span><span>Price</span><span>Barcode</span></div>
      {variants.map((v) => <div className="ops-row" key={v.id}><span>{v.code}</span><span>{v.name}</span><span>¥{Number(v.price).toFixed(2)}</span><span><input className="mini-input" defaultValue={v.barcode || ''} onBlur={(e) => e.target.value !== (v.barcode || '') && save(v, e.target.value)} placeholder="—" /></span></div>)}
    </div>
  </Panel>;
}

function GstPanel() {
  const [s, setS] = useState(null); const [msg, setMsg] = useState('');
  useEffect(() => { api.get('/settings').then((r) => setS(r.data)); }, []);
  const save = async () => { const r = await api.put('/settings', s); setS(r.data); setMsg('已保存'); setTimeout(() => setMsg(''), 1500); };
  if (!s) return <Panel title="GST / Store Setup" subtitle="Loading…"><Empty text="Loading settings" /></Panel>;
  const upd = (k, v) => setS({ ...s, [k]: v });
  return <Panel title="GST / Store Setup" subtitle="Company profile, GST rate, inclusive pricing, service charge, invoice prefix">
    <div className="ops-grid two">
      <div className="ops-form">
        <Input label="Company Name" value={s.companyName || ''} onChange={(v) => upd('companyName', v)} />
        <Input label="Address" value={s.address || ''} onChange={(v) => upd('address', v)} />
        <Input label="Phone" value={s.phone || ''} onChange={(v) => upd('phone', v)} />
        <Input label="GST Registration No." value={s.gstNo || ''} onChange={(v) => upd('gstNo', v)} />
        <Input label="Invoice Prefix" value={s.invoicePrefix || ''} onChange={(v) => upd('invoicePrefix', v)} />
      </div>
      <div className="ops-form">
        <Input label="GST Rate %" type="number" value={s.taxRate ?? 0} onChange={(v) => upd('taxRate', Number(v))} />
        <Input label="Service Charge %" type="number" value={s.serviceChargeRate ?? 0} onChange={(v) => upd('serviceChargeRate', Number(v))} />
        <label className="ops-checkbox"><input type="checkbox" checked={!!s.taxInclusive} onChange={(e) => upd('taxInclusive', e.target.checked)} /> Prices include GST (含税价)</label>
        <label className="ops-checkbox"><input type="checkbox" checked={!!s.roundTo5cent} onChange={(e) => upd('roundTo5cent', e.target.checked)} /> Round total to 5 cent</label>
        <Input label="Receipt Footer" value={s.receiptFooter || ''} onChange={(v) => upd('receiptFooter', v)} />
        <Action onClick={save}>Save Settings</Action>{msg && <span className="ops-saved">{msg}</span>}
      </div>
    </div>
  </Panel>;
}

function PrinterPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: '', target: 'receipt', connection: 'usb', width: 80 });
  const load = async () => setRows((await api.get('/hardware/printers')).data);
  useEffect(() => { load(); }, []);
  const add = async () => { if (!form.name) return; await api.post('/hardware/printers', { ...form, width: Number(form.width) }); setForm({ name: '', target: 'receipt', connection: 'usb', width: 80 }); load(); };
  const toggle = async (p) => { await api.put(`/hardware/printers/${p.id}`, { isActive: !p.isActive }); load(); };
  const test = async (target) => { const r = await api.post('/hardware/print', { target }); alert(`测试打印已排队\n\n${r.data.escpos || '(空)'}`); };
  const drawer = async () => { await api.post('/hardware/drawer', {}); alert('钱箱指令已发送'); };
  return <Panel title="Printers / Hardware" subtitle="Receipt · Kitchen · Bar · A4 routing and cash drawer">
    <div className="ops-form inline">
      <Input label="Printer Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      <label className="ops-field"><span>Target</span><select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}><option value="receipt">Receipt</option><option value="kitchen">Kitchen</option><option value="bar">Bar</option><option value="a4">A4 / Office</option></select></label>
      <label className="ops-field"><span>Connection</span><select value={form.connection} onChange={(e) => setForm({ ...form, connection: e.target.value })}><option value="usb">USB</option><option value="lan">LAN / Ethernet</option><option value="bluetooth">Bluetooth</option><option value="system">System / A4</option></select></label>
      <Input label="Width mm" type="number" value={form.width} onChange={(v) => setForm({ ...form, width: v })} />
      <Action onClick={add}>Add Printer</Action>
    </div>
    <div className="ops-actions"><Action tone="secondary" onClick={() => test('receipt')}>Test Receipt</Action><Action tone="secondary" onClick={() => test('kitchen')}>Test Kitchen</Action><Action tone="warning" onClick={drawer}>Open Cash Drawer</Action></div>
    <div className="ops-table"><div className="ops-row ops-head"><span>Name</span><span>Target</span><span>Connection</span><span>Width</span><span>Status</span><span>Action</span></div>
      {rows.map((p) => <div className="ops-row" key={p.id}><span>{p.name}</span><span>{p.target}</span><span>{p.connection}</span><span>{p.width}mm</span><span>{p.isActive ? 'Active' : 'Inactive'}</span><span className="ops-inline-actions"><button className="mini-action" onClick={() => test(p.target)}>Test</button><button className="mini-action" onClick={() => toggle(p)}>{p.isActive ? 'Disable' : 'Enable'}</button></span></div>)}
      {!rows.length && <Empty />}
    </div>
  </Panel>;
}

function DesignerPanel() {
  const [rows, setRows] = useState([]); const [report, setReport] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'sales_by_date', columns: 'orderNo,date,total' });
  const load = async () => setRows((await api.get('/report-templates')).data);
  useEffect(() => { load(); }, []);
  const add = async () => { if (!form.name) return; await api.post('/report-templates', { name: form.name, type: form.type, columns: form.columns.split(',').map((c) => c.trim()).filter(Boolean) }); setForm({ name: '', type: 'sales_by_date', columns: 'orderNo,date,total' }); load(); };
  const run = async (t) => setReport({ template: t, data: (await api.get(`/reports/query?type=${t.type}`)).data });
  const remove = async (t) => { if (t.isSystem) return; if (!window.confirm(`删除模板 ${t.name}?`)) return; await api.delete(`/report-templates/${t.id}`); load(); };
  return <Panel title="Report Designer" subtitle="Create custom report templates and run them">
    <div className="ops-form inline">
      <Input label="Template Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      <label className="ops-field"><span>Base Report</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="sales_by_date">Sales By Date</option><option value="sales_by_product">Sales By Product</option><option value="sales_by_cashier">Sales By Cashier</option><option value="refund_report">Refund Report</option><option value="stock_report">Stock Report</option></select></label>
      <Input label="Columns (comma)" value={form.columns} onChange={(v) => setForm({ ...form, columns: v })} />
      <Action onClick={add}>Save Template</Action>
    </div>
    <div className="ops-table"><div className="ops-row ops-head"><span>Name</span><span>Base</span><span>Columns</span><span>Type</span><span>Action</span></div>
      {rows.map((t) => <div className="ops-row" key={t.id}><span>{t.name}</span><span>{t.type}</span><span>{t.columns.join(', ')}</span><span>{t.isSystem ? 'System' : 'Custom'}</span><span className="ops-inline-actions"><button className="mini-action" onClick={() => run(t)}>Run</button>{!t.isSystem && <button className="mini-action danger" onClick={() => remove(t)}>Delete</button>}</span></div>)}
    </div>
    {report && <div className="report-result"><div className="report-kpis"><span>Template <b>{report.template.name}</b></span><span>Total <b>¥{Number(report.data.total).toFixed(2)}</b></span><span>Rows <b>{report.data.count}</b></span></div><div className="ops-table"><div className="ops-row ops-head">{report.template.columns.map((c) => <span key={c}>{c}</span>)}</div>{report.data.rows.map((row, i) => <div className="ops-row" key={i}>{report.template.columns.map((c) => <span key={c}>{typeof row[c] === 'number' ? Number(row[c]).toFixed(2) : String(row[c] ?? '-')}</span>)}</div>)}</div></div>}
  </Panel>;
}
