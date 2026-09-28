import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function TablesPage() {
  const [tables, setTables] = useState([]);
  const [num, setNum] = useState('');

  const load = async () => {
    const r = await api.get('/tables');
    setTables(r.data);
  };
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!num) return;
    await api.post('/tables', { number: num, zone: '大厅', seats: 4 });
    setNum('');
    load();
  };
  const setStatus = async (id, status) => {
    await api.post(`/tables/${id}/status`, { status });
    load();
  };
  const color = (s) => (s === 'free' ? 'bg-green-100' : s === 'occupied' ? 'bg-amber-100' : 'bg-red-100');

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">桌台管理</h2>
      <div className="flex gap-2 mb-4">
        <input
          className="border p-2 rounded"
          placeholder="桌号"
          value={num}
          onChange={(e) => setNum(e.target.value)}
        />
        <button className="bg-blue-600 text-white px-3 rounded" onClick={add}>
          添加桌台
        </button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {tables.map((t) => (
          <div key={t._id} className={`p-4 rounded shadow ${color(t.status)}`}>
            <div className="font-bold">{t.number}</div>
            <div className="text-sm">{t.status}</div>
            <div className="mt-2 flex gap-1 text-xs">
              <button className="bg-white px-2 rounded border" onClick={() => setStatus(t._id, 'free')}>
                空闲
              </button>
              <button
                className="bg-white px-2 rounded border"
                onClick={() => setStatus(t._id, 'needs_clean')}
              >
                待清
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
