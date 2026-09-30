import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function MenuPage() {
  const [tab, setTab] = useState('categories');
  const [tree, setTree] = useState({ categories: [], bases: [], modifiers: [], baseModifiers: [], variants: [] });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/menu/tree');
      setTree(r.data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const catName = (id) => tree.categories.find((c) => c.id === id)?.name || '-';
  const baseName = (id) => tree.bases.find((b) => b.id === id)?.name || '-';
  const modName = (id) => {
    const m = tree.modifiers.find((x) => x.id === id);
    return m ? `${m.code}${m.label ? ' ' + m.label : ''}` : '-';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">菜单管理（后台可改）</h2>
        <button className="bg-slate-600 text-white px-3 py-1 rounded" onClick={load} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          ['categories', '分类'],
          ['bases', '基底'],
          ['modifiers', '修饰/后缀'],
          ['baseModifiers', '基底↔修饰 关联'],
          ['variants', '成品变体'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1 rounded ${tab === k ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'categories' && (
        <CategoryPanel tree={tree} reload={load} catName={catName} />
      )}
      {tab === 'bases' && (
        <BasePanel tree={tree} reload={load} catName={catName} />
      )}
      {tab === 'modifiers' && (
        <ModifierPanel tree={tree} reload={load} modName={modName} />
      )}
      {tab === 'baseModifiers' && (
        <LinkPanel tree={tree} reload={load} baseName={baseName} modName={modName} />
      )}
      {tab === 'variants' && (
        <VariantPanel tree={tree} reload={load} catName={catName} baseName={baseName} />
      )}
    </div>
  );
}

// 通用：列表 + 表单
function CategoryPanel({ tree, reload }) {
  const [form, setForm] = useState({ id: null, name: '', color: '#7c3aed', sortOrder: '' });
  const submit = async () => {
    if (!form.name) return;
    if (form.id) await api.put(`/menu/categories/${form.id}`, form);
    else await api.post('/menu/categories', form);
    setForm({ id: null, name: '', color: '#7c3aed', sortOrder: '' });
    reload();
  };
  const edit = (c) => setForm({ id: c.id, name: c.name, color: c.color || '#7c3aed', sortOrder: c.sortOrder ?? '' });
  const del = async (id) => { await api.delete(`/menu/categories/${id}`); reload(); };
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">分类列表</h3>
        <ul>
          {tree.categories.map((c) => (
            <li key={c.id} className="flex justify-between items-center py-1 border-b">
              <span><span className="inline-block w-4 h-4 rounded mr-2 align-middle" style={{ background: c.color || '#ccc' }} />{c.name}</span>
              <span>
                <button className="text-blue-600 mr-2" onClick={() => edit(c)}>编辑</button>
                <button className="text-red-600" onClick={() => del(c.id)}>删</button>
              </span>
            </li>
          ))}
          {!tree.categories.length && <li className="text-slate-400">暂无</li>}
        </ul>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">{form.id ? '编辑分类' : '新增分类'}</h3>
        <div className="space-y-2">
          <input className="border p-2 rounded w-full" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex items-center gap-2">
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            <span className="text-sm text-slate-500">颜色（收银屏分类底色）</span>
          </div>
          <input type="number" className="border p-2 rounded w-full" placeholder="排序" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          <div className="flex gap-2">
            <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={submit}>{form.id ? '保存' : '添加'}</button>
            {form.id && <button className="border px-3 py-1 rounded" onClick={() => setForm({ id: null, name: '', color: '#7c3aed', sortOrder: '' })}>取消</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BasePanel({ tree, reload }) {
  const [form, setForm] = useState({ id: null, categoryId: '', name: '', basePrice: '', sortOrder: '' });
  const submit = async () => {
    if (!form.name) return;
    const payload = { ...form, basePrice: Number(form.basePrice || 0), sortOrder: form.sortOrder === '' ? null : Number(form.sortOrder) };
    if (form.id) await api.put(`/menu/bases/${form.id}`, payload);
    else await api.post('/menu/bases', payload);
    setForm({ id: null, categoryId: '', name: '', basePrice: '', sortOrder: '' });
    reload();
  };
  const edit = (b) => setForm({ id: b.id, categoryId: b.categoryId || '', name: b.name, basePrice: b.basePrice, sortOrder: b.sortOrder ?? '' });
  const del = async (id) => { await api.delete(`/menu/bases/${id}`); reload(); };
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">基底列表</h3>
        <ul>
          {tree.bases.map((b) => (
            <li key={b.id} className="flex justify-between items-center py-1 border-b">
              <span>{b.name} <span className="text-slate-400">¥{b.basePrice}</span></span>
              <span>
                <button className="text-blue-600 mr-2" onClick={() => edit(b)}>编辑</button>
                <button className="text-red-600" onClick={() => del(b.id)}>删</button>
              </span>
            </li>
          ))}
          {!tree.bases.length && <li className="text-slate-400">暂无</li>}
        </ul>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">{form.id ? '编辑基底' : '新增基底'}</h3>
        <div className="space-y-2">
          <input className="border p-2 rounded w-full" placeholder="名称（如 Kopi / Dunhill PROMO）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="border p-2 rounded w-full" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">选分类</option>
            {tree.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="number" step="0.01" className="border p-2 rounded w-full" placeholder="基底价（原味价）" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} />
          <input type="number" className="border p-2 rounded w-full" placeholder="排序（可选）" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          <div className="flex gap-2">
            <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={submit}>{form.id ? '保存' : '添加'}</button>
            {form.id && <button className="border px-3 py-1 rounded" onClick={() => setForm({ id: null, categoryId: '', name: '', basePrice: '', sortOrder: '' })}>取消</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModifierPanel({ tree, reload }) {
  const [form, setForm] = useState({ id: null, code: '', label: '', defaultDelta: 0, sortOrder: '' });
  const submit = async () => {
    if (!form.code) return;
    const payload = { ...form, defaultDelta: Number(form.defaultDelta || 0), sortOrder: form.sortOrder === '' ? null : Number(form.sortOrder) };
    if (form.id) await api.put(`/menu/modifiers/${form.id}`, payload);
    else await api.post('/menu/modifiers', payload);
    setForm({ id: null, code: '', label: '', defaultDelta: 0, sortOrder: '' });
    reload();
  };
  const edit = (m) => setForm({ id: m.id, code: m.code, label: m.label || '', defaultDelta: m.defaultDelta, sortOrder: m.sortOrder ?? '' });
  const del = async (id) => { await api.delete(`/menu/modifiers/${id}`); reload(); };
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">修饰/后缀列表</h3>
        <ul>
          {tree.modifiers.map((m) => (
            <li key={m.id} className="flex justify-between items-center py-1 border-b">
              <span><b>{m.code}</b> {m.label} <span className="text-slate-400">{m.defaultDelta >= 0 ? '+' : ''}{m.defaultDelta}</span></span>
              <span>
                <button className="text-blue-600 mr-2" onClick={() => edit(m)}>编辑</button>
                <button className="text-red-600" onClick={() => del(m.id)}>删</button>
              </span>
            </li>
          ))}
          {!tree.modifiers.length && <li className="text-slate-400">暂无</li>}
        </ul>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">{form.id ? '编辑修饰' : '新增修饰'}</h3>
        <div className="space-y-2">
          <input className="border p-2 rounded w-full" placeholder="代码（O/KOS/C/P…）" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className="border p-2 rounded w-full" placeholder="说明（Kosong 无糖）" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input type="number" step="0.01" className="border p-2 rounded w-full" placeholder="默认差价" value={form.defaultDelta} onChange={(e) => setForm({ ...form, defaultDelta: e.target.value })} />
          <input type="number" className="border p-2 rounded w-full" placeholder="排序" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          <div className="flex gap-2">
            <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={submit}>{form.id ? '保存' : '添加'}</button>
            {form.id && <button className="border px-3 py-1 rounded" onClick={() => setForm({ id: null, code: '', label: '', defaultDelta: 0, sortOrder: '' })}>取消</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkPanel({ tree, reload }) {
  const [form, setForm] = useState({ id: null, baseId: '', modifierId: '', delta: '' });
  const linkedKey = (b, m) => `${b}-${m}`;
  const submit = async () => {
    if (!form.baseId || !form.modifierId) return;
    if (form.id) await api.put(`/menu/base-modifiers/${form.id}`, { delta: form.delta === '' ? null : Number(form.delta) });
    else await api.post('/menu/base-modifiers', { baseId: form.baseId, modifierId: form.modifierId, delta: form.delta === '' ? null : Number(form.delta) });
    setForm({ id: null, baseId: '', modifierId: '', delta: '' });
    reload();
  };
  const del = async (id) => { await api.delete(`/menu/base-modifiers/${id}`); reload(); };
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">关联列表（基底挂哪些修饰）</h3>
        <ul>
          {tree.baseModifiers.map((bm) => (
            <li key={bm.id} className="flex justify-between items-center py-1 border-b">
              <span>{baseName(tree, bm.baseId)} → {modName(tree, bm.modifierId)} <span className="text-slate-400">{bm.delta == null ? '默认' : (bm.delta >= 0 ? '+' : '') + bm.delta}</span></span>
              <button className="text-red-600" onClick={() => del(bm.id)}>删</button>
            </li>
          ))}
          {!tree.baseModifiers.length && <li className="text-slate-400">暂无</li>}
        </ul>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">新增关联</h3>
        <div className="space-y-2">
          <select className="border p-2 rounded w-full" value={form.baseId} onChange={(e) => setForm({ ...form, baseId: e.target.value })}>
            <option value="">选基底</option>
            {tree.bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="border p-2 rounded w-full" value={form.modifierId} onChange={(e) => setForm({ ...form, modifierId: e.target.value })}>
            <option value="">选修饰</option>
            {tree.modifiers.map((m) => <option key={m.id} value={m.id}>{m.code} {m.label}</option>)}
          </select>
          <input type="number" step="0.01" className="border p-2 rounded w-full" placeholder="覆盖差价（留空=用默认）" value={form.delta} onChange={(e) => setForm({ ...form, delta: e.target.value })} />
          <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={submit}>添加</button>
        </div>
      </div>
    </div>
  );
}
function baseName(tree, id) { return tree.bases.find((b) => b.id === id)?.name || '-'; }
function modName(tree, id) { const m = tree.modifiers.find((x) => x.id === id); return m ? `${m.code}${m.label ? ' ' + m.label : ''}` : '-'; }

function VariantPanel({ tree, reload }) {
  const [form, setForm] = useState({ id: null, baseId: '', code: '', name: '', modifierIds: [], price: '', cost: '', stockQty: '', stockThreshold: '', barcode: '' });
  const onBase = (baseId) => {
    const b = tree.bases.find((x) => x.id === baseId);
    setForm({ ...form, baseId, code: b?.name || '' });
  };
  const toggleMod = (mid) => {
    setForm((f) => ({
      ...f,
      modifierIds: f.modifierIds.includes(mid) ? f.modifierIds.filter((x) => x !== mid) : [...f.modifierIds, mid],
    }));
  };
  const submit = async () => {
    if (!form.baseId || !form.name || form.price === '') return;
    const base = tree.bases.find((x) => x.id === form.baseId);
    const payload = {
      baseId: form.baseId,
      categoryId: base?.categoryId || null,
      code: form.code,
      name: form.name,
      modifierIds: form.modifierIds,
      price: Number(form.price),
      cost: Number(form.cost || 0),
      stockQty: Number(form.stockQty || 0),
      stockThreshold: Number(form.stockThreshold || 0),
      barcode: form.barcode || null,
    };
    if (form.id) await api.put(`/menu/variants/${form.id}`, payload);
    else await api.post('/menu/variants', payload);
    setForm({ id: null, baseId: '', code: '', name: '', modifierIds: [], price: '', cost: '', stockQty: '', stockThreshold: '', barcode: '' });
    reload();
  };
  const edit = (v) => setForm({
    id: v.id, baseId: v.baseId, code: v.code, name: v.name, modifierIds: v.modifierIds || [],
    price: v.price, cost: v.cost, stockQty: v.stockQty, stockThreshold: v.stockThreshold, barcode: v.barcode || '',
  });
  const del = async (id) => { await api.delete(`/menu/variants/${id}`); reload(); };
  const modsForBase = (baseId) => {
    const linkSet = new Set(tree.baseModifiers.filter((bm) => bm.baseId === baseId).map((bm) => bm.modifierId));
    return tree.modifiers.filter((m) => linkSet.has(m.id));
  };
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-white p-4 rounded shadow max-h-[70vh] overflow-auto">
        <h3 className="font-bold mb-2">成品变体列表（共 {tree.variants.length}）</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b"><th>码</th><th>名称</th><th>价</th><th>库存</th><th></th></tr></thead>
          <tbody>
            {tree.variants.map((v) => (
              <tr key={v.id} className="border-b">
                <td>{v.code}</td><td>{v.name}</td><td>¥{v.price}</td>
                <td className={v.stockQty < v.stockThreshold ? 'text-red-600 font-bold' : ''}>{v.stockQty}</td>
                <td>
                  <button className="text-blue-600 mr-1" onClick={() => edit(v)}>编辑</button>
                  <button className="text-red-600" onClick={() => del(v.id)}>删</button>
                </td>
              </tr>
            ))}
            {!tree.variants.length && <tr><td colSpan="5" className="text-slate-400">暂无</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">{form.id ? '编辑变体' : '新增变体（手工逐条录入）'}</h3>
        <div className="space-y-2">
          <select className="border p-2 rounded w-full" value={form.baseId} onChange={(e) => onBase(e.target.value)}>
            <option value="">选基底</option>
            {tree.bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input className="border p-2 rounded flex-1" placeholder="简码（KO/KP…）" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <input className="border p-2 rounded flex-1" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="text-sm text-slate-500">修饰（可多选组合，如 KO KOS P）：</div>
          <div className="flex flex-wrap gap-1">
            {modsForBase(form.baseId).map((m) => (
              <button key={m.id}
                onClick={() => toggleMod(m.id)}
                className={`px-2 py-1 rounded text-sm ${form.modifierIds.includes(m.id) ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>
                {m.code}
              </button>
            ))}
            {form.baseId && !modsForBase(form.baseId).length && <span className="text-slate-400 text-sm">该基底未挂修饰（单品）</span>}
          </div>
          <div className="flex gap-2">
            <input type="number" step="0.01" className="border p-2 rounded flex-1" placeholder="售价" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <input type="number" step="0.01" className="border p-2 rounded flex-1" placeholder="成本" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <input type="number" className="border p-2 rounded flex-1" placeholder="库存" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} />
            <input type="number" className="border p-2 rounded flex-1" placeholder="库存阈值" value={form.stockThreshold} onChange={(e) => setForm({ ...form, stockThreshold: e.target.value })} />
          </div>
          <input className="border p-2 rounded w-full" placeholder="条码（可选）" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          <div className="flex gap-2">
            <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={submit}>{form.id ? '保存' : '添加'}</button>
            {form.id && <button className="border px-3 py-1 rounded" onClick={() => setForm({ id: null, baseId: '', code: '', name: '', modifierIds: [], price: '', cost: '', stockQty: '', stockThreshold: '', barcode: '' })}>取消</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
