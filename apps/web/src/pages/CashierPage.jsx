import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api/client.js';

const CATEGORY_COLORS = ['#d7e48e', '#f4bd63', '#f3e95d', '#ef9cca', '#9ed6e9', '#52d065', '#60a4eb', '#e79bd1', '#a99ece'];
const PAGE_SIZE = 12;
const newPage = (id) => ({ id, label: `Page ${id}`, cart: [], status: 'draft', orderId: null });

export default function CashierPage() {
  const [tree, setTree] = useState({ categories: [], bases: [], modifiers: [], baseModifiers: [], variants: [] });
  const [tables, setTables] = useState([]);
  const [active, setActive] = useState([]);
  const [mode, setMode] = useState('dine_in');
  const [tableId, setTableId] = useState('');
  const [catId, setCatId] = useState('');
  const [baseFilter, setBaseFilter] = useState('all');
  const [menuPage, setMenuPage] = useState(0);
  const [pages, setPages] = useState([newPage(1)]);
  const [activePageId, setActivePageId] = useState(1);
  const [multiplier, setMultiplier] = useState(1);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [settlement, setSettlement] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const activePage = pages.find((p) => p.id === activePageId) || pages[0];
  const cart = activePage?.cart || [];
  const total = cart.reduce((s, c) => s + c.unitPrice * c.qty, 0);

  const loadTree = async () => {
    const r = await api.get('/menu/tree');
    setTree(r.data);
    if (!catId && r.data.categories[0]) setCatId(r.data.categories[0].id);
  };
  const loadTables = async () => { const r = await api.get('/tables'); setTables(r.data); };
  const loadActive = async () => { const r = await api.get('/orders?status=kitchen'); setActive(r.data); };

  useEffect(() => {
    loadTree();
    loadTables();
    loadActive();
    const socketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || undefined;
    const socket = io(socketUrl, { auth: { token: localStorage.getItem('token') } });
    const receiveOrder = (order) => setActive((prev) => [order, ...prev.filter((o) => o._id !== order._id)]);
    socket.on('order:created', receiveOrder);
    socket.on('kds:ticket', receiveOrder);
    socket.on('order:closed', (id) => setActive((prev) => prev.filter((o) => o._id !== id)));
    return () => socket.disconnect();
  }, []);

  const basesInCat = useMemo(() => tree.bases.filter((b) => b.categoryId === catId && b.isActive), [tree.bases, catId]);
  const directVariants = useMemo(() => {
    const baseIds = new Set(basesInCat.map((b) => b.id));
    return tree.variants
      .filter((v) => v.isActive && baseIds.has(v.baseId))
      .filter((v) => baseFilter === 'all' || v.baseId === baseFilter)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [tree.variants, basesInCat, baseFilter]);
  const totalPages = Math.max(1, Math.ceil(directVariants.length / PAGE_SIZE));
  const visibleVariants = directVariants.slice(menuPage * PAGE_SIZE, (menuPage + 1) * PAGE_SIZE);

  const selectCategory = (id) => { setCatId(id); setBaseFilter('all'); setMenuPage(0); };
  const selectBase = (id) => { setBaseFilter(id); setMenuPage(0); };
  const updateActiveCart = (updater) => setPages((prev) => prev.map((p) => p.id === activePageId ? { ...p, cart: updater(p.cart) } : p));

  // 截图式直接点单：每个 KO/KOS/KC/KP 等变体本身就是一个按钮，不弹出第二层 modal。
  const addToCart = (v) => {
    if (!v || activePage.status !== 'draft') return;
    const qty = multiplier;
    updateActiveCart((prev) => {
      const f = prev.find((c) => c.variantId === v.id);
      if (f) return prev.map((c) => (c.variantId === v.id ? { ...c, qty: c.qty + qty } : c));
      return [...prev, { variantId: v.id, code: v.code, name: v.name, unitPrice: v.price, qty }];
    });
    setMultiplier(1);
  };
  const changeQty = (idx, d) => updateActiveCart((prev) => prev.map((c, i) => (i === idx ? { ...c, qty: Math.max(0, c.qty + d) } : c)).filter((c) => c.qty > 0));

  const createPage = () => {
    const id = pages.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    setPages((prev) => [...prev, newPage(id)]);
    setActivePageId(id);
  };
  const closePage = (id) => {
    const target = pages.find((p) => p.id === id);
    if (target?.cart.length && !window.confirm('这个页面还有未发送的点单，确定关闭吗？')) return;
    const rest = pages.filter((p) => p.id !== id);
    if (!rest.length) { const fresh = newPage(1); setPages([fresh]); setActivePageId(1); return; }
    setPages(rest);
    if (id === activePageId) setActivePageId(rest[rest.length - 1].id);
  };

  // Send 只发送当前页面；发送后保留已发送页面，并自动开一个新的空白点单页。
  const sendCurrentPage = async () => {
    if (!cart.length) return;
    if (mode === 'dine_in' && !tableId) { alert('请选择桌台'); return; }
    const r = await api.post('/orders', { type: mode, tableId: mode === 'dine_in' ? tableId : undefined, items: cart });
    await api.put(`/orders/${r.data._id}/status`, { status: 'kitchen' });
    setPages((prev) => {
      const nextId = prev.reduce((max, p) => Math.max(max, p.id), 0) + 1;
      return [...prev.map((p) => p.id === activePageId ? { ...p, status: 'sent', orderId: r.data._id, label: `${p.label} · Sent` } : p), newPage(nextId)];
    });
    setActivePageId((prev) => prev + 1);
    setTableId('');
    loadActive();
    loadTables();
  };

  const openPayment = (order) => {
    setPaymentOrder(order);
    setPaymentMethod('cash');
    setAmountTendered(String(Number(order.total).toFixed(2)));
  };
  const confirmPayment = async () => {
    if (!paymentOrder) return;
    const tendered = Number(amountTendered);
    if (!Number.isFinite(tendered) || tendered < Number(paymentOrder.total)) { alert('实收金额不足'); return; }
    const result = await api.post(`/orders/${paymentOrder._id}/checkout`, { payments: [{ method: paymentMethod, amount: tendered }], tip: 0 });
    setPaymentOrder(null);
    setSettlement({ order: paymentOrder, receipt: result.data.receipt, method: paymentMethod, tendered, change: tendered - Number(paymentOrder.total) });
    loadActive();
    loadTables();
  };
  const completeSettlement = () => {
    if (!settlement) return;
    setReceipt({ ...settlement.receipt, payments: [{ method: settlement.method, amount: settlement.tendered }] });
    setSettlement(null);
  };
  const requestVoid = async (o) => { const reason = prompt('取消原因(需主管审批):'); if (!reason) return; await api.post(`/orders/${o._id}/void`, { reason }); loadActive(); };

  return (
    <div className="cashier-screen">
      <div className="cashier-top">
        {tree.categories.map((c, i) => <button key={c.id} className={`cashier-cat ${catId === c.id ? 'active' : ''}`} style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} onClick={() => selectCategory(c.id)}>{c.name}</button>)}
        <button className="cashier-cat" onClick={() => { setBaseFilter('all'); setMenuPage(0); }}>All Menu</button>
        <span className="text-[10px] self-center px-2">{new Date().toLocaleString('en-GB')}</span>
      </div>

      <div className="cashier-page-tabs">
        <span className="cashier-page-label">Order pages</span>
        {pages.map((p) => <button key={p.id} className={`cashier-page-tab ${p.id === activePageId ? 'active' : ''} ${p.status === 'sent' ? 'sent' : ''}`} onClick={() => setActivePageId(p.id)}>{p.label}<b onClick={(e) => { e.stopPropagation(); closePage(p.id); }}>×</b></button>)}
        <button className="cashier-new-page" onClick={createPage}>+ New page</button>
      </div>

      <div className="cashier-body">
        <div className="cashier-tool-panel">
          <button onClick={() => setMenuPage((p) => Math.max(0, p - 1))}>Menu<br />Up</button>
          <button onClick={() => setMenuPage((p) => Math.min(totalPages - 1, p + 1))}>Menu<br />Down</button>
          <button onClick={() => updateActiveCart(() => [])}>Del</button>
          <button onClick={() => setMultiplier(1)}>Pax</button>
          <button onClick={() => updateActiveCart((c) => c.slice(0, -1))}>X Dish</button>
          <button>Pre-Disc</button>
          <button onClick={() => updateActiveCart(() => [])}>Void</button>
          <div className="cashier-multiplier">{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} onClick={() => setMultiplier(n)} className={multiplier === n ? 'bg-yellow-200' : ''}>x{n}</button>)}</div>
          <div className="text-[10px] text-center text-indigo-900">下次点单 x{multiplier}</div>
        </div>

        <div className="cashier-menu-panel">
          <div className="cashier-subcategory-bar">
            <button className={baseFilter === 'all' ? 'active' : ''} onClick={() => selectBase('all')}>ALL</button>
            {basesInCat.map((b) => <button key={b.id} className={baseFilter === b.id ? 'active' : ''} onClick={() => selectBase(b.id)}>{b.name}</button>)}
          </div>
          <div className="cashier-menu-caption"><strong>{tree.categories.find((c) => c.id === catId)?.name || 'Menu'}</strong><span>直接选择商品 / {directVariants.length} items</span></div>
          <div className="cashier-menu-grid direct-menu-grid">
            {visibleVariants.map((v) => <button key={v.id} className="cashier-base direct-menu-item" disabled={activePage.status === 'sent'} onClick={() => addToCart(v)}><strong>{v.code}</strong><small>{v.name}</small><b>¥{Number(v.price).toFixed(2)}</b></button>)}
            {!visibleVariants.length && <div className="text-slate-500 p-5">该分类暂无菜单，请在后台菜单管理添加。</div>}
          </div>
          <div className="cashier-menu-pagination"><button disabled={menuPage === 0} onClick={() => setMenuPage((p) => Math.max(0, p - 1))}>1-6</button>{Array.from({ length: totalPages }, (_, i) => <button key={i} className={menuPage === i ? 'active' : ''} onClick={() => setMenuPage(i)}>{i + 1}</button>)}<button disabled={menuPage >= totalPages - 1} onClick={() => setMenuPage((p) => Math.min(totalPages - 1, p + 1))}>7-12</button></div>
        </div>

        <div className="cashier-order-panel">
          <div className="cashier-order-title">Current Order <span>{activePage.label} · CODE · Description · Qty · Amt</span></div>
          <div className="cashier-order-head"><span>#</span><span>Description</span><span>Qty</span><span>Amt</span></div>
          <div className="cashier-order-list">
            {cart.map((c, idx) => <div key={idx} className="cashier-order-row"><span>{idx + 1}</span><span title={c.name}><b>{c.code}</b><br />{c.name}</span><span>{c.qty}</span><span>¥{(c.unitPrice * c.qty).toFixed(2)}<br /><button onClick={() => changeQty(idx, 1)}>+</button><button onClick={() => changeQty(idx, -1)}>−</button></span></div>)}
            {!cart.length && <div className="text-center text-indigo-800 p-5 text-xs">{activePage.status === 'sent' ? '已发送到厨房' : '请选择菜单项目'}</div>}
          </div>
          <div className="cashier-totals"><div>Pax: {cart.reduce((s, c) => s + c.qty, 0)}</div><strong>Total: ¥{total.toFixed(2)}</strong></div>
          <div className="cashier-keypad">{['Enter', '7', '8', '9', 'Back', '4', '5', '6', 'Up', '1', '2', '3', 'Down', '0', '.', 'Clear'].map((n) => <button key={n}>{n}</button>)}</div>
        </div>
      </div>

      <div className="cashier-footer">
        <button onClick={() => { const n = prompt('选择桌号', tableId); if (n) setTableId(n); }}>Table</button><button>Member</button><button>Request</button><button>Refund</button><button onClick={sendCurrentPage}>Send</button><button onClick={createPage}>Order</button><button onClick={() => updateActiveCart(() => [])}>Delete All</button><button>Discount</button><button>Open Item</button><button onClick={() => active.length ? openPayment(active[0]) : alert('请先 Send 一个订单')}>Payment</button><button onClick={() => window.print()}>PBill</button><button onClick={() => history.back()}>Exit</button>
      </div>
      <div className="cashier-orders-strip"><h3>收银端待处理订单 / Kitchen 已收到</h3><div className="cashier-open-orders">{active.map((o) => <div key={o._id} className="cashier-open-card"><b>{o.orderNo}</b> · ¥{o.total}<br />{o.items.reduce((s, i) => s + i.qty, 0)} items <button onClick={() => openPayment(o)}>Payment</button> <button onClick={() => requestVoid(o)}>Void</button></div>)}{!active.length && <span className="text-slate-500 text-xs">Send 后订单会立即显示在这里</span>}</div></div>

      {paymentOrder && <PaymentModal order={paymentOrder} method={paymentMethod} setMethod={setPaymentMethod} tendered={amountTendered} setTendered={setAmountTendered} onConfirm={confirmPayment} onClose={() => setPaymentOrder(null)} />}
      {settlement && <SettlementModal settlement={settlement} onComplete={completeSettlement} onClose={() => setSettlement(null)} />}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function PaymentModal({ order, method, setMethod, tendered, setTendered, onConfirm, onClose }) {
  const amount = Number(tendered || 0);
  const change = Math.max(0, amount - Number(order.total));
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window"><header><span>Payment · {order.orderNo}</span><button onClick={onClose}>×</button></header><div className="legacy-window-body"><div className="payment-amount-box"><small>AMOUNT DUE</small><strong>¥{Number(order.total).toFixed(2)}</strong></div><div className="payment-field"><label>Payment Type<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="tab">Credit / Account</option></select></label><label>Amount Tendered<input type="number" min="0" step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} /></label></div><div className="payment-change">Change <strong>¥{change.toFixed(2)}</strong></div><div className="payment-denoms">{[1, 5, 10, 20, 50, 100].map((n) => <button key={n} onClick={() => setTendered(String(n))}>¥{n}</button>)}</div><div className="legacy-window-actions"><button className="legacy-btn green" onClick={onConfirm}>Confirm Payment</button><button className="legacy-btn pink" onClick={onClose}>Cancel</button></div></div></section></div>;
}

function SettlementModal({ settlement, onComplete, onClose }) {
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window"><header><span>Settlement · Complete Sale</span><button onClick={onClose}>×</button></header><div className="legacy-window-body"><div className="settlement-success">Payment recorded</div><div className="settlement-summary"><div><span>Order</span><strong>{settlement.order.orderNo}</strong></div><div><span>Amount Due</span><strong>¥{Number(settlement.order.total).toFixed(2)}</strong></div><div><span>Tendered</span><strong>¥{settlement.tendered.toFixed(2)}</strong></div><div><span>Change</span><strong className="change-value">¥{settlement.change.toFixed(2)}</strong></div><div><span>Payment Type</span><strong>{settlement.method === 'cash' ? 'Cash' : 'Credit / Account'}</strong></div></div><p className="settlement-note">确认 Settlement 后，这张单会完成结算、扣减库存、释放桌位并可打印小票。</p><div className="legacy-window-actions"><button className="legacy-btn green" onClick={onComplete}>Complete Settlement</button><button className="legacy-btn pink" onClick={onClose}>Back</button></div></div></section></div>;
}

function ReceiptModal({ receipt, onClose }) {
  const print = () => { const w = window.open('', '_blank'); const rows = receipt.items.map((i) => `<div>${i.qty} x ${i.name} ...... ¥${(i.unitPrice * i.qty).toFixed(2)}</div>`).join(''); w.document.write(`<html><body style="font-family:monospace;width:280px;padding:10px"><h3>${receipt.storeName}</h3><div>${receipt.orderNo}</div><hr/>${rows}<hr/><b>Total ¥${receipt.total.toFixed(2)}</b></body></html>`); w.document.close(); w.print(); };
  return <div className="legacy-window-wrap"><section className="legacy-window" style={{ width: 330 }}><header><span>Receipt</span><button onClick={onClose}>×</button></header><div className="legacy-window-body"><h2>{receipt.storeName}</h2><div>Bill: {receipt.orderNo}</div>{receipt.items.map((i, idx) => <div key={idx} className="flex justify-between"><span>{i.qty}x{i.name}</span><span>¥{i.unitPrice * i.qty}</span></div>)}<hr /><div className="flex justify-between font-bold"><span>Total</span><span>¥{receipt.total}</span></div><div className="legacy-window-actions"><button className="legacy-btn green" onClick={print}>Print</button><button className="legacy-btn pink" onClick={onClose}>Exit</button></div></div></section></div>;
}
