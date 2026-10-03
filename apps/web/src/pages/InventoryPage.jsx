import { useEffect, useState, useMemo } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

const TYPE_LABEL = {
  opening: '期初', restock: '补货', purchase_receipt: '采购入库', receipt_void: '收货冲销',
  adjustment: '调整', count: '盘点', wastage: '损耗', return: '退供应商',
  transfer_in: '调拨入', transfer_out: '调拨出', sale: '销售出库',
  credit_note: '贷项回补', refund: '退款回补',
};
const MOVE_TYPES = ['opening', 'restock', 'purchase_receipt', 'receipt_void', 'adjustment', 'count', 'wastage', 'return', 'transfer_in', 'transfer_out', 'sale'];

function Panel({ title, subtitle, children }) {
  return (
    <section className="ops-panel">
      <div className="ops-panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      {children}
    </section>
  );
}
function Input({ label, value, onChange, type = 'text', placeholder = '', step }) {
  return (
    <label className="ops-field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} step={step} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Action({ children, onClick, tone = 'primary' }) {
  return <button className={`ops-action ${tone}`} onClick={onClick}>{children}</button>;
}
function Empty({ text = 'No records yet' }) { return <div className="ops-empty">{text}</div>; }

export default function InventoryPage() {
  const { can } = useAuth();
  const isWrite = can('stock.take');
  const [tab, setTab] = useState('items');

  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [locs, setLocs] = useState([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [loc, setLoc] = useState('');
  const [low, setLow] = useState(false);

  const [selected, setSelected] = useState(null);
  const [valData, setValData] = useState(null);
  const [batchType, setBatchType] = useState('adjustment');
  const [batchReason, setBatchReason] = useState('');
  const [batchModal, setBatchModal] = useState(false);

  const [xferList, setXferList] = useState([]);
  const [xferFrom, setXferFrom] = useState('');
  const [xferTo, setXferTo] = useState('');
  const [xferLines, setXferLines] = useState([{ itemId: '', qty: '' }]);

  const [ledger, setLedger] = useState([]);
  const [mvType, setMvType] = useState('');
  const [mvFrom, setMvFrom] = useState('');
  const [mvTo, setMvTo] = useState('');

  const loadItems = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (cat) p.set('category', cat);
      if (loc) p.set('location', loc);
      if (low) p.set('low', '1');
      const r = await api.get(`/inventory/items?${p}`);
      setItems(r.data || []);
      const c = [...new Set((r.data || []).map((i) => i.category).filter(Boolean))].sort();
      const l = [...new Set((r.data || []).map((i) => i.location).filter(Boolean))].sort();
      setCats(c); setLocs(l);
    } finally { setLoading(false); }
  };
  const loadVal = async () => { try { const r = await api.get('/inventory/valuation'); setValData(r.data); } catch {} };
  const loadXfers = async () => { try { const r = await api.get('/stock-transfers?status=posted'); setXferList(r.data || []); } catch {} };
  const loadLedger = async () => {
    try {
      const p = new URLSearchParams();
      if (mvType) p.set('type', mvType);
      if (mvFrom) p.set('from', mvFrom);
      if (mvTo) p.set('to', mvTo);
      const r = await api.get(`/inventory/movements?${p}`);
      setLedger(r.data || []);
    } catch {}
  };

  useEffect(() => { loadItems(); loadVal(); }, []);
  useEffect(() => { loadLedger(); }, [mvType, mvFrom, mvTo]);

  const sel = useMemo(() => items.find((i) => i.id === selected) || null, [items, selected]);

  return (
    <div className="operations-page">
      <div className="operations-heading">
        <div>
          <div className="modern-eyebrow">SMPOS / BACK OFFICE</div>
          <h1>Inventory Center</h1>
          <p>物料库存、调拨、台账流水</p>
        </div>
        <div className="operations-date">{new Date().toLocaleDateString('en-GB')}</div>
      </div>
      <div className="operations-tabs">
        {[
          ['items', 'Items 物料库存'],
          ['transfers', 'Transfers 库位调拨'],
          ['ledger', 'Movement Ledger 台账'],
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="operations-content">
        {tab === 'items' && (
          <>
            <div className="ops-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '18px' }}>
              <div style={{ padding: '14px 16px', border: '1px solid #e6eaf2', borderRadius: '12px', background: '#fff' }}>
                <small style={{ color: '#7e8ba1', fontSize: '11px' }}>Total Value</small>
                <div style={{ color: '#172033', fontSize: '20px', fontWeight: 800 }}>¥{valData ? valData.total.toFixed(2) : '0.00'}</div>
              </div>
              <div style={{ padding: '14px 16px', border: '1px solid #e6eaf2', borderRadius: '12px', background: '#fff' }}>
                <small style={{ color: '#7e8ba1', fontSize: '11px' }}>Items</small>
                <div style={{ color: '#172033', fontSize: '20px', fontWeight: 800 }}>{valData?.itemCount ?? items.length}</div>
              </div>
              <div style={{ padding: '14px 16px', border: '1px solid #e6eaf2', borderRadius: '12px', background: '#fff' }}>
                <small style={{ color: '#7e8ba1', fontSize: '11px' }}>Total Qty</small>
                <div style={{ color: '#172033', fontSize: '20px', fontWeight: 800 }}>{valData ? valData.totalQuantity : '-'}</div>
              </div>
              <div style={{ padding: '14px 16px', border: '1px solid #e6eaf2', borderRadius: '12px', background: '#fff' }}>
                <small style={{ color: '#c84e3d', fontSize: '11px' }}>Low Stock</small>
                <div style={{ color: '#c84e3d', fontSize: '20px', fontWeight: 800 }}>{valData?.lowCount ?? 0}</div>
              </div>
            </div>
            <div className="ops-grid two">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <Panel title="Inventory Items" subtitle={`${items.length} rows · 点击行查看与调整`}>
                  <div className="ops-form inline" style={{ marginBottom: '10px', flexWrap: 'wrap' }}>
                    <label className="ops-field"><span>Search</span><input value={q} placeholder="名称/编码" onChange={(e) => setQ(e.target.value)} /></label>
                    <label className="ops-field">
                      <span>Category</span>
                      <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                    </label>
                    <label className="ops-field">
                      <span>Location</span>
                      <select value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">All</option>{locs.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                    </label>
                    <label className="ops-checkbox" style={{ marginBottom: 0 }}>
                      <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> 仅显示低于安全库存
                    </label>
                    <Action onClick={loadItems}>Filter</Action>
                    {isWrite && <Action tone="secondary" onClick={() => setSelected('new')}>+ New Item</Action>}
                  </div>
                  <div className="ops-table tall">
                    <div className="ops-row ops-head cols-8">
                      <span>Code</span><span>Item</span><span>Category</span><span>Location</span><span>On Hand</span><span>Threshold</span><span>Avg Cost</span><span>Value</span>
                    </div>
                    {items.map((i) => (
                      <button key={i.id} className={`ops-row cols-8 ${selected === i.id ? 'selected' : ''} ${i.isLow ? 'variance-nonzero' : ''}`} onClick={() => setSelected(i.id)}>
                        <span>{i.code || '-'}</span><span>{i.name}</span><span>{i.category || '-'}</span><span>{i.location || '-'}</span>
                        <span>{i.quantity}</span><span>{i.threshold}</span><span>{i.avgCost?.toFixed(4)}</span><span>¥{i.stockValue?.toFixed(2)}</span>
                      </button>
                    ))}
                    {!items.length && !loading && <Empty />}
                  </div>
                </Panel>
                {isWrite && selected === 'new' && <NewItemPanel onCreated={() => { setSelected(null); loadItems(); loadVal(); }} />}
                {sel && <AdjustPanel item={sel} onDone={() => { loadItems(); loadVal(); loadLedger(); }} />}
                {sel && <ItemDetailPanel item={sel} onUpdated={() => { loadItems(); loadVal(); }} />}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <ValuationPanel data={valData} />
                <Panel title="Quick Adjust" subtitle="选中一行后，在左侧「Adjust」面板操作；或用下方批量方式">
                  <div className="ops-form inline">
                    <label className="ops-field">
                      <span>Type</span>
                      <select value={batchType} onChange={(e) => setBatchType(e.target.value)}>
                        {MOVE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
                      </select>
                    </label>
                    <label className="ops-field"><span>Reason</span><input value={batchReason} onChange={(e) => setBatchReason(e.target.value)} placeholder="原因/备注" /></label>
                    <Action tone="secondary" onClick={() => setBatchModal(true)}>Open Batch Adjust</Action>
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}

        {tab === 'transfers' && (
          <TransfersPanel
            xferList={xferList} loadXfers={loadXfers}
            xferFrom={xferFrom} setXferFrom={setXferFrom}
            xferTo={xferTo} setXferTo={setXferTo}
            xferLines={xferLines} setXferLines={setXferLines}
            isWrite={isWrite} items={items} loadItems={loadItems} loadVal={loadVal}
          />
        )}

        {tab === 'ledger' && (
          <LedgerPanel
            ledger={ledger} loadLedger={loadLedger}
            mvType={mvType} setMvType={setMvType}
            mvFrom={mvFrom} setMvFrom={setMvFrom}
            mvTo={mvTo} setMvTo={setMvTo}
          />
        )}
      </div>

      {batchModal && <BatchModal type={batchType} reason={batchReason} onClose={() => setBatchModal(false)} onDone={() => { loadItems(); loadVal(); loadLedger(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// state helpers (顶层 state 已在上面声明,但 hook 必须在组件内;这些 local panels 只消费 props)
// ---------------------------------------------------------------------------

function NewItemPanel({ onCreated }) {
  const [f, setF] = useState({ name: '', code: '', category: '', unit: 'kg', quantity: '', avgCost: '', threshold: '', location: '' });
  const add = async () => {
    await api.post('/inventory/items', { ...f, quantity: Number(f.quantity || 0), avgCost: Number(f.avgCost || 0), threshold: Number(f.threshold || 0) });
    onCreated();
  };
  return (
    <Panel title="New Item" subtitle="Code · Name · Category · Unit · Location · On Hand · Avg Cost · Threshold">
      <div className="ops-form inline" style={{ flexWrap: 'wrap' }}>
        <Input label="Code" value={f.code} onChange={(v) => setF({ ...f, code: v })} />
        <Input label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
        <Input label="Category" value={f.category} onChange={(v) => setF({ ...f, category: v })} />
        <Input label="Unit" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} />
        <Input label="Location" value={f.location} onChange={(v) => setF({ ...f, location: v })} />
        <Input label="Quantity" type="number" step="0.001" value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} />
        <Input label="Avg Cost" type="number" step="0.01" value={f.avgCost} onChange={(v) => setF({ ...f, avgCost: v })} />
        <Input label="Threshold" type="number" step="0.001" value={f.threshold} onChange={(v) => setF({ ...f, threshold: v })} />
        <Action onClick={add}>Create Item</Action>
      </div>
    </Panel>
  );
}

function ItemDetailPanel({ item, onUpdated }) {
  const [note, setNote] = useState(item.note || '');
  const [threshold, setThreshold] = useState(String(item.threshold || ''));
  const [location, setLocation] = useState(item.location || '');
  const save = async () => {
    await api.put(`/inventory/items/${item.id}`, { note, threshold: Number(threshold), location });
    onUpdated();
  };
  return (
    <Panel title={`Edit: ${item.name}`} subtitle="Note · Threshold · Location">
      <div className="ops-form inline" style={{ flexWrap: 'wrap' }}>
        <Input label="Note" value={note} onChange={setNote} />
        <Input label="Threshold" type="number" step="0.001" value={threshold} onChange={setThreshold} />
        <Input label="Location" value={location} onChange={setLocation} />
        <Action onClick={save}>Save</Action>
      </div>
    </Panel>
  );
}

function AdjustPanel({ item, onDone }) {
  const [delta, setDelta] = useState('');
  const [type, setType] = useState('adjustment');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const submit = async () => {
    const body = { itemId: item.id, delta: Number(delta), type, reason };
    if (unitCost !== '') body.unitCost = Number(unitCost);
    await api.post('/inventory/adjust', body);
    setDelta(''); setUnitCost(''); setReason('');
    onDone();
  };
  return (
    <Panel title={`Adjust: ${item.name}`} subtitle={`Current: ${item.quantity} ${item.unit} @ ${item.avgCost?.toFixed(4)}`}>
      <div className="ops-form inline" style={{ flexWrap: 'wrap' }}>
        <label className="ops-field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {MOVE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
          </select>
        </label>
        <Input label={type === 'count' ? 'Count (absolute)' : 'Delta (+ / -)'} type="number" step="0.001" value={delta} onChange={setDelta} />
        <Input label="Unit Cost" type="number" step="0.01" value={unitCost} onChange={setUnitCost} placeholder="optional" />
        <Input label="Reason / Note" value={reason} onChange={setReason} />
        <Action onClick={submit}>Apply</Action>
      </div>
    </Panel>
  );
}

function ValuationPanel({ data }) {
  if (!data) return <Panel title="Valuation" subtitle="Loading…"><Empty /></Panel>;
  return (
    <Panel title="Valuation Summary" subtitle={`Total ¥${data.total.toFixed(2)} · Qty ${data.totalQuantity}`}>
      <div className="ops-table">
        <div className="ops-row ops-head cols-4"><span>Category</span><span>Items</span><span>Qty</span><span>Value</span></div>
        {data.byCategory.map((c) => (
          <div className="ops-row cols-4" key={c.key}><span>{c.key}</span><span>{c.items}</span><span>{c.quantity}</span><span>¥{c.value.toFixed(2)}</span></div>
        ))}
      </div>
      <div className="ops-table" style={{ marginTop: '10px' }}>
        <div className="ops-row ops-head cols-4"><span>Location</span><span>Items</span><span>Qty</span><span>Value</span></div>
        {data.byLocation.map((c) => (
          <div className="ops-row cols-4" key={c.key}><span>{c.key || '-'}</span><span>{c.items}</span><span>{c.quantity}</span><span>¥{c.value.toFixed(2)}</span></div>
        ))}
      </div>
    </Panel>
  );
}

function TransfersPanel({ xferList, loadXfers, xferFrom, setXferFrom, xferTo, setXferTo, xferLines, setXferLines, isWrite, items, loadItems, loadVal }) {
  const addLine = () => setXferLines((ls) => [...ls, { itemId: '', qty: '' }]);
  const setLine = (i, k, v) => setXferLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const remLine = (i) => setXferLines((ls) => ls.filter((_, idx) => idx !== i));
  const createXfer = async () => {
    await api.post('/stock-transfers', {
      fromLocation: xferFrom, toLocation: xferTo,
      lines: xferLines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })),
    });
    setXferFrom(''); setXferTo(''); setXferLines([{ itemId: '', qty: '' }]);
    loadXfers(); loadItems(); loadVal();
  };
  const voidXfer = async (id) => {
    const reason = window.prompt('作废原因?');
    if (reason == null) return;
    await api.post(`/stock-transfers/${id}/void`, { reason });
    loadXfers(); loadItems(); loadVal();
  };
  return (
    <div className="ops-grid two">
      {isWrite && (
        <Panel title="New Stock Transfer" subtitle="From Location → To Location · Select items and quantities">
          <div className="ops-form" style={{ gridTemplateColumns: '1fr 1fr', gap: '11px' }}>
            <Input label="From Location" value={xferFrom} onChange={setXferFrom} />
            <Input label="To Location" value={xferTo} onChange={setXferTo} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
            {xferLines.map((l, i) => (
              <div key={i} className="ops-form inline" style={{ gap: '8px', flexWrap: 'nowrap' }}>
                <label className="ops-field" style={{ flex: 1 }}>
                  <span>Item</span>
                  <select value={l.itemId} onChange={(e) => setLine(i, 'itemId', e.target.value)}>
                    <option value="">-- choose --</option>
                    {items.filter((it) => it.location === xferFrom).map((it) => (
                      <option key={it.id} value={it.id}>{it.code || it.name} ({it.quantity} {it.unit})</option>
                    ))}
                  </select>
                </label>
                <Input label="Qty" type="number" step="0.001" value={l.qty} onChange={(v) => setLine(i, 'qty', v)} />
                {xferLines.length > 1 && <button className="mini-action danger" onClick={() => remLine(i)}>−</button>}
              </div>
            ))}
          </div>
          <div className="ops-actions">
            <Action tone="secondary" onClick={addLine}>+ Line</Action>
            <Action onClick={createXfer}>Create Transfer</Action>
          </div>
        </Panel>
      )}
      <Panel title="Transfer Log" subtitle="Posted transfers · Click row to view details">
        <div className="ops-table">
          <div className="ops-row ops-head cols-7"><span>No.</span><span>From</span><span>To</span><span>Items</span><span>Cost</span><span>Status</span><span>Action</span></div>
          {xferList.map((t) => (
            <div className="ops-row cols-7" key={t.id}>
              <span>{t.transferNo}</span><span>{t.fromLocation || '-'}</span><span>{t.toLocation || '-'}</span>
              <span>{(t.lines || []).length}</span><span>¥{t.totalCost?.toFixed(2)}</span><span>{t.status}</span>
              <span className="ops-inline-actions">
                {isWrite && t.status !== 'void' && <button className="mini-action danger" onClick={() => voidXfer(t.id)}>Void</button>}
              </span>
            </div>
          ))}
          {!xferList.length && <Empty />}
        </div>
      </Panel>
    </div>
  );
}

function LedgerPanel({ ledger, loadLedger, mvType, setMvType, mvFrom, setMvFrom, mvTo, setMvTo }) {
  return (
    <div className="ops-grid two">
      <Panel title="Movement Ledger" subtitle="All inventory movements with date filter">
        <div className="ops-form inline" style={{ marginBottom: '10px', flexWrap: 'wrap' }}>
          <label className="ops-field">
            <span>Type</span>
            <select value={mvType} onChange={(e) => setMvType(e.target.value)}><option value="">All</option>{MOVE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}</select>
          </label>
          <Input label="From" type="date" value={mvFrom} onChange={setMvFrom} />
          <Input label="To" type="date" value={mvTo} onChange={setMvTo} />
          <Action onClick={loadLedger}>Filter</Action>
        </div>
        <div className="ops-table tall">
          <div className="ops-row ops-head cols-8"><span>Date</span><span>Code</span><span>Type</span><span>Location</span><span>Qty</span><span>Unit Cost</span><span>Amount</span><span>Ref</span></div>
          {ledger.map((m) => (
            <div className="ops-row cols-8" key={m.id}>
              <span>{new Date(m.createdAt).toLocaleString('en-GB', { hour12: false })}</span>
              <span>{m.itemCode || '-'}</span>
              <span>{TYPE_LABEL[m.type] || m.type}</span>
              <span>{m.location || '-'}</span>
              <span>{m.delta}</span>
              <span>{m.unitCost?.toFixed(4)}</span>
              <span>¥{m.amount?.toFixed(2)}</span>
              <span>{m.refNo || '-'}</span>
            </div>
          ))}
          {!ledger.length && <Empty />}
        </div>
      </Panel>
      <Panel title="Inventory Items Snapshot" subtitle="Current stock for quick reference">
        <ItemQuickRef />
      </Panel>
    </div>
  );
}

function ItemQuickRef() {
  const [rows, setRows] = useState([]);
  const load = async () => { try { const r = await api.get('/inventory/items'); setRows(r.data || []); } catch {} };
  useEffect(() => { load(); }, []);
  return (
    <div className="ops-table tall">
      <div className="ops-row ops-head cols-5"><span>Code</span><span>Name</span><span>Location</span><span>Qty</span><span>Value</span></div>
      {rows.map((i) => (
        <div className="ops-row cols-5" key={i.id}><span>{i.code || '-'}</span><span>{i.name}</span><span>{i.location || '-'}</span><span>{i.quantity}</span><span>¥{i.stockValue?.toFixed(2)}</span></div>
      ))}
      {!rows.length && <Empty />}
    </div>
  );
}

function BatchModal({ type, reason, onClose, onDone }) {
  const [lines, setLines] = useState([{ itemId: '', qty: '', unitCost: '' }]);
  const [items, setItems] = useState([]);
  useEffect(() => { api.get('/inventory/items').then((r) => setItems(r.data || [])).catch(() => {}); }, []);
  const setL = (i, k, v) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const submit = async () => {
    await api.post('/inventory/adjust/batch', {
      type, reason,
      lines: lines.filter((l) => l.itemId && Number(l.qty) !== 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitCost: l.unitCost ? Number(l.unitCost) : undefined })),
    });
    onDone(); onClose();
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 'min(640px, 92vw)', maxHeight: '80vh', overflow: 'auto', background: '#fff', borderRadius: '16px', padding: '22px' }}>
        <h3 style={{ margin: '0 0 12px' }}>Batch Adjust — {TYPE_LABEL[type] || type}</h3>
        <p style={{ margin: '0 0 14px', color: '#7e8ba1', fontSize: '12px' }}>{reason}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          {lines.map((l, i) => (
            <div key={i} className="ops-form inline" style={{ gap: '8px' }}>
              <label className="ops-field" style={{ flex: 1 }}>
                <span>Item</span>
                <select value={l.itemId} onChange={(e) => setL(i, 'itemId', e.target.value)}>
                  <option value="">-- choose --</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.code || it.name} ({it.location})</option>)}
                </select>
              </label>
              <Input label="Qty / Delta" type="number" step="0.001" value={l.qty} onChange={(v) => setL(i, 'qty', v)} />
              <Input label="Unit Cost" type="number" step="0.01" value={l.unitCost} onChange={(v) => setL(i, 'unitCost', v)} placeholder="optional" />
              {lines.length > 1 && <button className="mini-action danger" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>−</button>}
            </div>
          ))}
        </div>
        <div className="ops-actions">
          <Action tone="secondary" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '', unitCost: '' }])}>+ Line</Action>
          <Action onClick={submit}>Submit</Action>
          <Action tone="secondary" onClick={onClose}>Cancel</Action>
        </div>
      </div>
    </div>
  );
}
