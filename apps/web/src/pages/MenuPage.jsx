import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

// ---------------------------------------------------------------------------
// 菜单与产品主数据(后台)
// ---------------------------------------------------------------------------
// 这一页同时管两件事:
//   1) 收银端要用的菜单结构 —— 分类 / 基底 / 修饰 / 基底↔修饰 / 成品变体
//   2) Smcin 的主数据 —— 商品大类 / 打印分组 / 部门 / 计量单位
// 产品(变体)上的主分组与部门可以留空,留空即「继承所属分类的默认值」,
// 报表与出单因此不会因为漏填而归到 Unassigned。
//
// 权限:
//   menu.edit      → 分类/基底/修饰/关联/产品 的写操作
//   settings.edit  → 主数据(大类/打印组/部门/计量单位)—— 会改变报表口径与打印路由

const TABS = [
  ['products', 'Products'],
  ['price-matrix', 'Price Matrix'],
  ['categories', 'Categories'],
  ['bases', 'Bases'],
  ['modifiers', 'Modifiers'],
  ['base-modifiers', 'Base ↔ Modifier'],
  ['main-groups', 'Main Groups'],
  ['print-groups', 'Print Groups'],
  ['departments', 'Departments'],
  ['uoms', 'UOM'],
  ['price-levels', 'Price Levels'],
];

const UOM_DIMENSIONS = [['count', 'Count 计数'], ['weight', 'Weight 重量'], ['volume', 'Volume 容量']];
const UOM_DIM_LABEL = Object.fromEntries(UOM_DIMENSIONS);
// 批量修改下拉里的哨兵值:空串 = 不改,__clear__ = 清空该字段
const NO_CHANGE = '';
const CLEAR = '__clear__';

const money2 = (n) => `¥${Number(n || 0).toFixed(2)}`;
const num = (v) => (v === '' || v == null ? undefined : Number(v));

const MENU_ERRORS = {
  duplicate_code: '编码已存在',
  master_in_use: '该主数据仍被引用,不能删除(可改为停用)',
  not_found: '记录不存在',
  no_ids: '请先勾选商品',
  no_fields: '请选择要修改的字段',
  too_many_ids: '一次最多修改 500 条',
  default_level: '默认价格级别不能删除,请先把另一个级别设为默认',
};
const errText = (e) => {
  const data = e?.response?.data || {};
  const code = data.error;
  if (code === 'master_in_use') {
    // 默认价格级别是「基础价」的落点,删掉整条价格链就断了 —— 服务端会带 reason 区分
    if (data.reason === 'default_level') return MENU_ERRORS.default_level;
    const counts = data.counts || {};
    const detail = Object.entries(counts).map(([k, v]) => `${k} × ${v}`).join('、');
    return `${MENU_ERRORS[code]}${detail ? `(${detail})` : ''}`;
  }
  return MENU_ERRORS[code] || code || e?.message || '操作失败';
};

// ---------------------------------------------------------------- 通用小组件
function Panel({ title, subtitle, children, right }) {
  return (
    <section className="ops-panel">
      <div className="ops-panel-heading">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        {right}
      </div>
      {children}
    </section>
  );
}
function Input({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label className="ops-field"><span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Select({ label, value, onChange, options, placeholder }) {
  return (
    <label className="ops-field"><span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}
function Action({ children, onClick, tone = 'primary', disabled }) {
  return <button className={`ops-action ${tone}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Empty({ text = 'No records yet' }) { return <div className="ops-empty">{text}</div>; }

// 所有下拉数据一次性拉齐;单个接口没权限(如收银员没有 stock.view)时降级为空列表,
// 不能让一个旁路接口失败把整页拖垮。
function useLookups() {
  const [lk, setLk] = useState({
    categories: [], bases: [], modifiers: [], baseModifiers: [],
    mainGroups: [], printGroups: [], departments: [], suppliers: [], uoms: [], priceLevels: [],
  });
  const reload = async () => {
    const g = (p) => api.get(p).then((r) => r.data || []).catch(() => []);
    const [categories, bases, modifiers, baseModifiers, mainGroups, printGroups, departments, suppliers, uoms, priceLevels] =
      await Promise.all([
        g('/menu/categories'), g('/menu/bases'), g('/menu/modifiers'), g('/menu/base-modifiers'),
        g('/main-groups'), g('/print-groups'), g('/departments'), g('/suppliers'), g('/uoms'), g('/price-levels'),
      ]);
    setLk({ categories, bases, modifiers, baseModifiers, mainGroups, printGroups, departments, suppliers, uoms, priceLevels });
  };
  useEffect(() => { reload(); }, []);
  return [lk, reload];
}

const idOptions = (rows, label = (r) => r.name) => rows.map((r) => [String(r.id), label(r)]);
const codeOptions = (rows) => rows.map((r) => [r.code, `${r.code} · ${r.name}`]);

// ============================================================ 页面外壳
export default function MenuPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'products';
  const active = TABS.some(([k]) => k === tab) ? tab : 'products';
  const [lk, reloadLookups] = useLookups();

  return (
    <div className="operations-page">
      <div className="operations-heading">
        <div>
          <div className="modern-eyebrow">SMPOS / BACK OFFICE</div>
          <h1>Menu &amp; Product Master</h1>
          <p>分类 · 基底 · 修饰 · 产品主档 · 价目 · 商品大类 · 打印分组 · 部门 · 计量单位</p>
        </div>
        <div className="operations-date">{new Date().toLocaleDateString('en-GB')}</div>
      </div>

      <div className="operations-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={active === key ? 'active' : ''} onClick={() => setParams({ tab: key })}>{label}</button>
        ))}
      </div>

      <div className="operations-content">
        {active === 'products' && <ProductsPanel lk={lk} reloadLookups={reloadLookups} />}
        {active === 'price-matrix' && <PriceMatrixPanel lk={lk} />}
        {active === 'categories' && <CategoriesPanel lk={lk} reloadLookups={reloadLookups} />}
        {active === 'bases' && <BasesPanel lk={lk} reloadLookups={reloadLookups} />}
        {active === 'modifiers' && <ModifiersPanel lk={lk} reloadLookups={reloadLookups} />}
        {active === 'base-modifiers' && <BaseModifierPanel lk={lk} reloadLookups={reloadLookups} />}
        {active === 'main-groups' && <MasterDataPanel kind="main-groups" title="Main Groups" subtitle="商品大类:报表按此汇总(饮料 / 食品 / 香烟 / 零售…)" lk={lk} reloadLookups={reloadLookups} />}
        {active === 'print-groups' && <MasterDataPanel kind="print-groups" title="Print Groups" subtitle="打印分组:决定出单路由到哪台打印机(厨房单 / 水吧单 / 柜台单)" lk={lk} reloadLookups={reloadLookups} />}
        {active === 'departments' && <MasterDataPanel kind="departments" title="Departments" subtitle="部门:财务与报表口径,与 KDS 出单站别分开" lk={lk} reloadLookups={reloadLookups} />}
        {active === 'uoms' && <UomPanel lk={lk} reloadLookups={reloadLookups} />}
        {active === 'price-levels' && <PriceLevelsPanel lk={lk} reloadLookups={reloadLookups} />}
      </div>
    </div>
  );
}

// ============================================================ 产品主档
// prices 只装「非默认级别」的覆盖价,默认级别的价格就是 price 字段本身 ——
// 服务端的不变量是 menu_variants.price === 默认级别价,前端不复制这份真源。
const emptyProduct = () => ({
  baseId: '', categoryId: '', code: '', name: '', price: '', cost: '',
  barcode: '', sortOrder: '', isActive: true,
  mainGroupId: '', printGroupId: '', departmentId: '', supplierId: '',
  uom: '', packUom: '', packFactor: '1', stockQty: '0', stockThreshold: '0',
  prices: {},
});

// 价格级别:挑出默认级别(基础价的落点)与其余可覆盖的级别。
function splitLevels(levels = []) {
  const list = (levels || []).filter((l) => l && l.code);
  const def = list.find((l) => l.isDefault) || list[0] || null;
  const defCode = def ? String(def.code).toUpperCase() : null;
  return { list, def, defCode, others: list.filter((l) => l !== def) };
}

function ProductsPanel({ lk, reloadLookups }) {
  const { can } = useAuth();
  const canEdit = can('menu.edit');
  const { def: defLevel, defCode, others: otherLevels } = splitLevels(lk.priceLevels);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ q: '', categoryId: '', mainGroupId: '', printGroupId: '', departmentId: '', supplierId: '', uom: '', active: '', unassigned: false, converted: false });
  const [selected, setSelected] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyProduct());
  const [bulk, setBulk] = useState({ mainGroupId: NO_CHANGE, printGroupId: NO_CHANGE, departmentId: NO_CHANGE, supplierId: NO_CHANGE, uom: NO_CHANGE });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => {
    const p = {};
    if (filters.q) p.q = filters.q;
    for (const k of ['categoryId', 'mainGroupId', 'printGroupId', 'departmentId', 'supplierId', 'uom']) if (filters[k]) p[k] = filters[k];
    if (filters.active) p.active = filters.active;
    if (filters.unassigned) p.unassigned = '1';
    if (filters.converted) p.converted = '1';
    const r = await api.get('/menu/products', { params: p });
    setRows(r.data?.rows || []);
    setSummary(r.data?.summary || {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.active, filters.unassigned, filters.converted, filters.categoryId, filters.mainGroupId, filters.printGroupId, filters.departmentId, filters.supplierId, filters.uom]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const openNew = () => { setEditingId(null); setForm(emptyProduct()); setShowForm(true); };
  const openEdit = async (p) => {
    setEditingId(p.id);
    setForm({
      baseId: p.baseId == null ? '' : String(p.baseId),
      categoryId: p.categoryId == null ? '' : String(p.categoryId),
      code: p.code || '', name: p.name || '',
      price: String(p.price ?? ''), cost: String(p.cost ?? ''),
      barcode: p.barcode || '', sortOrder: p.sortOrder == null ? '' : String(p.sortOrder),
      isActive: !!p.isActive,
      // 继承来的值不回填到表单 —— 否则一保存就把「继承」变成了「写死」
      mainGroupId: p.mainGroupInherited ? '' : (p.mainGroupId == null ? '' : String(p.mainGroupId)),
      printGroupId: p.printGroupId == null ? '' : String(p.printGroupId),
      departmentId: p.departmentInherited ? '' : (p.departmentId == null ? '' : String(p.departmentId)),
      supplierId: p.supplierId == null ? '' : String(p.supplierId),
      uom: p.uom || '', packUom: p.packUom || '',
      packFactor: String(p.packFactor ?? 1),
      stockQty: String(p.stockQty ?? 0), stockThreshold: String(p.stockThreshold ?? 0),
      prices: {},
    });
    setShowForm(true);
    // 各价格级别当前是「有覆盖行」还是「回落基础价」只有矩阵接口能说清:
    // source === 'level' 才代表存了覆盖行,否则留空让用户继续看到「回落」。
    try {
      const r = await api.get('/menu/price-matrix');
      const row = (r.data?.rows || []).find((x) => String(x.variantId) === String(p.id));
      if (row) {
        const next = {};
        for (const lv of otherLevels) {
          const code = String(lv.code).toUpperCase();
          const cell = (row.cells || {})[code];
          next[code] = cell && cell.source === 'level' ? String(cell.price) : '';
        }
        setForm((f) => ({ ...f, prices: next }));
      }
    } catch { /* 价目拉取失败不该阻塞主档编辑 */ }
  };

  // 非默认级别的价目条目。留空 = 传 null = 删除覆盖行,回落默认级别的基础价。
  const priceEntries = () => otherLevels
    .filter((lv) => form.prices[String(lv.code).toUpperCase()] !== undefined)
    .map((lv) => {
      const code = String(lv.code).toUpperCase();
      const raw = form.prices[code];
      return { levelCode: code, price: raw === '' || raw == null ? null : Number(raw) };
    });

  const save = async () => {
    if (!form.name.trim()) { alert('请填写商品名称'); return; }
    if (!form.code.trim()) { alert('请填写商品编码'); return; }
    if (!form.baseId) { alert('请选择所属基底'); return; }
    if (form.price === '' || Number.isNaN(Number(form.price))) { alert('请填写有效售价'); return; }
    const entries = priceEntries();
    const payload = {
      baseId: form.baseId,
      categoryId: form.categoryId || undefined,
      code: form.code.trim(), name: form.name.trim(),
      price: Number(form.price), cost: num(form.cost) ?? 0,
      barcode: form.barcode || undefined,
      sortOrder: num(form.sortOrder),
      isActive: form.isActive,
      // 空串表示「清空引用」,于是会回落到分类默认(继承)
      mainGroupId: form.mainGroupId, printGroupId: form.printGroupId,
      departmentId: form.departmentId, supplierId: form.supplierId,
      uom: form.uom, packUom: form.packUom,
      packFactor: num(form.packFactor) ?? 1,
      stockQty: num(form.stockQty) ?? 0, stockThreshold: num(form.stockThreshold) ?? 0,
    };
    try {
      if (editingId) {
        await api.put(`/menu/variants/${editingId}`, payload);
        // PUT 刻意不收 prices —— 改价目走专用接口,避免「基础价」被两条路径同时写
        if (entries.length) await api.put(`/menu/variants/${editingId}/prices`, { prices: entries });
      } else {
        if (entries.length) payload.prices = entries;   // 建商品时一并写覆盖价
        await api.post('/menu/variants', payload);
      }
      flash(editingId ? '商品已更新' : '商品已创建');
      setShowForm(false); setEditingId(null); setForm(emptyProduct());
      await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };

  const remove = async (p) => {
    if (!window.confirm(`确定删除商品「${p.name}」?该操作不可撤销。`)) return;
    try { await api.delete(`/menu/variants/${p.id}`); flash('商品已删除'); await load(); }
    catch (e) { alert(errText(e)); }
  };

  const toggleAll = (checked) => setSelected(checked ? rows.map((r) => String(r.id)) : []);
  const toggleOne = (id, checked) => {
    const k = String(id);
    setSelected((s) => (checked ? [...new Set([...s, k])] : s.filter((x) => x !== k)));
  };

  const runBulk = async (patch, label) => {
    if (!selected.length) { alert('请先勾选商品'); return; }
    setBusy(true);
    try {
      const r = await api.post('/menu/products/bulk', { ids: selected, patch });
      flash(`${label}:已更新 ${r.data?.updated ?? 0} 条`);
      setSelected([]);
      await load();
    } catch (e) { alert(errText(e)); }
    finally { setBusy(false); }
  };

  const applyBulk = () => {
    const patch = {};
    for (const k of ['mainGroupId', 'printGroupId', 'departmentId', 'supplierId', 'uom']) {
      const v = bulk[k];
      if (v === NO_CHANGE) continue;
      patch[k] = v === CLEAR ? '' : v;
    }
    if (!Object.keys(patch).length) { alert('请至少选择一项要修改的内容'); return; }
    runBulk(patch, '批量归口');
    setBulk({ mainGroupId: NO_CHANGE, printGroupId: NO_CHANGE, departmentId: NO_CHANGE, supplierId: NO_CHANGE, uom: NO_CHANGE });
  };

  const catOptions = idOptions(lk.categories);
  const baseOptions = idOptions(lk.bases, (b) => `${b.name}${b.categoryId ? ` · ${lk.categories.find((c) => String(c.id) === String(b.categoryId))?.name || ''}` : ''}`);
  // 主分组/部门的下拉带一个「清空 = 继承分类默认」项
  const inheritOptions = (rows) => [[CLEAR, '— 继承分类默认 —'], ...idOptions(rows)];
  const assignOptions = (rows, label) => [[NO_CHANGE, '— 不修改 —'], [CLEAR, '— 清空 —'], ...idOptions(rows, label)];
  const allChecked = rows.length > 0 && selected.length === rows.length;

  // 换算口径预览:packFactor 的语义是「1 个 packUom = packFactor 个 uom」。
  // 与单位相同或系数留 1 都视为「不换算」—— 与 uomConvert.js 的回落策略一致。
  const convPreview = (() => {
    const u = String(form.uom || '').toUpperCase();
    const pk = String(form.packUom || '').toUpperCase();
    const f = Number(form.packFactor || 1);
    if (!u || !pk || pk === u || !(f > 0) || f === 1) return false;
    return true;
  })();

  return <>
    <Panel title="Product Master" subtitle="扁平产品清单:主分组 / 打印组 / 部门 / 供应商 / 计量单位 一览,支持批量归口">
      <div className="report-kpis voucher-kpis">
        <span>Total <b>{summary.total ?? 0}</b></span>
        <span>Active <b>{summary.active ?? 0}</b></span>
        <span>Inactive <b>{summary.inactive ?? 0}</b></span>
        <span>With Supplier <b>{summary.withSupplier ?? 0}</b></span>
        <span>Missing UOM <b>{summary.missingUom ?? 0}</b></span>
        <span>Unassigned <b>{summary.unassigned ?? 0}</b></span>
        <span>Unit Converted <b>{summary.convertedUom ?? 0}</b></span>
        <span>Price Levels <b>{summary.withPriceLevels ?? 0}</b></span>
      </div>

      <div className="ops-form inline">
        <Input label="Search" value={filters.q} onChange={(v) => setF('q', v)} placeholder="编码 / 名称 / 条码" />
        <Select label="Category" value={filters.categoryId} onChange={(v) => setF('categoryId', v)} options={catOptions} placeholder="All" />
        <Select label="Main Group" value={filters.mainGroupId} onChange={(v) => setF('mainGroupId', v)} options={idOptions(lk.mainGroups)} placeholder="All" />
        <Select label="Print Group" value={filters.printGroupId} onChange={(v) => setF('printGroupId', v)} options={idOptions(lk.printGroups)} placeholder="All" />
        <Select label="Department" value={filters.departmentId} onChange={(v) => setF('departmentId', v)} options={idOptions(lk.departments)} placeholder="All" />
        <Select label="Supplier" value={filters.supplierId} onChange={(v) => setF('supplierId', v)} options={idOptions(lk.suppliers)} placeholder="All" />
        <Select label="UOM" value={filters.uom} onChange={(v) => setF('uom', v)} options={codeOptions(lk.uoms)} placeholder="All" />
        <Select label="Status" value={filters.active} onChange={(v) => setF('active', v)} options={[['1', 'Active'], ['0', 'Inactive']]} placeholder="All" />
        <label className="ops-checkbox"><input type="checkbox" checked={filters.unassigned} onChange={(e) => setF('unassigned', e.target.checked)} /> 仅看未归口</label>
        <label className="ops-checkbox"><input type="checkbox" checked={filters.converted} onChange={(e) => setF('converted', e.target.checked)} /> 仅看需换算</label>
        <Action tone="secondary" onClick={load}>Search</Action>
        {canEdit && <Action onClick={openNew}>+ New Product</Action>}
        {msg && <span className="ops-saved">{msg}</span>}
      </div>

      {selected.length > 0 && (
        <div className="menu-bulk">
          <b>{selected.length} 条已选</b>
          <Select label="Main Group" value={bulk.mainGroupId} onChange={(v) => setBulk((b) => ({ ...b, mainGroupId: v }))} options={assignOptions(lk.mainGroups)} />
          <Select label="Print Group" value={bulk.printGroupId} onChange={(v) => setBulk((b) => ({ ...b, printGroupId: v }))} options={assignOptions(lk.printGroups)} />
          <Select label="Department" value={bulk.departmentId} onChange={(v) => setBulk((b) => ({ ...b, departmentId: v }))} options={assignOptions(lk.departments)} />
          <Select label="Supplier" value={bulk.supplierId} onChange={(v) => setBulk((b) => ({ ...b, supplierId: v }))} options={assignOptions(lk.suppliers)} />
          <Select label="UOM" value={bulk.uom} onChange={(v) => setBulk((b) => ({ ...b, uom: v }))} options={[[NO_CHANGE, '— 不修改 —'], [CLEAR, '— 清空 —'], ...codeOptions(lk.uoms)]} />
          <Action onClick={applyBulk} disabled={busy}>Apply</Action>
          <Action tone="secondary" onClick={() => runBulk({ isActive: true }, '批量启用')} disabled={busy}>Activate</Action>
          <Action tone="warning" onClick={() => runBulk({ isActive: false }, '批量停用')} disabled={busy}>Deactivate</Action>
          <Action tone="secondary" onClick={() => setSelected([])} disabled={busy}>Clear</Action>
        </div>
      )}

      <div className="ops-table tall menu-product-table">
        <div className="ops-row ops-head">
          <span className="menu-check"><input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} /></span>
          <span>Code</span><span>Product</span><span>Main Group</span><span>Print Group</span>
          <span>Department</span><span>Supplier</span><span>UOM</span><span>Price</span><span>Prices</span><span>Stock</span><span>Status</span><span>Action</span>
        </div>
        {rows.map((p) => <div className="ops-row" key={p.id}>
          <span className="menu-check"><input type="checkbox" checked={selected.includes(String(p.id))} onChange={(e) => toggleOne(p.id, e.target.checked)} /></span>
          <span>{p.code}</span>
          <span><b>{p.name}</b><small className="member-sub">{p.categoryName || '—'}{p.barcode ? ` · ${p.barcode}` : ''}</small></span>
          <span>{p.mainGroupName || <em className="menu-missing">未归口</em>}{p.mainGroupInherited && <small className="member-sub">继承自分类</small>}</span>
          <span>{p.printGroupName || <em className="menu-missing">不打印</em>}</span>
          <span>{p.departmentName || <em className="menu-missing">未归口</em>}{p.departmentInherited && <small className="member-sub">继承自分类</small>}</span>
          <span>{p.supplierName || '—'}</span>
          <span>{p.uom ? <>{p.uom}<small className="member-sub">{p.uomName || ''}</small></> : <em className="menu-missing">—</em>}
            {p.uomConverted && <small className="member-sub menu-conv" title={p.uomConvertReason || ''}>1 {p.stockUom} = {p.unitsPerStock} {p.uom}</small>}</span>
          <span>{money2(p.price)}<small className="member-sub">{defLevel ? defLevel.code : ''}</small></span>
          <span>{p.priceLevelCount > 0
            ? <span className="menu-default" title={`${p.priceLevelCount} 个非默认级别设有专属价`}>+{p.priceLevelCount}</span>
            : <em className="menu-missing">基础价</em>}</span>
          <span>{p.stockQty}</span>
          <span className={p.isActive ? 'staff-on' : 'staff-off'}>{p.isActive ? 'active' : 'inactive'}</span>
          <span className="ops-inline-actions">
            {canEdit && <button className="mini-action" onClick={() => openEdit(p)}>Edit</button>}
            {canEdit && <button className="mini-action danger" onClick={() => remove(p)}>Delete</button>}
          </span>
        </div>)}
        {!rows.length && <Empty text="No products match the filters" />}
      </div>
    </Panel>

    {showForm && (
      <Panel title={editingId ? `Edit Product · ${form.code}` : 'New Product'} subtitle="产品主档:价格、归口、计量单位与库存阈值"
        right={<Action tone="secondary" onClick={() => { setShowForm(false); setEditingId(null); }}>Close</Action>}>
        <div className="ops-form inline">
          <Input label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="KOPI-O" />
          <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Kopi O" />
          <Select label="Category" value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} options={catOptions} placeholder="— 选择分类 —" />
          <Select label="Base" value={form.baseId} onChange={(v) => setForm({ ...form, baseId: v })} options={baseOptions} placeholder="— 选择基底 —" />
          <Input label="Price" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="2.50" />
          <Input label="Cost" type="number" value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} placeholder="0.80" />
          <Input label="Barcode" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} placeholder="可选" />
          <Input label="Sort Order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="自动" />
        </div>

        <h3 className="menu-subhead">归口(Smcin 主数据)</h3>
        <div className="ops-form inline">
          <Select label="Main Group" value={form.mainGroupId} onChange={(v) => setForm({ ...form, mainGroupId: v })} options={inheritOptions(lk.mainGroups)} />
          <Select label="Print Group" value={form.printGroupId} onChange={(v) => setForm({ ...form, printGroupId: v })} options={[[CLEAR, '— 不打印 —'], ...idOptions(lk.printGroups)]} />
          <Select label="Department" value={form.departmentId} onChange={(v) => setForm({ ...form, departmentId: v })} options={inheritOptions(lk.departments)} />
          <Select label="Supplier" value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} options={idOptions(lk.suppliers)} placeholder="— 无 —" />
        </div>

        <h3 className="menu-subhead">计量单位与库存</h3>
        <div className="ops-form inline">
          <Select label="UOM" value={form.uom} onChange={(v) => setForm({ ...form, uom: v })} options={codeOptions(lk.uoms)} placeholder="— 无 —" />
          <Select label="Pack UOM" value={form.packUom} onChange={(v) => setForm({ ...form, packUom: v })} options={codeOptions(lk.uoms)} placeholder="— 无 —" />
          <Input label="Pack Factor" type="number" value={form.packFactor} onChange={(v) => setForm({ ...form, packFactor: v })} placeholder="1" />
          <Input label="Stock Qty" type="number" value={form.stockQty} onChange={(v) => setForm({ ...form, stockQty: v })} placeholder="0" />
          <Input label="Stock Threshold" type="number" value={form.stockThreshold} onChange={(v) => setForm({ ...form, stockThreshold: v })} placeholder="0" />
          <label className="ops-checkbox"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
        </div>
        <p className="menu-hint">
          {convPreview
            ? <>换算口径:<b>1 {String(form.packUom).toUpperCase()} = {Number(form.packFactor)} {String(form.uom).toUpperCase()}</b>,结账时按此把销售单位折算成库存单位扣减。</>
            : '销售单位与库存单位相同(或 Pack Factor 留 1)时不换算,卖出即按 1:1 扣库存。'}
        </p>

        <h3 className="menu-subhead">价格级别 Pricing</h3>
        {defLevel ? <>
          <p className="menu-hint">
            默认级别 <b>{defLevel.code} · {defLevel.name}</b> 的价格就是上方的 Price 字段 —— 基础价只有这一处真源,
            收据 / 报表 / 小票都读它。其余级别留空表示「回落基础价」,填写才会存一条专属价。
          </p>
          <div className="ops-form inline">
            <label className="ops-field"><span>{defLevel.code} · {defLevel.name}(基础价)</span>
              <input className="menu-price-mirror" value={form.price} readOnly disabled placeholder="见上方 Price" /></label>
            {otherLevels.map((lv) => {
              const code = String(lv.code).toUpperCase();
              return <Input key={code} label={`${lv.code} · ${lv.name}`} type="number"
                value={form.prices[code] ?? ''}
                onChange={(v) => setForm({ ...form, prices: { ...form.prices, [code]: v } })}
                placeholder="留空 = 基础价" />;
            })}
          </div>
        </> : <p className="menu-hint">还没有配置任何价格级别,请先到 <b>Price Levels</b> 页签建立(第一个会自动成为默认级别)。</p>}

        <div className="ops-actions">
          <Action onClick={save}>{editingId ? 'Save Changes' : 'Create Product'}</Action>
          <Action tone="secondary" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</Action>
        </div>
      </Panel>
    )}
  </>;
}

// ============================================================ 分类
const emptyCategory = () => ({ name: '', color: '#7c3aed', sortOrder: '', isActive: true, mainGroupId: '', departmentId: '' });

function CategoriesPanel({ lk, reloadLookups }) {
  const { can } = useAuth();
  const canEdit = can('menu.edit');
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState(emptyCategory());
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => setCats((await api.get('/menu/categories')).data || []);
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.name.trim()) { alert('请填写分类名称'); return; }
    const payload = {
      name: form.name.trim(), color: form.color || undefined,
      sortOrder: num(form.sortOrder), isActive: form.isActive,
      mainGroupId: form.mainGroupId, departmentId: form.departmentId,
    };
    try {
      if (editingId) await api.put(`/menu/categories/${editingId}`, payload);
      else await api.post('/menu/categories', payload);
      flash(editingId ? '分类已更新' : '分类已创建');
      setForm(emptyCategory()); setEditingId(null); await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };

  const remove = async (c) => {
    if (!window.confirm(`确定删除分类「${c.name}」?`)) return;
    try { await api.delete(`/menu/categories/${c.id}`); flash('分类已删除'); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };

  const mgName = (id) => lk.mainGroups.find((x) => String(x.id) === String(id))?.name || '—';
  const dpName = (id) => lk.departments.find((x) => String(x.id) === String(id))?.name || '—';

  return <Panel title="Categories" subtitle="分类同时承载收银端分页、KDS 出单站别,以及产品主数据的默认归口">
    <div className="ops-form inline">
      <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="KOPI" />
      <Input label="Color" value={form.color} onChange={(v) => setForm({ ...form, color: v })} placeholder="#7c3aed" />
      <Input label="Sort Order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="自动" />
      <Select label="Default Main Group" value={form.mainGroupId} onChange={(v) => setForm({ ...form, mainGroupId: v })} options={idOptions(lk.mainGroups)} placeholder="— 无 —" />
      <Select label="Default Department" value={form.departmentId} onChange={(v) => setForm({ ...form, departmentId: v })} options={idOptions(lk.departments)} placeholder="— 无 —" />
      <label className="ops-checkbox"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
      {canEdit && <Action onClick={submit}>{editingId ? 'Save' : '+ Add'}</Action>}
      {editingId && <Action tone="secondary" onClick={() => { setEditingId(null); setForm(emptyCategory()); }}>Cancel</Action>}
      {msg && <span className="ops-saved">{msg}</span>}
    </div>

    <div className="ops-table menu-cat-table">
      <div className="ops-row ops-head"><span>Name</span><span>Color</span><span>Default Main Group</span><span>Default Department</span><span>KDS Station</span><span>Sort</span><span>Status</span><span>Action</span></div>
      {cats.map((c) => <div className="ops-row" key={c.id}>
        <span><b>{c.name}</b></span>
        <span><i className="menu-swatch" style={{ background: c.color || '#cbd5e1' }} /> {c.color || '—'}</span>
        <span>{mgName(c.mainGroupId)}</span>
        <span>{dpName(c.departmentId)}</span>
        <span>{c.station || '—'}</span>
        <span>{c.sortOrder ?? '—'}</span>
        <span className={c.isActive ? 'staff-on' : 'staff-off'}>{c.isActive ? 'active' : 'inactive'}</span>
        <span className="ops-inline-actions">
          {canEdit && <button className="mini-action" onClick={() => { setEditingId(c.id); setForm({ name: c.name || '', color: c.color || '#7c3aed', sortOrder: c.sortOrder == null ? '' : String(c.sortOrder), isActive: !!c.isActive, mainGroupId: c.mainGroupId == null ? '' : String(c.mainGroupId), departmentId: c.departmentId == null ? '' : String(c.departmentId) }); }}>Edit</button>}
          {canEdit && <button className="mini-action danger" onClick={() => remove(c)}>Delete</button>}
        </span>
      </div>)}
      {!cats.length && <Empty />}
    </div>
    <p className="menu-hint">KDS Station 由种子数据决定,暂不支持在此修改;部门用于财务口径,与出单站别是两回事。</p>
  </Panel>;
}

// ============================================================ 基底
const emptyBase = () => ({ categoryId: '', name: '', basePrice: '', sortOrder: '', isActive: true });

function BasesPanel({ lk, reloadLookups }) {
  const { can } = useAuth();
  const canEdit = can('menu.edit');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyBase());
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => setRows((await api.get('/menu/bases')).data || []);
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.name.trim()) { alert('请填写基底名称'); return; }
    const payload = { categoryId: form.categoryId || undefined, name: form.name.trim(), basePrice: num(form.basePrice) ?? 0, sortOrder: num(form.sortOrder), isActive: form.isActive };
    try {
      if (editingId) await api.put(`/menu/bases/${editingId}`, payload);
      else await api.post('/menu/bases', payload);
      flash(editingId ? '基底已更新' : '基底已创建');
      setForm(emptyBase()); setEditingId(null); await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };
  const remove = async (b) => {
    if (!window.confirm(`确定删除基底「${b.name}」?`)) return;
    try { await api.delete(`/menu/bases/${b.id}`); flash('基底已删除'); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };
  const catName = (id) => lk.categories.find((x) => String(x.id) === String(id))?.name || '—';

  return <Panel title="Bases" subtitle="基底 = 点单第一步的东西(Kopi / Teh / Milo…),产品变体挂在基底之下">
    <div className="ops-form inline">
      <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Kopi" />
      <Select label="Category" value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} options={idOptions(lk.categories)} placeholder="— 无 —" />
      <Input label="Base Price" type="number" value={form.basePrice} onChange={(v) => setForm({ ...form, basePrice: v })} placeholder="0" />
      <Input label="Sort Order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="自动" />
      <label className="ops-checkbox"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
      {canEdit && <Action onClick={submit}>{editingId ? 'Save' : '+ Add'}</Action>}
      {editingId && <Action tone="secondary" onClick={() => { setEditingId(null); setForm(emptyBase()); }}>Cancel</Action>}
      {msg && <span className="ops-saved">{msg}</span>}
    </div>
    <div className="ops-table menu-base-table">
      <div className="ops-row ops-head"><span>Name</span><span>Category</span><span>Base Price</span><span>Sort</span><span>Status</span><span>Action</span></div>
      {rows.map((b) => <div className="ops-row" key={b.id}>
        <span><b>{b.name}</b></span>
        <span>{catName(b.categoryId)}</span>
        <span>{money2(b.basePrice)}</span>
        <span>{b.sortOrder ?? '—'}</span>
        <span className={b.isActive ? 'staff-on' : 'staff-off'}>{b.isActive ? 'active' : 'inactive'}</span>
        <span className="ops-inline-actions">
          {canEdit && <button className="mini-action" onClick={() => { setEditingId(b.id); setForm({ categoryId: b.categoryId == null ? '' : String(b.categoryId), name: b.name || '', basePrice: String(b.basePrice ?? ''), sortOrder: b.sortOrder == null ? '' : String(b.sortOrder), isActive: !!b.isActive }); }}>Edit</button>}
          {canEdit && <button className="mini-action danger" onClick={() => remove(b)}>Delete</button>}
        </span>
      </div>)}
      {!rows.length && <Empty />}
    </div>
  </Panel>;
}

// ============================================================ 修饰
const emptyModifier = () => ({ code: '', label: '', defaultDelta: '0', sortOrder: '', isActive: true });

function ModifiersPanel({ lk, reloadLookups }) {
  const { can } = useAuth();
  const canEdit = can('menu.edit');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyModifier());
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => setRows((await api.get('/menu/modifiers')).data || []);
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.code.trim()) { alert('请填写修饰编码'); return; }
    const payload = { code: form.code.trim(), label: form.label || undefined, defaultDelta: num(form.defaultDelta) ?? 0, sortOrder: num(form.sortOrder), isActive: form.isActive };
    try {
      if (editingId) await api.put(`/menu/modifiers/${editingId}`, payload);
      else await api.post('/menu/modifiers', payload);
      flash(editingId ? '修饰已更新' : '修饰已创建');
      setForm(emptyModifier()); setEditingId(null); await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };
  const remove = async (m) => {
    if (!window.confirm(`确定删除修饰「${m.code}」?`)) return;
    try { await api.delete(`/menu/modifiers/${m.id}`); flash('修饰已删除'); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };

  return <Panel title="Modifiers" subtitle="修饰 / 后缀:O / KOS / C / P / K / SP / Tarik / DANGGUT…">
    <div className="ops-form inline">
      <Input label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="O" />
      <Input label="Label" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Kosong" />
      <Input label="Default Delta" type="number" value={form.defaultDelta} onChange={(v) => setForm({ ...form, defaultDelta: v })} placeholder="0" />
      <Input label="Sort Order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="自动" />
      <label className="ops-checkbox"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
      {canEdit && <Action onClick={submit}>{editingId ? 'Save' : '+ Add'}</Action>}
      {editingId && <Action tone="secondary" onClick={() => { setEditingId(null); setForm(emptyModifier()); }}>Cancel</Action>}
      {msg && <span className="ops-saved">{msg}</span>}
    </div>
    <div className="ops-table menu-mod-table">
      <div className="ops-row ops-head"><span>Code</span><span>Label</span><span>Default Delta</span><span>Linked Bases</span><span>Sort</span><span>Status</span><span>Action</span></div>
      {rows.map((m) => <div className="ops-row" key={m.id}>
        <span><b>{m.code}</b></span>
        <span>{m.label || '—'}</span>
        <span>{money2(m.defaultDelta)}</span>
        <span>{lk.baseModifiers.filter((x) => String(x.modifierId) === String(m.id)).length}</span>
        <span>{m.sortOrder ?? '—'}</span>
        <span className={m.isActive ? 'staff-on' : 'staff-off'}>{m.isActive ? 'active' : 'inactive'}</span>
        <span className="ops-inline-actions">
          {canEdit && <button className="mini-action" onClick={() => { setEditingId(m.id); setForm({ code: m.code || '', label: m.label || '', defaultDelta: String(m.defaultDelta ?? 0), sortOrder: m.sortOrder == null ? '' : String(m.sortOrder), isActive: !!m.isActive }); }}>Edit</button>}
          {canEdit && <button className="mini-action danger" onClick={() => remove(m)}>Delete</button>}
        </span>
      </div>)}
      {!rows.length && <Empty />}
    </div>
  </Panel>;
}

// ============================================================ 基底 ↔ 修饰
function BaseModifierPanel({ lk, reloadLookups }) {
  const { can } = useAuth();
  const canEdit = can('menu.edit');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ baseId: '', modifierId: '', delta: '' });
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => setRows((await api.get('/menu/base-modifiers')).data || []);
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.baseId || !form.modifierId) { alert('请选择基底与修饰'); return; }
    try {
      await api.post('/menu/base-modifiers', { baseId: form.baseId, modifierId: form.modifierId, delta: form.delta === '' ? null : Number(form.delta) });
      flash('关联已建立');
      setForm({ baseId: '', modifierId: '', delta: '' }); await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };
  const remove = async (l) => {
    if (!window.confirm('确定解除该关联?')) return;
    try { await api.delete(`/menu/base-modifiers/${l.id}`); flash('关联已解除'); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };
  const baseName = (id) => lk.bases.find((x) => String(x.id) === String(id))?.name || `#${id}`;
  const modName = (id) => { const m = lk.modifiers.find((x) => String(x.id) === String(id)); return m ? `${m.code}${m.label ? ` ${m.label}` : ''}` : `#${id}`; };

  return <Panel title="Base ↔ Modifier" subtitle="哪些修饰可以挂在哪些基底上,以及每个基底的差价覆盖">
    <div className="ops-form inline">
      <Select label="Base" value={form.baseId} onChange={(v) => setForm({ ...form, baseId: v })} options={idOptions(lk.bases)} placeholder="— 选择基底 —" />
      <Select label="Modifier" value={form.modifierId} onChange={(v) => setForm({ ...form, modifierId: v })} options={idOptions(lk.modifiers, (m) => `${m.code}${m.label ? ` ${m.label}` : ''}`)} placeholder="— 选择修饰 —" />
      <Input label="Delta Override" type="number" value={form.delta} onChange={(v) => setForm({ ...form, delta: v })} placeholder="留空 = 用默认" />
      {canEdit && <Action onClick={submit}>+ Link</Action>}
      {msg && <span className="ops-saved">{msg}</span>}
    </div>
    <div className="ops-table tall menu-link-table">
      <div className="ops-row ops-head"><span>Base</span><span>Modifier</span><span>Delta Override</span><span>Action</span></div>
      {rows.map((l) => <div className="ops-row" key={l.id}>
        <span>{baseName(l.baseId)}</span>
        <span>{modName(l.modifierId)}</span>
        <span>{l.delta == null ? '默认' : money2(l.delta)}</span>
        <span className="ops-inline-actions">{canEdit && <button className="mini-action danger" onClick={() => remove(l)}>Unlink</button>}</span>
      </div>)}
      {!rows.length && <Empty text="No links yet" />}
    </div>
  </Panel>;
}

// ============================================================ 主数据(大类/打印组/部门)
const emptyMaster = () => ({ code: '', name: '', sortOrder: '', note: '', isActive: true });

function MasterDataPanel({ kind, title, subtitle, lk, reloadLookups }) {
  const { can } = useAuth();
  const canWrite = can('settings.edit');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyMaster());
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => setRows((await api.get(`/${kind}`)).data || []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kind]);

  const submit = async () => {
    if (!form.name.trim()) { alert('请填写名称'); return; }
    const payload = { code: form.code.trim() || undefined, name: form.name.trim(), sortOrder: num(form.sortOrder), note: form.note || undefined, isActive: form.isActive };
    try {
      if (editingId) await api.put(`/${kind}/${editingId}`, payload);
      else await api.post(`/${kind}`, payload);
      flash(editingId ? '已更新' : '已创建');
      setForm(emptyMaster()); setEditingId(null); await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };
  const toggle = async (r) => {
    try { await api.put(`/${kind}/${r.id}/status`, { isActive: !r.isActive }); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };
  const remove = async (r) => {
    if (!window.confirm(`确定删除「${r.name}」?若仍被分类或商品引用会被拒绝。`)) return;
    try { await api.delete(`/${kind}/${r.id}`); flash('已删除'); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };

  // 被分类引用的次数:让用户在点删除之前就知道会怎样
  const refCount = (r) => {
    if (kind === 'main-groups') return lk.categories.filter((c) => String(c.mainGroupId) === String(r.id)).length;
    if (kind === 'departments') return lk.categories.filter((c) => String(c.departmentId) === String(r.id)).length;
    return null;
  };

  return <Panel title={title} subtitle={subtitle}>
    <div className="ops-form inline">
      <Input label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="留空自动派生" />
      <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="饮料 Beverage" />
      <Input label="Sort Order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="自动" />
      <Input label="Note" value={form.note} onChange={(v) => setForm({ ...form, note: v })} placeholder="可选" />
      <label className="ops-checkbox"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
      {canWrite && <Action onClick={submit}>{editingId ? 'Save' : '+ Add'}</Action>}
      {editingId && <Action tone="secondary" onClick={() => { setEditingId(null); setForm(emptyMaster()); }}>Cancel</Action>}
      {msg && <span className="ops-saved">{msg}</span>}
    </div>
    {!canWrite && <p className="menu-hint">当前账号没有 settings.edit 权限,只能查看。</p>}
    <div className="ops-table menu-master-table">
      <div className="ops-row ops-head"><span>Code</span><span>Name</span><span>Sort</span><span>Used By Categories</span><span>Status</span><span>Note</span><span>Action</span></div>
      {rows.map((r) => <div className="ops-row" key={r.id}>
        <span><b>{r.code || '—'}</b></span>
        <span>{r.name}</span>
        <span>{r.sortOrder ?? '—'}</span>
        <span>{kind === 'print-groups' ? '按商品统计' : refCount(r)}</span>
        <span className={r.isActive ? 'staff-on' : 'staff-off'}>{r.isActive ? 'active' : 'inactive'}</span>
        <span>{r.note || '—'}</span>
        <span className="ops-inline-actions">
          {canWrite && <button className="mini-action" onClick={() => { setEditingId(r.id); setForm({ code: r.code || '', name: r.name || '', sortOrder: r.sortOrder == null ? '' : String(r.sortOrder), note: r.note || '', isActive: !!r.isActive }); }}>Edit</button>}
          {canWrite && <button className="mini-action" onClick={() => toggle(r)}>{r.isActive ? 'Disable' : 'Enable'}</button>}
          {canWrite && <button className="mini-action danger" onClick={() => remove(r)}>Delete</button>}
        </span>
      </div>)}
      {!rows.length && <Empty />}
    </div>
  </Panel>;
}

// ============================================================ 计量单位
const emptyUom = () => ({ code: '', name: '', dimension: 'count', factor: '1', isBase: false, sortOrder: '', note: '', isActive: true });

function UomPanel({ lk, reloadLookups }) {
  const { can } = useAuth();
  const canWrite = can('settings.edit');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyUom());
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => setRows((await api.get('/uoms')).data || []);
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.name.trim()) { alert('请填写单位名称'); return; }
    const payload = {
      code: form.code.trim() || undefined, name: form.name.trim(),
      dimension: form.dimension, factor: num(form.factor) ?? 1, isBase: form.isBase,
      sortOrder: num(form.sortOrder), note: form.note || undefined, isActive: form.isActive,
    };
    try {
      if (editingId) await api.put(`/uoms/${editingId}`, payload);
      else await api.post('/uoms', payload);
      flash(editingId ? '单位已更新' : '单位已创建');
      setForm(emptyUom()); setEditingId(null); await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };
  const remove = async (u) => {
    if (!window.confirm(`确定删除单位「${u.name}」?若仍被商品引用会被拒绝。`)) return;
    try { await api.delete(`/uoms/${u.id}`); flash('单位已删除'); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };

  const byDim = (d) => rows.filter((r) => r.dimension === d);

  return <Panel title="Units of Measure" subtitle="每个量纲(count / weight / volume)只能有一个基准单位,基准单位的换算系数恒为 1">
    <div className="ops-form inline">
      <Input label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="留空自动派生" />
      <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="杯 Cup" />
      <Select label="Dimension" value={form.dimension} onChange={(v) => setForm({ ...form, dimension: v })} options={UOM_DIMENSIONS} />
      <Input label="Factor" type="number" value={form.factor} onChange={(v) => setForm({ ...form, factor: v })} placeholder="1 单位 = ? 基准单位" />
      <Input label="Sort Order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="自动" />
      <label className="ops-checkbox"><input type="checkbox" checked={form.isBase} onChange={(e) => setForm({ ...form, isBase: e.target.checked })} /> Base unit</label>
      {canWrite && <Action onClick={submit}>{editingId ? 'Save' : '+ Add'}</Action>}
      {editingId && <Action tone="secondary" onClick={() => { setEditingId(null); setForm(emptyUom()); }}>Cancel</Action>}
      {msg && <span className="ops-saved">{msg}</span>}
    </div>

    <div className="report-kpis voucher-kpis">
      {UOM_DIMENSIONS.map(([d, label]) => <span key={d}>{label} <b>{byDim(d).length}</b>{byDim(d).some((u) => u.isBase) ? '' : ' · 无基准'}</span>)}
    </div>

    <div className="ops-table tall menu-uom-table">
      <div className="ops-row ops-head"><span>Code</span><span>Name</span><span>Dimension</span><span>Factor</span><span>Base</span><span>Sort</span><span>Status</span><span>Action</span></div>
      {rows.map((u) => <div className="ops-row" key={u.id}>
        <span><b>{u.code}</b></span>
        <span>{u.name}</span>
        <span>{UOM_DIM_LABEL[u.dimension] || u.dimension}</span>
        <span>{u.isBase ? '1(基准)' : u.factor}</span>
        <span>{u.isBase ? <span className="menu-default">基准</span> : '—'}</span>
        <span>{u.sortOrder ?? '—'}</span>
        <span className={u.isActive ? 'staff-on' : 'staff-off'}>{u.isActive ? 'active' : 'inactive'}</span>
        <span className="ops-inline-actions">
          {canWrite && <button className="mini-action" onClick={() => { setEditingId(u.id); setForm({ code: u.code || '', name: u.name || '', dimension: u.dimension || 'count', factor: String(u.factor ?? 1), isBase: !!u.isBase, sortOrder: u.sortOrder == null ? '' : String(u.sortOrder), note: u.note || '', isActive: !!u.isActive }); }}>Edit</button>}
          {canWrite && <button className="mini-action danger" onClick={() => remove(u)}>Delete</button>}
        </span>
      </div>)}
      {!rows.length && <Empty />}
    </div>
  </Panel>;
}

// ============================================================ 价格级别
// 不变量:每个 (org, store) 有且只有一个默认价格级别,它的价就是商品的基础价
// (menu_variants.price)。因此:
//   - 当前默认级别不允许被降级(要换默认,先把别的级别设为默认)
//   - 当前默认级别不允许被删除(删了「基础价」就无处安放,服务端返回 reason:'default_level')
const emptyLevel = () => ({ code: '', name: '', sortOrder: '', note: '', isActive: true, isDefault: false });

function PriceLevelsPanel({ lk, reloadLookups }) {
  const { can } = useAuth();
  const canWrite = can('settings.edit');
  const [rows, setRows] = useState([]);
  const [byLevel, setByLevel] = useState({});
  const [form, setForm] = useState(emptyLevel());
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => {
    const [lv, mx] = await Promise.all([
      api.get('/price-levels').then((r) => r.data || []).catch(() => []),
      // 每个级别被多少个 SKU 设了专属价 —— 只有价目矩阵的 summary 会算这个
      api.get('/menu/price-matrix').then((r) => r.data?.summary?.byLevel || {}).catch(() => ({})),
    ]);
    setRows(lv); setByLevel(mx);
  };
  useEffect(() => { load(); }, []);

  const defRow = rows.find((r) => r.isDefault) || null;
  const isEditingDefault = !!editingId && !!defRow && String(defRow.id) === String(editingId);

  const submit = async () => {
    if (!form.name.trim()) { alert('请填写名称'); return; }
    const payload = {
      code: form.code.trim() || undefined, name: form.name.trim(),
      sortOrder: num(form.sortOrder), note: form.note || undefined, isActive: form.isActive,
      // 正在编辑默认级别时强制保持默认,避免表单状态把「基础价落点」改没了
      isDefault: isEditingDefault ? true : form.isDefault,
    };
    try {
      if (editingId) await api.put(`/price-levels/${editingId}`, payload);
      else await api.post('/price-levels', payload);
      flash(editingId ? '价格级别已更新' : '价格级别已创建');
      setForm(emptyLevel()); setEditingId(null); await load(); await reloadLookups();
    } catch (e) { alert(errText(e)); }
  };
  const makeDefault = async (r) => {
    if (!window.confirm(`把「${r.name}」设为默认价格级别?\n\n商品的基础价会以该级别为准,原默认级别将变为普通级别。`)) return;
    try { await api.put(`/price-levels/${r.id}`, { isDefault: true }); flash(`「${r.name}」已设为默认`); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };
  const toggle = async (r) => {
    try { await api.put(`/price-levels/${r.id}/status`, { isActive: !r.isActive }); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };
  const remove = async (r) => {
    // 默认级别不给删 —— 先本地拦一次给出准确文案,服务端同样会拦(409 reason:'default_level')
    if (r.isDefault) { alert(MENU_ERRORS.default_level); return; }
    if (!window.confirm(`确定删除价格级别「${r.name}」?该级别下所有商品的专属价会一并清除,此后这些商品回落基础价。`)) return;
    try { await api.delete(`/price-levels/${r.id}`); flash('价格级别已删除'); await load(); await reloadLookups(); }
    catch (e) { alert(errText(e)); }
  };

  const overridesOf = (code) => byLevel[String(code).toUpperCase()]?.overrides ?? 0;

  return <Panel title="Price Levels" subtitle="价目分级:零售 / 会员 / 批发 / 员工…默认级别承载基础价,其余级别按 SKU 存专属价">
    <div className="ops-form inline">
      <Input label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="留空自动派生" />
      <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="会员价 Member" />
      <Input label="Sort Order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="自动" />
      <Input label="Note" value={form.note} onChange={(v) => setForm({ ...form, note: v })} placeholder="可选" />
      <label className="ops-checkbox"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
      <label className="ops-checkbox"><input type="checkbox" checked={isEditingDefault || form.isDefault} disabled={isEditingDefault}
        onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> 设为默认级别</label>
      {canWrite && <Action onClick={submit}>{editingId ? 'Save' : '+ Add'}</Action>}
      {editingId && <Action tone="secondary" onClick={() => { setEditingId(null); setForm(emptyLevel()); }}>Cancel</Action>}
      {msg && <span className="ops-saved">{msg}</span>}
    </div>

    <div className="report-kpis voucher-kpis">
      <span>Levels <b>{rows.length}</b></span>
      <span>Default <b>{defRow ? defRow.code : '—'}</b></span>
      <span>SKUs With Overrides <b>{Object.values(byLevel).reduce((s, v) => s + (v?.overrides || 0), 0)}</b></span>
    </div>

    {!canWrite && <p className="menu-hint">当前账号没有 settings.edit 权限,只能查看。</p>}
    <p className="menu-hint">
      默认级别是「基础价」的唯一落点 —— 商品表单里的 Price 字段写的就是它。要换默认级别,先把目标级别设为默认;
      默认级别不允许停用或删除。其余级别在商品表单里留空 = 回落基础价。
    </p>

    <div className="ops-table menu-level-table">
      <div className="ops-row ops-head"><span>Code</span><span>Name</span><span>Sort</span><span>Default</span><span>SKU Overrides</span><span>Status</span><span>Note</span><span>Action</span></div>
      {rows.map((r) => <div className="ops-row" key={r.id}>
        <span><b>{r.code}</b></span>
        <span>{r.name}</span>
        <span>{r.sortOrder ?? '—'}</span>
        <span>{r.isDefault ? <span className="menu-default">基础价落点</span> : '—'}</span>
        <span>{r.isDefault ? <em className="menu-missing">基础价</em> : `${overridesOf(r.code)} 个`}</span>
        <span className={r.isActive ? 'staff-on' : 'staff-off'}>{r.isActive ? 'active' : 'inactive'}</span>
        <span>{r.note || '—'}</span>
        <span className="ops-inline-actions">
          {canWrite && <button className="mini-action" onClick={() => { setEditingId(r.id); setForm({ code: r.code || '', name: r.name || '', sortOrder: r.sortOrder == null ? '' : String(r.sortOrder), note: r.note || '', isActive: !!r.isActive, isDefault: !!r.isDefault }); }}>Edit</button>}
          {canWrite && !r.isDefault && <button className="mini-action" onClick={() => makeDefault(r)}>Set Default</button>}
          {canWrite && !r.isDefault && <button className="mini-action" onClick={() => toggle(r)}>{r.isActive ? 'Disable' : 'Enable'}</button>}
          {canWrite && <button className="mini-action danger" onClick={() => remove(r)}>Delete</button>}
        </span>
      </div>)}
      {!rows.length && <Empty text="No price levels yet" />}
    </div>
  </Panel>;
}

// ============================================================ 价目矩阵
// SKU × 价格级别 一览。每格显示最终价与来源:
//   基础 = 默认级别(就是 menu_variants.price)
//   专属 = 该级别存了覆盖行(variant_prices)
//   继承 = 没有覆盖行,回落基础价
// 有 menu.edit 权限时可直接点格子改价 —— 清空即删除覆盖行。
function PriceMatrixPanel({ lk }) {
  const { can } = useAuth();
  const canEdit = can('menu.edit');
  const [data, setData] = useState({ rows: [], levels: [], summary: {} });
  const [filters, setFilters] = useState({ q: '', categoryId: '', onlyOverrides: false });
  const [edit, setEdit] = useState(null);        // { variantId, code }
  const [draft, setDraft] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2200); };

  const load = async () => {
    const r = await api.get('/menu/price-matrix');
    setData({ rows: r.data?.rows || [], levels: r.data?.levels || [], summary: r.data?.summary || {} });
  };
  useEffect(() => { load(); }, []);

  const levels = data.levels;
  const defCode = (() => {
    const d = levels.find((l) => l.isDefault) || levels[0];
    return d ? String(d.code).toUpperCase() : null;
  })();
  const cellOf = (row, code) => (row.cells || {})[code] || { price: row.basePrice, source: 'base' };

  const shown = data.rows.filter((r) => {
    if (filters.categoryId && String(r.categoryId) !== String(filters.categoryId)) return false;
    if (filters.q.trim()) {
      const q = filters.q.trim().toLowerCase();
      if (!`${r.code || ''} ${r.name || ''}`.toLowerCase().includes(q)) return false;
    }
    if (filters.onlyOverrides && !levels.some((l) => cellOf(r, String(l.code).toUpperCase()).source === 'level')) return false;
    return true;
  });

  const startEdit = (row, code, cell) => {
    if (!canEdit) return;
    setCancelling(false);
    setEdit({ variantId: row.variantId, code });
    setDraft(cell.source === 'level' ? String(cell.price) : '');
  };
  const commit = async (row, code) => {
    const raw = String(draft).trim();
    if (raw !== '' && (Number.isNaN(Number(raw)) || Number(raw) < 0)) { alert('请输入有效价格'); return; }
    setBusy(true);
    try {
      // 单个级别一条:price 传 null = 删除覆盖行,回落基础价
      await api.put(`/menu/variants/${row.variantId}/prices`, { prices: [{ levelCode: code, price: raw === '' ? null : Number(raw) }] });
      setEdit(null); setDraft('');
      await load();
      flash(raw === '' ? '已清除专属价,回落基础价' : '专属价已保存');
    } catch (e) { alert(errText(e)); }
    finally { setBusy(false); }
  };

  const overrideCount = (row) => levels.filter((l) => cellOf(row, String(l.code).toUpperCase()).source === 'level').length;
  const lowestOf = (row) => {
    const ps = levels.map((l) => Number(cellOf(row, String(l.code).toUpperCase()).price || 0)).filter((n) => n > 0);
    return ps.length ? Math.min(...ps) : Number(row.basePrice || 0);
  };

  // 列数是数据驱动的(价格级别可增删),所以网格模板在运行时拼,不写死 CSS 类
  const grid = ['86px', 'minmax(140px, 1.6fr)', '104px', '70px', ...levels.map(() => '94px'), '96px'].join(' ');

  return <Panel title="Price Matrix" subtitle="SKU × 价格级别 价目一览,点格子即可改价(清空 = 回落基础价)"
    right={<Action tone="secondary" onClick={load}>Reload</Action>}>
    <div className="report-kpis voucher-kpis">
      <span>Levels <b>{data.summary.levels ?? levels.length}</b></span>
      <span>SKUs <b>{data.summary.variants ?? data.rows.length}</b></span>
      <span>Override Cells <b>{data.summary.overrides ?? 0}</b></span>
      <span>Fallback Cells <b>{data.summary.fallbacks ?? 0}</b></span>
      <span>Override Rows <b>{data.summary.overrideRows ?? 0}</b></span>
    </div>

    <div className="ops-form inline">
      <Input label="Search" value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="编码 / 名称" />
      <Select label="Category" value={filters.categoryId} onChange={(v) => setFilters({ ...filters, categoryId: v })} options={idOptions(lk.categories)} placeholder="All" />
      <label className="ops-checkbox"><input type="checkbox" checked={filters.onlyOverrides} onChange={(e) => setFilters({ ...filters, onlyOverrides: e.target.checked })} /> 仅看有专属价</label>
      {msg && <span className="ops-saved">{msg}</span>}
    </div>
    {!canEdit && <p className="menu-hint">当前账号没有 menu.edit 权限,只能查看价目。</p>}

    {!levels.length
      ? <Empty text="还没有价格级别,请先到 Price Levels 页签建立" />
      : <div className="ops-table tall menu-matrix-table">
        <div className="ops-row ops-head" style={{ gridTemplateColumns: grid }}>
          <span>Code</span><span>Product</span><span>Category</span><span>Cost</span>
          {levels.map((l) => {
            const code = String(l.code).toUpperCase();
            return <span key={code} className={code === defCode ? 'matrix-head-default' : ''} title={l.name}>
              {l.code}{code === defCode ? ' *' : ''}
            </span>;
          })}
          <span>Pricing</span>
        </div>
        {shown.map((row) => {
          const n = overrideCount(row);
          const lowest = lowestOf(row);
          const margin = Number(row.cost) > 0 && lowest > 0 ? ((lowest - Number(row.cost)) / lowest) * 100 : null;
          return <div className="ops-row" key={row.variantId} style={{ gridTemplateColumns: grid }}>
            <span><b>{row.code}</b></span>
            <span>{row.name}{!row.isActive && <small className="member-sub">已停用</small>}</span>
            <span>{row.categoryName || '—'}</span>
            <span>{money2(row.cost)}</span>
            {levels.map((l) => {
              const code = String(l.code).toUpperCase();
              const cell = cellOf(row, code);
              const isDef = code === defCode;
              const editing = !!edit && edit.variantId === row.variantId && edit.code === code;
              const kind = isDef ? 'is-default' : cell.source === 'level' ? 'is-override' : 'is-fallback';
              return <span key={code} className={`matrix-cell ${kind}`}>
                {editing
                  ? <input autoFocus className="matrix-input" value={draft} disabled={busy}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      if (cancelling) { setCancelling(false); setEdit(null); setDraft(''); return; }
                      commit(row, code);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                      if (e.key === 'Escape') { e.preventDefault(); setCancelling(true); e.currentTarget.blur(); }
                    }} />
                  : <button type="button" className="matrix-value" disabled={!canEdit}
                    title={isDef ? '默认级别:改这里等于改商品基础价' : cell.source === 'level' ? '专属价:存了覆盖行' : '继承:回落基础价,点击可设专属价'}
                    onClick={() => startEdit(row, code, cell)}>
                    {money2(cell.price)}
                    <small>{isDef ? '基础' : cell.source === 'level' ? '专属' : '继承'}</small>
                  </button>}
              </span>;
            })}
            <span>{n > 0
              ? <span className="menu-default">{n}/{levels.length} 专属</span>
              : <em className="menu-missing">全部基础</em>}
              {margin != null && <small className="member-sub">毛利 {margin.toFixed(1)}%</small>}</span>
          </div>;
        })}
        {!shown.length && <Empty text="No products match the filters" />}
      </div>}
    <p className="menu-hint">
      带 <b>*</b> 的列是默认价格级别 —— 改它等于直接改商品基础价(收据 / 报表 / 小票都读这个价)。
      「专属」表示该 SKU 在这个级别存了覆盖价;「继承」表示没有覆盖行、按基础价成交。
      毛利率按该 SKU 所有级别里的最低售价估算,是保守口径。
    </p>
  </Panel>;
}
