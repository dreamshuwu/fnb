import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function MenuPage() {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [catName, setCatName] = useState('');
  const [form, setForm] = useState({ name: '', price: 0, categoryId: '' });

  const load = async () => {
    const [c, it] = await Promise.all([api.get('/menu/categories'), api.get('/menu/items')]);
    setCats(c.data);
    setItems(it.data);
  };
  useEffect(() => {
    load();
  }, []);

  const addCat = async () => {
    if (!catName) return;
    await api.post('/menu/categories', { name: catName, sortOrder: cats.length + 1 });
    setCatName('');
    load();
  };
  const addItem = async () => {
    if (!form.name) return;
    await api.post('/menu/items', { ...form, price: Number(form.price) });
    setForm({ name: '', price: 0, categoryId: '' });
    load();
  };
  const delItem = async (id) => {
    await api.delete(`/menu/items/${id}`);
    load();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">菜单管理</h2>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded shadow">
          <h3 className="font-bold mb-2">分类</h3>
          <ul className="mb-2">
            {cats.map((c) => (
              <li key={c._id} className="py-1 border-b">
                {c.name}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              className="border p-2 rounded flex-1"
              placeholder="新分类"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
            />
            <button className="bg-blue-600 text-white px-3 rounded" onClick={addCat}>
              添加
            </button>
          </div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <h3 className="font-bold mb-2">菜品</h3>
          <div className="flex gap-2 mb-2">
            <input
              className="border p-2 rounded flex-1"
              placeholder="菜名"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              type="number"
              className="border p-2 rounded w-24"
              placeholder="价格"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <select
              className="border p-2 rounded"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">分类</option>
              {cats.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="bg-blue-600 text-white px-3 rounded" onClick={addItem}>
              添加
            </button>
          </div>
          <ul>
            {items.map((i) => (
              <li key={i._id} className="flex justify-between py-1 border-b">
                <span>
                  {i.name} ¥{i.price}
                </span>
                <button className="text-red-600" onClick={() => delItem(i._id)}>
                  删
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
