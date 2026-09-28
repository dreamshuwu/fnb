import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function CashierPage() {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [tables, setTables] = useState([]);
  const [active, setActive] = useState([]);
  const [mode, setMode] = useState('dine_in');
  const [tableId, setTableId] = useState('');
  const [cart, setCart] = useState([]);
  const [receipt, setReceipt] = useState(null);

  const loadMenu = async () => {
    const [c, it] = await Promise.all([api.get('/menu/categories'), api.get('/menu/items')]);
    setCats(c.data);
    setItems(it.data);
  };
  const loadTables = async () => {
    const r = await api.get('/tables');
    setTables(r.data);
  };
  const loadActive = async () => {
    const r = await api.get('/orders?status=kitchen');
    setActive(r.data);
  };
  useEffect(() => {
    loadMenu();
    loadTables();
    loadActive();
  }, []);

  const addToCart = (it) => {
    setCart((prev) => {
      const f = prev.find((c) => c.itemId === it._id && !c.note);
      if (f) {
        return prev.map((c) =>
          c.itemId === it._id && !c.note ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, { itemId: it._id, name: it.name, unitPrice: it.price, qty: 1, modifiers: [], note: '' }];
    });
  };
  const changeQty = (idx, d) =>
    setCart((prev) =>
      prev
        .map((c, i) => (i === idx ? { ...c, qty: Math.max(0, c.qty + d) } : c))
        .filter((c) => c.qty > 0)
    );
  const total = cart.reduce((s, c) => s + c.unitPrice * c.qty, 0);

  const submit = async () => {
    if (!cart.length) return;
    if (mode === 'dine_in' && !tableId) {
      alert('请选择桌台');
      return;
    }
    const r = await api.post('/orders', {
      type: mode,
      tableId: mode === 'dine_in' ? tableId : undefined,
      items: cart,
    });
    await api.put(`/orders/${r.data._id}/status`, { status: 'kitchen' });
    setCart([]);
    setTableId('');
    loadActive();
    loadTables();
    alert('已下单到厨房');
  };

  const checkout = async (o) => {
    const paid = prompt(`订单 ${o.orderNo} 应收 ¥${o.total}\n输入实收现金金额:`, String(o.total));
    if (paid === null) return;
    const amount = Number(paid);
    if (Number.isNaN(amount) || amount < o.total) {
      alert('金额不足');
      return;
    }
    await api.post(`/orders/${o._id}/checkout`, {
      payments: [{ method: 'cash', amount }],
      tip: 0,
    });
    const rr = await api.get(`/orders/${o._id}`);
    setReceipt({
      storeName: 'Demo Store',
      orderNo: o.orderNo,
      items: o.items,
      subtotal: o.subtotal,
      tax: o.tax,
      total: o.total,
      payments: [{ method: 'cash', amount }],
      createdAt: o.createdAt,
    });
    loadActive();
  };

  const requestVoid = async (o) => {
    const reason = prompt('取消原因(需主管审批):');
    if (!reason) return;
    await api.post(`/orders/${o._id}/void`, { reason });
    alert('已提交取消申请,等待主管审批');
    loadActive();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white rounded shadow p-4">
          <div className="flex gap-2 mb-3 flex-wrap">
            {cats.map((c) => (
              <span key={c._id} className="px-3 py-1 bg-slate-100 rounded">
                {c.name}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {items.map((it) => (
              <button
                key={it._id}
                onClick={() => addToCart(it)}
                className="p-3 border rounded hover:bg-blue-50 text-left"
              >
                <div className="font-medium">{it.name}</div>
                <div className="text-sm text-slate-500">¥{it.price}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded shadow p-4">
          <div className="flex gap-2 mb-2">
            <select
              className="border p-1 rounded flex-1"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="dine_in">堂食</option>
              <option value="takeaway">外带</option>
            </select>
            {mode === 'dine_in' && (
              <select
                className="border p-1 rounded flex-1"
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
              >
                <option value="">选桌台</option>
                {tables
                  .filter((t) => t.status !== 'occupied')
                  .map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.number}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <ul className="mb-2">
            {cart.map((c, idx) => (
              <li key={idx} className="flex justify-between items-center py-1 border-b">
                <span>
                  {c.qty} x {c.name}
                </span>
                <span>
                  ¥{c.unitPrice * c.qty}{' '}
                  <button className="text-blue-600" onClick={() => changeQty(idx, 1)}>
                    +
                  </button>{' '}
                  <button className="text-blue-600" onClick={() => changeQty(idx, -1)}>
                    -
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="font-bold">合计 ¥{total}</div>
          <button
            className="w-full bg-blue-600 text-white p-2 rounded mt-2"
            onClick={submit}
          >
            下单到厨房
          </button>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4">
        <h3 className="font-bold mb-2">待结账订单</h3>
        <div className="grid grid-cols-4 gap-2">
          {active.map((o) => (
            <div key={o._id} className="border rounded p-2">
              <div className="flex justify-between">
                <span className="font-medium">{o.orderNo}</span>
                <span>¥{o.total}</span>
              </div>
              <div className="text-xs text-slate-500">
                {o.items.reduce((s, i) => s + i.qty, 0)} 件
              </div>
              <div className="mt-2 flex gap-1">
                <button
                  className="bg-green-600 text-white px-2 rounded text-sm"
                  onClick={() => checkout(o)}
                >
                  结账
                </button>
                <button
                  className="bg-red-500 text-white px-2 rounded text-sm"
                  onClick={() => requestVoid(o)}
                >
                  取消
                </button>
              </div>
            </div>
          ))}
          {!active.length && <div className="text-slate-400">暂无</div>}
        </div>
      </div>

      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function ReceiptModal({ receipt, onClose }) {
  const print = () => {
    const w = window.open('', '_blank');
    const rows = receipt.items
      .map((i) => `<div>${i.qty} x ${i.name} ...... ¥${(i.unitPrice * i.qty).toFixed(2)}</div>`)
      .join('');
    w.document.write(
      `<html><head><title>小票</title></head><body style="font-family:monospace;width:280px;padding:10px">` +
        `<h3 style="text-align:center">${receipt.storeName}</h3>` +
        `<div>单号: ${receipt.orderNo}</div>` +
        `<div>${new Date(receipt.createdAt).toLocaleString()}</div><hr/>${rows}<hr/>` +
        `<div>合计: ¥${receipt.total.toFixed(2)}</div>` +
        `<div>现金: ¥${receipt.payments[0]?.amount.toFixed(2)}</div>` +
        `<hr/><div style="text-align:center">谢谢惠顾</div></body></html>`
    );
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white p-4 rounded w-80">
        <div className="text-center font-bold">{receipt.storeName}</div>
        <div>单号 {receipt.orderNo}</div>
        <hr />
        {receipt.items.map((i, idx) => (
          <div key={idx} className="flex justify-between">
            <span>
              {i.qty}x{i.name}
            </span>
            <span>¥{i.unitPrice * i.qty}</span>
          </div>
        ))}
        <hr />
        <div className="flex justify-between font-bold">
          <span>合计</span>
          <span>¥{receipt.total}</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={print}>
            打印
          </button>
          <button className="border px-3 py-1 rounded" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
