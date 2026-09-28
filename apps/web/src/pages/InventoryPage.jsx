import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function InventoryPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', unit: '份', quantity: 0, threshold: 0 });

  const load = async () => {
    const r = await api.get('/inventory/items');
    setItems(r.data);
  };
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!form.name) return;
    await api.post('/inventory/items', {
      ...form,
      quantity: Number(form.quantity),
      threshold: Number(form.threshold),
    });
    setForm({ name: '', unit: '份', quantity: 0, threshold: 0 });
    load();
  };
  const adjust = async (id, delta) => {
    await api.post('/inventory/adjust', { itemId: id, delta: Number(delta), type: 'restock' });
    load();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">库存管理</h2>
      <div className="flex gap-2 mb-4">
        <input
          className="border p-2 rounded"
          placeholder="名称"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="border p-2 rounded w-20"
          placeholder="单位"
          value={form.unit}
          onChange={(e) => setForm({ ...form, unit: e.target.value })}
        />
        <input
          type="number"
          className="border p-2 rounded w-24"
          placeholder="数量"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />
        <input
          type="number"
          className="border p-2 rounded w-24"
          placeholder="阈值"
          value={form.threshold}
          onChange={(e) => setForm({ ...form, threshold: e.target.value })}
        />
        <button className="bg-blue-600 text-white px-3 rounded" onClick={add}>
          添加
        </button>
      </div>
      <table className="w-full bg-white rounded shadow">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">名称</th>
            <th>单位</th>
            <th>库存</th>
            <th>阈值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i._id} className="border-b">
              <td className="p-2">{i.name}</td>
              <td>{i.unit}</td>
              <td className={i.quantity < i.threshold ? 'text-red-600 font-bold' : ''}>{i.quantity}</td>
              <td>{i.threshold}</td>
              <td>
                <button className="text-blue-600" onClick={() => adjust(i._id, 1)}>
                  +1
                </button>{' '}
                <button className="text-blue-600" onClick={() => adjust(i._id, 5)}>
                  +5
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
