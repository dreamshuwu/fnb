import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

const CATEGORY_COLORS = ['#d7e48e', '#f4bd63', '#f3e95d', '#ef9cca', '#9ed6e9', '#52d065', '#60a4eb', '#e79bd1', '#a99ece'];
const PAGE_SIZE = 12;
const newPage = (id) => ({ id, label: `Page ${id}`, cart: [], discount: 0, status: 'draft', orderId: null, salesPersonId: '', memberId: '', memberLabel: '' });

export default function CashierPage() {
  // 按键权限:收银端的作废/折扣/退款/拆单/转台等按钮按权限显隐,服务端同样会拦。
  const { can } = useAuth();
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
  const [paymentRows, setPaymentRows] = useState([{ method: 'cash', amount: '' }]);
  const [settlement, setSettlement] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [splitOrder, setSplitOrder] = useState(null);
  const [refundOrder, setRefundOrder] = useState(null);
  const [refundList, setRefundList] = useState([]);
  const [voidQueue, setVoidQueue] = useState([]);
  const [promoCode, setPromoCode] = useState('');
  const [holdList, setHoldList] = useState([]);
  const [showRecall, setShowRecall] = useState(false);
  const [transferOrder, setTransferOrder] = useState(null);
  const [showMerge, setShowMerge] = useState(false);
  const [salesPersons, setSalesPersons] = useState([]);
  const [transferLog, setTransferLog] = useState([]);
  const [members, setMembers] = useState([]);
  const [memberPicker, setMemberPicker] = useState(null);   // null | 'page' | 订单对象
  const [payVouchers, setPayVouchers] = useState([]);   // [{ code, amount, voucherNo, maxRedeemable }]
  const [payRebate, setPayRebate] = useState('');       // 结账时抵扣的返利金额
  const [payMember, setPayMember] = useState(null);     // 正在结账的订单所属会员

  const activePage = pages.find((p) => p.id === activePageId) || pages[0];
  const cart = activePage?.cart || [];
  const discount = Number(activePage?.discount || 0);
  const grossTotal = cart.reduce((s, c) => s + c.unitPrice * c.qty, 0);
  const total = Math.max(0, grossTotal - discount);

  const loadTree = async () => {
    const r = await api.get('/menu/tree');
    setTree(r.data);
    if (!catId && r.data.categories[0]) setCatId(r.data.categories[0].id);
  };
  const loadTables = async () => { const r = await api.get('/tables'); setTables(r.data); };
  const loadActive = async () => { const r = await api.get('/orders?status=kitchen'); setActive(r.data); };
  const loadVoids = async () => { const r = await api.get('/orders?status=void_pending'); setVoidQueue(r.data); };
  const loadSalesPersons = async () => { const r = await api.get('/sales-persons'); setSalesPersons(r.data); };
  const loadMembers = async () => { try { const r = await api.get('/members'); setMembers(r.data); } catch { setMembers([]); } };
  const loadTransfers = async () => { const r = await api.get('/transfers'); setTransferLog(r.data.slice(0, 8)); };

  useEffect(() => {
    loadTree();
    loadTables();
    loadActive();
    loadVoids();
    loadSalesPersons();
    loadMembers();
    loadTransfers();
    const socketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || undefined;
    const socket = io(socketUrl, { auth: { token: localStorage.getItem('token') } });
    const receiveOrder = (order) => setActive((prev) => [order, ...prev.filter((o) => o._id !== order._id)]);
    socket.on('order:created', receiveOrder);
    socket.on('kds:ticket', receiveOrder);
    socket.on('order:closed', (id) => setActive((prev) => prev.filter((o) => o._id !== id)));
    socket.on('tables:changed', () => { loadTables(); loadTransfers(); });
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

  const applyDiscount = () => {
    if (!cart.length) return;
    const value = Number(prompt(`当前金额 ¥${grossTotal.toFixed(2)}，请输入折扣金额:`, String(discount || 0)));
    if (!Number.isFinite(value) || value < 0) return;
    setPages((prev) => prev.map((p) => p.id === activePageId ? { ...p, discount: Math.min(value, grossTotal) } : p));
  };
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

  // Send 只发送当前页面；若该页来自取单(已有 orderId)，先同步明细再送厨房，避免重复开单。
  const sendCurrentPage = async () => {
    if (!cart.length) return;
    if (mode === 'dine_in' && !tableId && !activePage.orderId) { alert('请选择桌台'); return; }
    let orderId = activePage.orderId;
    if (orderId) {
      await api.put(`/orders/${orderId}/items`, { items: cart, discount });
      if (activePage.salesPersonId) await api.put(`/orders/${orderId}/sales-person`, { salesPersonId: activePage.salesPersonId });
      if (activePage.memberId) await api.put(`/orders/${orderId}/member`, { memberId: activePage.memberId });
      await api.put(`/orders/${orderId}/status`, { status: 'kitchen' });
    } else {
      const r = await api.post('/orders', { type: mode, tableId: mode === 'dine_in' ? tableId : undefined, items: cart, discount, salesPersonId: activePage.salesPersonId || undefined, memberId: activePage.memberId || undefined });
      orderId = r.data._id;
      await api.put(`/orders/${orderId}/status`, { status: 'kitchen' });
    }
    const nextId = pages.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    setPages((prev) => [...prev.map((p) => p.id === activePageId ? { ...p, status: 'sent', orderId, label: `${p.label.replace(/ · (Held|Recall.*)$/, '')} · Sent` } : p), newPage(nextId)]);
    setActivePageId(nextId);
    setTableId('');
    loadActive();
    loadTables();
  };

  // 挂单：把当前页存为 hold，不送厨房
  const holdCurrentPage = async () => {
    if (!cart.length) { alert('当前页面没有点单'); return; }
    const label = `${tableId ? `T${tableId} ` : ''}${cart.reduce((s, c) => s + c.qty, 0)} items`;
    const r = await api.post('/orders', { type: mode, tableId: mode === 'dine_in' ? tableId : undefined, items: cart, discount, hold: true, holdLabel: label, memberId: activePage.memberId || undefined });
    const nextId = pages.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    setPages((prev) => [...prev.map((p) => p.id === activePageId ? { ...p, status: 'held', orderId: r.data._id, label: `${p.label} · Held` } : p), newPage(nextId)]);
    setActivePageId(nextId);
    setTableId('');
    loadTables();
  };
  const openRecall = async () => { const r = await api.get('/holds'); setHoldList(r.data); setShowRecall(true); };
  const recallOrder = async (o) => {
    await api.post(`/orders/${o._id}/recall`, {});
    const id = pages.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    setPages((prev) => [...prev, {
      ...newPage(id), label: `Recall ${o.orderNo}`, orderId: o._id, discount: Number(o.discount || 0),
      cart: o.items.map((i) => ({ variantId: i.variantId || i.itemId, code: i.code, name: i.name, unitPrice: Number(i.unitPrice), qty: Number(i.qty) })),
    }]);
    setActivePageId(id);
    setShowRecall(false);
    if (o.tableId) setTableId(String(o.tableId));
    loadTables();
  };

  const openPayment = (order) => {
    setPaymentOrder(order);
    setPaymentRows([{ method: 'cash', amount: String(Number(order.total).toFixed(2)) }]);
    setPayVouchers([]);
    setPayRebate('');
    // 返利只能用于会员单:结账时把订单所属会员查出来,顺便刷新返利余额。
    const m = order.memberId ? members.find((x) => String(x.id) === String(order.memberId)) : null;
    setPayMember(m || null);
  };
  const confirmPayment = (rows) => {
    if (!paymentOrder) return;
    const cleanRows = rows.filter((row) => Number(row.amount) > 0).map((row) => ({ ...row, amount: Number(row.amount) }));
    const tendered = cleanRows.reduce((sum, row) => sum + row.amount, 0);
    const deduction = payVouchers.reduce((s, v) => s + Number(v.amount || 0), 0) + Number(payRebate || 0);
    const due = Math.max(0, Number((Number(paymentOrder.total) - deduction).toFixed(2)));
    if (!Number.isFinite(tendered) || tendered < due) { alert(`付款总额不足，抵扣后应付 ¥${due.toFixed(2)}`); return; }
    // Payment 这里只确认金额；真正 checkout/扣库存/释放桌位在 Settlement 完成时执行。
    setPaymentOrder(null);
    setSettlement({
      order: paymentOrder, rows: cleanRows, tendered, due,
      vouchers: payVouchers, rebateAmount: Number(payRebate || 0),
      deduction, change: Number((tendered - due).toFixed(2)),
    });
  };
  const completeSettlement = async () => {
    if (!settlement) return;
    const result = await api.post(`/orders/${settlement.order._id}/checkout`, {
      payments: settlement.rows, tip: 0,
      vouchers: settlement.vouchers.map((v) => ({ code: v.code, amount: Number(v.amount) })),
      rebateAmount: settlement.rebateAmount || 0,
    });
    setReceipt(result.data.receipt);
    setSettlement(null);
    setPayVouchers([]);
    setPayRebate('');
    setPayMember(null);
    loadActive();
    loadTables();
    loadMembers();
  };
  const requestVoid = async (o) => { const reason = prompt('取消原因(需主管审批):'); if (!reason) return; await api.post(`/orders/${o._id}/void`, { reason }); loadActive(); loadVoids(); };
  const approveVoid = async (o) => { if (!window.confirm(`批准取消 ${o.orderNo}?`)) return; await api.post(`/orders/${o._id}/void/approve`, {}); loadVoids(); loadActive(); loadTables(); };
  const rejectVoid = async (o) => { const reason = prompt('拒绝原因:', 'supervisor rejected'); if (reason == null) return; await api.post(`/orders/${o._id}/void/reject`, { reason }); loadVoids(); loadActive(); };
  const openDrawer = async () => { try { await api.post('/hardware/drawer', {}); alert('钱箱已弹出（ESC/POS 指令已发送）'); } catch { alert('钱箱指令发送失败'); } };
  const printOrder = async (o, target = 'receipt') => { try { const r = await api.post('/hardware/print', { target, orderId: o._id }); alert(`${target} 打印已排队\n\n${r.data.escpos}`); } catch { alert('打印失败'); } };
  const applyPromo = async () => {
    if (!promoCode || !cart.length) return;
    try {
      const r = await api.get(`/promotions/apply?code=${encodeURIComponent(promoCode)}&amount=${grossTotal}`);
      setPages((prev) => prev.map((p) => p.id === activePageId ? { ...p, discount: r.data.discount } : p));
      setPromoCode('');
      alert(`已应用 ${r.data.code}，折扣 ¥${r.data.discount.toFixed(2)}`);
    } catch (e) { alert(e.response?.data?.error || '促销码无效'); }
  };
  const doSplit = async (payload) => {
    if (!splitOrder) return;
    await api.post(`/orders/${splitOrder._id}/split`, payload);
    setSplitOrder(null);
    loadActive(); loadTables();
  };
  const doRefund = async (payload) => {
    if (!refundOrder) return;
    const r = await api.post(`/orders/${refundOrder._id}/refund`, payload);
    setRefundOrder(null);
    alert(`退款完成 ¥${Number(r.data.refund.amount).toFixed(2)}`);
    loadActive();
  };
  const openRefundPicker = async () => {
    const r = await api.get('/orders?status=paid');
    setRefundList(r.data);
    setRefundOrder(r.data[0] || null);
  };

  // ---- 转台 / 并台 / 销售员 ----
  const doTransfer = async (tableId) => {
    if (!transferOrder) return;
    try {
      const r = await api.post(`/orders/${transferOrder._id}/transfer`, { tableId, reason: 'cashier transfer' });
      setTransferOrder(null);
      const t = tables.find((x) => String(x.id) === String(tableId));
      alert(`已转到桌位 ${t ? t.number : tableId}`);
      loadActive(); loadTables(); loadTransfers();
      return r.data;
    } catch (e) { alert(e.response?.data?.error || '转台失败'); }
  };
  const doMerge = async (orderIds) => {
    try {
      const r = await api.post('/orders/merge', { orderIds, targetOrderId: orderIds[0], reason: 'cashier merge' });
      setShowMerge(false);
      alert(`已合并 ${orderIds.length} 张单 → ${r.data.order.orderNo}\n合计 ¥${Number(r.data.order.total).toFixed(2)}`);
      loadActive(); loadTables(); loadTransfers();
    } catch (e) { alert(e.response?.data?.error || '并台失败'); }
  };
  const setSalesPerson = async (id) => {
    setPages((prev) => prev.map((p) => p.id === activePageId ? { ...p, salesPersonId: id } : p));
    if (activePage.orderId) {
      try { await api.put(`/orders/${activePage.orderId}/sales-person`, { salesPersonId: id || null }); } catch { /* 静默失败,下次 Send 会带上 */ }
    }
  };
  const setMember = async (m) => {
    const id = m ? String(m.id) : '';
    const label = m ? `${m.memberNo} · ${m.name}` : '';
    setPages((prev) => prev.map((p) => p.id === activePageId ? { ...p, memberId: id, memberLabel: label } : p));
    setMemberPicker(null);
    if (activePage.orderId) {
      try { await api.put(`/orders/${activePage.orderId}/member`, { memberId: id || null }); await loadActive(); } catch (e) { alert(e.response?.data?.error || '会员绑定失败'); }
    }
  };
  // 已送厨房的订单:Send 之后当前编辑页会切到新页,所以会员要直接挂到那一张单上,
  // 否则 Payment 读到的订单 memberId 还是空的,返利抵扣就用不了。
  const bindMemberToOrder = async (m) => {
    const target = memberPicker;
    if (!target || target === 'page') return;
    try {
      await api.put(`/orders/${target._id}/member`, { memberId: m ? String(m.id) : null });
      setMemberPicker(null);
      await loadActive();
    } catch (e) { alert(e.response?.data?.error || '会员绑定失败'); }
  };
  const tableLabel = (id) => { const t = tables.find((x) => String(x.id) === String(id)); return t ? t.number : (id ? `#${id}` : '—'); };

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
          {can('order.discount') && <button onClick={applyDiscount}>Pre-Disc</button>}
          <button onClick={() => { updateActiveCart(() => []); setPages((prev) => prev.map((p) => p.id === activePageId ? { ...p, discount: 0 } : p)); }}>Void</button>
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
          <div className="cashier-promo"><input placeholder="Promo code" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} /><button onClick={applyPromo}>Apply</button></div>
          <div className="cashier-salesperson">
            <span>Sales Person</span>
            <select value={activePage.salesPersonId || ''} onChange={(e) => setSalesPerson(e.target.value)}>
              <option value="">—</option>
              {salesPersons.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div className="cashier-totals"><div>Pax: {cart.reduce((s, c) => s + c.qty, 0)} {discount > 0 && <span> · Discount −¥{discount.toFixed(2)}</span>}{tableId && <span> · Table {tableLabel(tableId)}</span>}{activePage.memberLabel && <span> · Member {activePage.memberLabel}</span>}</div><strong>Total: ¥{total.toFixed(2)}</strong></div>
          <div className="cashier-keypad">{['Enter', '7', '8', '9', 'Back', '4', '5', '6', 'Up', '1', '2', '3', 'Down', '0', '.', 'Clear'].map((n) => <button key={n}>{n}</button>)}</div>
        </div>
      </div>

      <div className="cashier-footer">
        <button onClick={() => { const n = prompt('选择桌号', tableId); if (n) setTableId(n); }}>Table</button>
        <button onClick={() => setMemberPicker('page')}>Member{activePage.memberLabel ? ` · ${activePage.memberLabel}` : ''}</button>
        <button onClick={() => printOrder(active[0] || { _id: '' }, 'receipt')}>Request</button>
        {can('payment.refund') && <button onClick={openRefundPicker}>Refund</button>}
        <button onClick={sendCurrentPage}>Send</button>
        {can('order.hold') && <button onClick={holdCurrentPage}>Hold</button>}
        {can('order.hold') && <button onClick={openRecall}>Recall</button>}
        <button onClick={createPage}>Order</button>
        <button onClick={() => updateActiveCart(() => [])}>Delete All</button>
        {can('order.discount') && <button onClick={applyDiscount}>Discount</button>}
        {can('order.edit_price') && <button onClick={() => { const n = prompt('Open item 名称'); const p = prompt('金额'); if (n && p) updateActiveCart((prev) => [...prev, { variantId: `open-${Date.now()}`, code: 'OPEN', name: n, unitPrice: Number(p), qty: 1 }]); }}>Open Item</button>}
        <button onClick={() => active.length ? openPayment(active[0]) : alert('请先 Send 一个订单')}>Payment</button>
        {can('order.split') && <button onClick={() => active.length ? setSplitOrder(active[0]) : alert('请先 Send 一个订单')}>Split</button>}
        {can('order.transfer') && <button onClick={() => active.length ? setTransferOrder(active[0]) : alert('请先 Send 一个订单')}>Transfer</button>}
        {can('order.merge') && <button onClick={() => active.length ? setShowMerge(true) : alert('没有可合并的订单')}>Merge</button>}
        <button onClick={() => active.length ? printOrder(active[0]) : alert('请先 Send 一个订单')}>PBill</button>
        {can('payment.open_drawer') && <button onClick={openDrawer}>Drawer</button>}
        <button onClick={() => history.back()}>Exit</button>
      </div>

      <div className="cashier-orders-strip">
        <h3>收银端待处理订单 / Kitchen 已收到</h3>
        <div className="cashier-open-orders">
          {active.map((o) => <div key={o._id} className="cashier-open-card"><b>{o.orderNo}</b> · ¥{o.total}<br />{o.items.reduce((s, i) => s + i.qty, 0)} items
            <small className="cashier-open-meta">Table {tableLabel(o.tableId)}{o.salesPersonId ? ` · ${(salesPersons.find((u) => String(u.id) === String(o.salesPersonId)) || {}).name || ''}` : ''}{o.memberId ? ` · ${(members.find((m) => String(m.id) === String(o.memberId)) || {}).memberNo || 'Member'}` : ''}</small>
            <button onClick={() => openPayment(o)}>Payment</button>
            <button onClick={() => setMemberPicker(o)}>Member</button>
            {can('order.split') && <button onClick={() => setSplitOrder(o)}>Split</button>}
            {can('order.transfer') && <button onClick={() => setTransferOrder(o)}>Transfer</button>}
            <button onClick={() => printOrder(o)}>Print</button>
            {can('order.void') && <button onClick={() => requestVoid(o)}>Void</button>}
          </div>)}
          {!active.length && <span className="text-slate-500 text-xs">Send 后订单会立即显示在这里</span>}
        </div>
      </div>

      {transferLog.length > 0 && (
        <div className="cashier-transfer-log">
          <h3>转台 / 并台记录 Table Transfer &amp; Merge</h3>
          <div className="transfer-log-list">
            {transferLog.map((t) => <div key={t.id} className={`transfer-log-row ${t.type}`}>
              <b>{t.type === 'merge' ? '并台' : '转台'}</b>
              <span>{t.orderNo}</span>
              <span>{t.type === 'merge' ? `${(t.mergedOrderNos || []).length} 张并入` : `${t.fromTableNo || '—'} → ${t.toTableNo || '—'}`}</span>
              <span>¥{Number(t.amount || 0).toFixed(2)}</span>
              <small>{t.createdByName || ''} · {new Date(t.createdAt).toLocaleTimeString('en-GB')}</small>
            </div>)}
          </div>
        </div>
      )}

      {voidQueue.length > 0 && (
        <div className="cashier-void-queue">
          <h3>待审批取消 Void Approval ({voidQueue.length})</h3>
          <div className="cashier-open-orders">
            {voidQueue.map((o) => <div key={o._id} className="cashier-open-card void">
              <b>{o.orderNo}</b> · ¥{o.total}<br />
              <small>原因: {o.voidReason || '-'}</small>
              {can('order.void_approve') ? <>
                <button onClick={() => approveVoid(o)}>Approve</button>
                <button onClick={() => rejectVoid(o)}>Reject</button>
              </> : <small className="cashier-void-locked">需要主管权限审批</small>}
            </div>)}
          </div>
        </div>
      )}

      {paymentOrder && <PaymentModal order={paymentOrder} rows={paymentRows} setRows={setPaymentRows} onConfirm={confirmPayment} onClose={() => setPaymentOrder(null)} vouchers={payVouchers} setVouchers={setPayVouchers} rebate={payRebate} setRebate={setPayRebate} member={payMember} />}
      {settlement && <SettlementModal settlement={settlement} onComplete={completeSettlement} onClose={() => setSettlement(null)} />}
      {memberPicker && <MemberPickerModal members={members} current={memberPicker === 'page' ? activePage.memberId : memberPicker.memberId} onPick={memberPicker === 'page' ? setMember : bindMemberToOrder} onClose={() => setMemberPicker(null)} />}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
      {splitOrder && <SplitBillModal order={splitOrder} onConfirm={doSplit} onClose={() => setSplitOrder(null)} />}
      {refundOrder && <RefundModal order={refundOrder} orders={refundList} onPick={setRefundOrder} onConfirm={doRefund} onClose={() => setRefundOrder(null)} />}
      {showRecall && <RecallModal holds={holdList} onPick={recallOrder} onClose={() => setShowRecall(false)} />}
      {transferOrder && <TransferModal order={transferOrder} tables={tables} onConfirm={doTransfer} onClose={() => setTransferOrder(null)} />}
      {showMerge && <MergeModal orders={active} tables={tables} onConfirm={doMerge} onClose={() => setShowMerge(false)} />}
    </div>
  );
}

function TransferModal({ order, tables, onConfirm, onClose }) {
  const [pick, setPick] = useState('');
  const free = tables.filter((t) => t.status === 'free');
  const current = tables.find((t) => String(t.id) === String(order.tableId));
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window" style={{ width: 480 }}>
    <header><span>Transfer Table · {order.orderNo}</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      <div className="payment-amount-box"><small>CURRENT TABLE</small><strong>{current ? current.number : '—'}</strong></div>
      <p className="settlement-note">选择要转去的空闲桌位，原桌位会自动释放。</p>
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

function MergeModal({ orders, tables, onConfirm, onClose }) {
  const [picks, setPicks] = useState([]);
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const tableNo = (id) => (tables.find((t) => String(t.id) === String(id)) || {}).number || '—';
  const toggle = (id) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const sum = orders.filter((o) => picks.includes(o._id)).reduce((s, o) => s + Number(o.total), 0);
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window" style={{ width: 540 }}>
    <header><span>Merge Tables / 并台</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      <p className="settlement-note">勾选要合并的订单。列表第一张作为主单，其余订单的菜品并入主单并释放其桌位。</p>
      <div className="split-items">
        {orders.map((o) => <label key={o._id} className={`merge-row ${picks.includes(o._id) ? 'active' : ''}`}>
          <input type="checkbox" checked={picks.includes(o._id)} onChange={() => toggle(o._id)} />
          <span><b>{o.orderNo}</b> · {o.items.reduce((s, i) => s + Number(i.qty), 0)} items · {money(o.total)}</span>
          <small>Table {tableNo(o.tableId)}</small>
        </label>)}
        {!orders.length && <div className="ops-empty">没有可合并的进行中订单</div>}
      </div>
      <div className="payment-change">Selected <strong>{picks.length}</strong></div>
      <div className="payment-change">Combined Total <strong>{money(sum)}</strong></div>
      <div className="legacy-window-actions">
        <button className="legacy-btn green" disabled={picks.length < 2} onClick={() => onConfirm(picks)}>Merge {picks.length} Orders</button>
        <button className="legacy-btn pink" onClick={onClose}>Cancel</button>
      </div>
    </div>
  </section></div>;
}

function RecallModal({ holds, onPick, onClose }) {
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window" style={{ width: 520 }}>
    <header><span>Recall · 挂单取单 ({holds.length})</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      {!holds.length && <div className="ops-empty">没有挂单记录</div>}
      <div className="recall-list">
        {holds.map((o) => <div key={o._id} className="recall-row">
          <div><b>{o.holdLabel || o.orderNo}</b><small>{o.orderNo} · {o.items.reduce((s, i) => s + Number(i.qty), 0)} items · ¥{Number(o.total).toFixed(2)}</small></div>
          <button className="legacy-btn green" onClick={() => onPick(o)}>Recall</button>
        </div>)}
      </div>
      <div className="legacy-window-actions"><button className="legacy-btn pink" onClick={onClose}>Close</button></div>
    </div>
  </section></div>;
}

function PaymentModal({ order, rows, setRows, onConfirm, onClose, vouchers, setVouchers, rebate, setRebate, member }) {
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const tendered = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const voucherTotal = vouchers.reduce((s, v) => s + Number(v.amount || 0), 0);
  const rebateAmt = Number(rebate || 0);
  const deduction = Math.min(Number(order.total), voucherTotal + rebateAmt);
  const due = Math.max(0, Number((Number(order.total) - deduction).toFixed(2)));
  const change = Math.max(0, Number((tendered - due).toFixed(2)));
  const updateRow = (index, patch) => setRows(rows.map((row, i) => i === index ? { ...row, ...patch } : row));

  const addVoucher = async () => {
    const c = code.trim();
    if (!c) { alert('请输入礼券码'); return; }
    if (vouchers.some((x) => x.code.toUpperCase() === c.toUpperCase())) { alert('该礼券已添加'); return; }
    setBusy(true);
    try {
      const want = Number(amount || 0);
      const r = await api.get(`/vouchers/lookup?code=${encodeURIComponent(c)}${want > 0 ? `&amount=${want}` : ''}`);
      const v = r.data;
      if (!v.redeemable) { alert(`礼券 ${c} 不可用（${v.status}）`); return; }
      const max = Number(v.maxRedeemable || 0);
      const remaining = Math.max(0, Number((Number(order.total) - voucherTotal - rebateAmt).toFixed(2)));
      let amt = want > 0 ? want : Math.min(max, remaining);
      if (amt > max) { alert(`礼券余额仅 ${money(max)}，已按余额抵扣`); amt = max; }
      if (amt > remaining) amt = remaining;
      amt = Number(amt.toFixed(2));
      if (!(amt > 0)) { alert('抵扣金额必须大于 0'); return; }
      setVouchers([...vouchers, { code: v.voucher.code, amount: amt, voucherNo: v.voucher.voucherNo, maxRedeemable: max }]);
      setCode(''); setAmount('');
    } catch (e) { alert(e.response?.data?.error || '礼券无效'); }
    finally { setBusy(false); }
  };
  const removeVoucher = (i) => setVouchers(vouchers.filter((_, idx) => idx !== i));
  const rebateMax = Number(member?.rebateBalance || 0);
  const onRebate = (val) => {
    let n = Number(val || 0);
    if (!Number.isFinite(n) || n < 0) n = 0;
    const remaining = Math.max(0, Number((Number(order.total) - voucherTotal).toFixed(2)));
    if (n > rebateMax) { alert(`返利余额仅 ${money(rebateMax)}`); n = rebateMax; }
    if (n > remaining) n = remaining;
    setRebate(val === '' ? '' : String(Number(n.toFixed(2))));
  };

  return <div className="legacy-window-wrap"><section className="legacy-window payment-window"><header><span>Payment · {order.orderNo}</span><button onClick={onClose}>×</button></header><div className="legacy-window-body">
    <div className="payment-amount-box"><small>AMOUNT DUE</small><strong>{money(due)}</strong>{deduction > 0 && <em className="payment-due-note">原价 {money(order.total)} − 抵扣 {money(deduction)}</em>}</div>

    <div className="payment-deduction-block">
      <div className="payment-deduction-head">Gift Voucher / Rebate 礼券与返利抵扣</div>
      <div className="payment-voucher-add">
        <input placeholder="Voucher code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addVoucher()} />
        <input type="number" min="0" step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="mini-action" disabled={busy} onClick={addVoucher}>{busy ? '…' : 'Add'}</button>
      </div>
      {vouchers.map((v, i) => <div className="payment-deduction-row" key={v.code}><span>{v.voucherNo} · {v.code}</span><b>−{money(v.amount)}</b><button className="mini-action danger" onClick={() => removeVoucher(i)}>×</button></div>)}
      <div className="payment-rebate-row">
        <span>Member Rebate{member ? ` · ${member.memberNo} ${member.name}` : ''}</span>
        {member
          ? <><input type="number" min="0" step="0.01" placeholder="0.00" value={rebate} onChange={(e) => onRebate(e.target.value)} /><small>可用 {money(rebateMax)}</small></>
          : <small className="payment-rebate-off">此单未绑定会员，无法使用返利</small>}
      </div>
      {deduction > 0 && <div className="payment-change">Total Deduction <strong>−{money(deduction)}</strong></div>}
    </div>

    {rows.map((row, index) => <div className="payment-field" key={index}><label>Payment Type<select value={row.method} onChange={(e) => updateRow(index, { method: e.target.value })}><option value="cash">Cash</option><option value="card">Card</option><option value="tab">Credit / Account</option><option value="cheque">Cheque</option></select></label><label>Amount<input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => updateRow(index, { amount: e.target.value })} /></label></div>)}<button className="payment-add-row" onClick={() => setRows([...rows, { method: 'card', amount: '' }])}>+ Split Payment</button><div className="payment-change">Total Tendered <strong>{money(tendered)}</strong></div><div className="payment-change">Change <strong>{money(change)}</strong></div><div className="payment-denoms">{[1, 5, 10, 20, 50, 100].map((n) => <button key={n} onClick={() => updateRow(0, { amount: String(n) })}>¥{n}</button>)}<button className="payment-exact" onClick={() => updateRow(0, { amount: due.toFixed(2) })}>Exact Due</button></div><div className="legacy-window-actions"><button className="legacy-btn green" onClick={() => onConfirm(rows)}>Confirm Payment</button><button className="legacy-btn pink" onClick={onClose}>Cancel</button></div></div></section></div>;
}

function SettlementModal({ settlement, onComplete, onClose }) {
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const { vouchers = [], rebateAmount = 0, deduction = 0 } = settlement;
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window"><header><span>Settlement · Complete Sale</span><button onClick={onClose}>×</button></header><div className="legacy-window-body"><div className="settlement-success">Payment recorded</div><div className="settlement-summary"><div><span>Order</span><strong>{settlement.order.orderNo}</strong></div><div><span>Amount Due</span><strong>{money(settlement.due ?? settlement.order.total)}</strong></div>{deduction > 0 && <div><span>Deduction</span><strong>−{money(deduction)}</strong></div>}{vouchers.map((v) => <div key={v.code}><span>Voucher {v.code}</span><strong>−{money(v.amount)}</strong></div>)}{rebateAmount > 0 && <div><span>Member Rebate</span><strong>−{money(rebateAmount)}</strong></div>}<div><span>Tendered</span><strong>{money(settlement.tendered)}</strong></div><div><span>Change</span><strong className="change-value">{money(settlement.change)}</strong></div><div><span>Payment Type</span><strong>{settlement.rows.map((row) => `${row.method}: ${money(row.amount)}`).join(' + ')}</strong></div></div><p className="settlement-note">确认 Settlement 后，这张单会完成结算、核销礼券与返利、扣减库存、释放桌位并可打印小票。</p><div className="legacy-window-actions"><button className="legacy-btn green" onClick={onComplete}>Complete Settlement</button><button className="legacy-btn pink" onClick={onClose}>Back</button></div></div></section></div>;
}

function MemberPickerModal({ members, current, onPick, onClose }) {
  const [kw, setKw] = useState('');
  const list = members.filter((m) => {
    const k = kw.trim().toLowerCase();
    if (!k) return true;
    return `${m.memberNo} ${m.name} ${m.phone || ''}`.toLowerCase().includes(k);
  }).slice(0, 40);
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window" style={{ width: 520 }}>
    <header><span>Member · 会员绑定</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      <div className="payment-field"><label>Search<input placeholder="Member No. / 姓名 / 电话" value={kw} onChange={(e) => setKw(e.target.value)} /></label></div>
      <div className="recall-list">
        {list.map((m) => <div key={m.id} className={`recall-row ${String(m.id) === String(current) ? 'active' : ''}`}>
          <div><b>{m.memberNo} · {m.name}</b><small>{m.phone || '-'} · 积分 {Number(m.points || 0)} · 返利 {`¥${Number(m.rebateBalance || 0).toFixed(2)}`} · 储值 {`¥${Number(m.creditBalance || 0).toFixed(2)}`}</small></div>
          <button className="legacy-btn green" onClick={() => onPick(m)}>{String(m.id) === String(current) ? 'Current' : 'Select'}</button>
        </div>)}
        {!list.length && <div className="ops-empty">没有匹配的会员</div>}
      </div>
      <div className="legacy-window-actions"><button className="legacy-btn pink" onClick={() => onPick(null)}>Clear Member</button><button className="legacy-btn pink" onClick={onClose}>Close</button></div>
    </div>
  </section></div>;
}

function ReceiptModal({ receipt, onClose }) {
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const print = () => {
    const w = window.open('', '_blank');
    const rows = receipt.items.map((i) => `<div>${i.qty} x ${i.name} ...... ${money(i.unitPrice * i.qty)}</div>`).join('');
    w.document.write(`<html><body style="font-family:monospace;width:300px;padding:10px"><h3>${receipt.storeName}</h3><div>${receipt.address || ''}</div><div>GST: ${receipt.gstNo || '-'}</div><div>Invoice: ${receipt.invoiceNo || receipt.orderNo}</div><hr/>${rows}<hr/>${receipt.discount ? `<div>Discount -${money(receipt.discount)}</div>` : ''}${receipt.serviceCharge ? `<div>Service ${money(receipt.serviceCharge)}</div>` : ''}<div>Subtotal ${money(receipt.subtotal)}</div><div>GST ${receipt.taxRate || 0}% ${money(receipt.tax)}</div><b>Total ${money(receipt.total)}</b>${receipt.voucherDiscount ? `<div>Voucher/Rebate -${money(receipt.voucherDiscount)}</div><b>Amount Paid ${money(Number(receipt.total || 0) - Number(receipt.voucherDiscount || 0))}</b>` : ''}${receipt.rebateEarned ? `<div>Rebate Earned ${money(receipt.rebateEarned)}</div>` : ''}<hr/><div>${receipt.footer || ''}</div></body></html>`);
    w.document.close(); w.print();
  };
  return <div className="legacy-window-wrap"><section className="legacy-window receipt-window" style={{ width: 340 }}><header><span>Receipt / Tax Invoice</span><button onClick={onClose}>×</button></header><div className="legacy-window-body">
    <h2>{receipt.storeName}</h2>
    {receipt.address && <div className="receipt-sub">{receipt.address}</div>}
    {receipt.gstNo && <div className="receipt-sub">GST No: {receipt.gstNo}</div>}
    <div className="receipt-sub">Invoice: {receipt.invoiceNo || '-'} · Bill: {receipt.orderNo}</div>
    <hr />
    {receipt.items.map((i, idx) => <div key={idx} className="flex justify-between"><span>{i.qty}x{i.name}</span><span>{money(i.unitPrice * i.qty)}</span></div>)}
    <hr />
    {receipt.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{money(receipt.discount)}</span></div>}
    {receipt.serviceCharge > 0 && <div className="flex justify-between"><span>Service Charge</span><span>{money(receipt.serviceCharge)}</span></div>}
    <div className="flex justify-between"><span>Subtotal</span><span>{money(receipt.subtotal)}</span></div>
    <div className="flex justify-between"><span>GST {receipt.taxRate || 0}%{receipt.taxInclusive ? ' (incl.)' : ''}</span><span>{money(receipt.tax)}</span></div>
    <div className="flex justify-between font-bold"><span>Total</span><span>{money(receipt.total)}</span></div>
    {receipt.voucherDiscount > 0 && <div className="flex justify-between"><span>Voucher / Rebate</span><span>-{money(receipt.voucherDiscount)}</span></div>}
    {receipt.voucherDiscount > 0 && <div className="flex justify-between font-bold"><span>Amount Paid</span><span>{money(Number(receipt.total || 0) - Number(receipt.voucherDiscount || 0))}</span></div>}
    {receipt.rebateEarned > 0 && <div className="flex justify-between"><span>Rebate Earned</span><span>{money(receipt.rebateEarned)}</span></div>}
    <div className="legacy-window-actions"><button className="legacy-btn green" onClick={print}>Print</button><button className="legacy-btn pink" onClick={onClose}>Exit</button></div>
  </div></section></div>;
}

function SplitBillModal({ order, onConfirm, onClose }) {
  const [mode, setMode] = useState('item');
  const [pax, setPax] = useState(2);
  const [parts, setParts] = useState(2);
  const [assign, setAssign] = useState(order.items.map(() => 0)); // 每个 item 属于第几组
  const [groupCount, setGroupCount] = useState(2);
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const submit = () => {
    if (mode === 'item') {
      const groups = Array.from({ length: groupCount }, () => []);
      order.items.forEach((it, i) => groups[assign[i] || 0].push(i));
      const cleaned = groups.filter((g) => g.length);
      if (cleaned.length < 2) { alert('至少需要分成 2 组'); return; }
      onConfirm({ mode: 'item', groups: cleaned });
    } else if (mode === 'pax') onConfirm({ mode: 'pax', pax: Number(pax) });
    else onConfirm({ mode: 'equal', parts: Number(parts) });
  };
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window" style={{ width: 520 }}>
    <header><span>Split Bill · {order.orderNo} · {money(order.total)}</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      <div className="split-mode-tabs">
        <button className={mode === 'item' ? 'active' : ''} onClick={() => setMode('item')}>By Item 按菜品</button>
        <button className={mode === 'pax' ? 'active' : ''} onClick={() => setMode('pax')}>By Pax 按人数</button>
        <button className={mode === 'equal' ? 'active' : ''} onClick={() => setMode('equal')}>Equal 均分</button>
      </div>
      {mode === 'item' && <div className="split-items">
        <div className="split-group-count">分成 <input type="number" min="2" max="8" value={groupCount} onChange={(e) => setGroupCount(Math.max(2, Number(e.target.value)))} /> 组</div>
        {order.items.map((it, i) => <div key={i} className="split-item-row"><span>{it.qty}x {it.name}</span><select value={assign[i] || 0} onChange={(e) => setAssign((prev) => prev.map((v, idx) => idx === i ? Number(e.target.value) : v))}>{Array.from({ length: groupCount }, (_, g) => <option key={g} value={g}>Group {g + 1}</option>)}</select></div>)}
      </div>}
      {mode === 'pax' && <div className="split-param"><label>人数 Pax<input type="number" min="2" max="20" value={pax} onChange={(e) => setPax(e.target.value)} /></label><p>系统会把菜品轮流分配到 {pax} 张子单。</p></div>}
      {mode === 'equal' && <div className="split-param"><label>均分份数<input type="number" min="2" max="20" value={parts} onChange={(e) => setParts(e.target.value)} /></label><p>每份约 {money(Number(order.total) / (Number(parts) || 1))}</p></div>}
      <div className="legacy-window-actions"><button className="legacy-btn green" onClick={submit}>Create Split Bills</button><button className="legacy-btn pink" onClick={onClose}>Cancel</button></div>
    </div>
  </section></div>;
}

function RefundModal({ order, orders, onPick, onConfirm, onClose }) {
  const [mode, setMode] = useState('full');
  const [reason, setReason] = useState('customer refund');
  const [method, setMethod] = useState('cash');
  const [restock, setRestock] = useState(true);
  const [picked, setPicked] = useState(order.items.map(() => 0));
  const [amount, setAmount] = useState('');
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const partialTotal = order.items.reduce((s, it, i) => s + Number(it.unitPrice) * Number(picked[i] || 0), 0);
  const submit = () => {
    if (mode === 'full') onConfirm({ amount: Number(order.total) - Number(order.refundedAmount || 0), reason, method, restock });
    else if (mode === 'items') {
      const items = order.items.map((it, i) => ({ index: i, qty: Number(picked[i] || 0) })).filter((x) => x.qty > 0);
      if (!items.length) { alert('请选择要退的菜品数量'); return; }
      onConfirm({ items, reason, method, restock });
    } else onConfirm({ amount: Number(amount), reason, method, restock });
  };
  return <div className="legacy-window-wrap"><section className="legacy-window payment-window" style={{ width: 540 }}>
    <header><span>Refund · {order.orderNo}</span><button onClick={onClose}>×</button></header>
    <div className="legacy-window-body">
      {orders.length > 1 && <label className="ops-field"><span>选择已付款订单</span><select value={order._id} onChange={(e) => onPick(orders.find((o) => o._id === e.target.value))}>{orders.map((o) => <option key={o._id} value={o._id}>{o.orderNo} · {money(o.total)}</option>)}</select></label>}
      <div className="split-mode-tabs">
        <button className={mode === 'full' ? 'active' : ''} onClick={() => setMode('full')}>Full 全额</button>
        <button className={mode === 'items' ? 'active' : ''} onClick={() => setMode('items')}>By Item 按菜品</button>
        <button className={mode === 'amount' ? 'active' : ''} onClick={() => setMode('amount')}>Amount 指定金额</button>
      </div>
      {mode === 'full' && <div className="payment-amount-box"><small>REFUND AMOUNT</small><strong>{money(Number(order.total) - Number(order.refundedAmount || 0))}</strong></div>}
      {mode === 'items' && <div className="split-items">{order.items.map((it, i) => <div key={i} className="split-item-row"><span>{it.name} · {money(it.unitPrice)}</span><input type="number" min="0" max={it.qty} value={picked[i] || 0} onChange={(e) => setPicked((prev) => prev.map((v, idx) => idx === i ? Math.min(it.qty, Math.max(0, Number(e.target.value))) : v))} /></div>)}<div className="split-param"><p>退款小计 {money(partialTotal)}</p></div></div>}
      {mode === 'amount' && <div className="split-param"><label>退款金额<input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></label></div>}
      <div className="payment-field"><label>退款方式<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="tab">Credit / Account</option><option value="cheque">Cheque</option></select></label><label>原因<input value={reason} onChange={(e) => setReason(e.target.value)} /></label></div>
      <label className="ops-checkbox"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> 退回库存 Restock</label>
      <div className="legacy-window-actions"><button className="legacy-btn green" onClick={submit}>Confirm Refund</button><button className="legacy-btn pink" onClick={onClose}>Cancel</button></div>
    </div>
  </section></div>;
}
