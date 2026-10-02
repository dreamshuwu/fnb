import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';

const FEATURE_INFO = {
  'cash-in': { title: 'Cash-In', fields: ['Date', 'Cashier ID', 'Amount'], columns: ['DATE', 'Cashier ID', 'AMOUNT', 'TIME', 'REMARK'] },
  withdraw: { title: 'Withdraw Voucher', fields: ['Pay To', 'Amount', 'For'], columns: ['VOUCHER', 'PAY TO', 'AMOUNT', 'FOR', 'DATE'] },
  payment: { title: 'Payment / Pay Out', fields: ['Voucher', 'Pay To', 'Amount', 'For'], columns: ['VOUCHER', 'PAY TO', 'AMOUNT', 'FOR', 'DATE'] },
  'credit-note': { title: 'Credit Note', fields: ['CREDIT NO', 'CUST NAME', 'DATE', 'ORDER NO', 'REMARK'], columns: ['CODE', 'DESCRIPTION', 'LOCATION', 'QUANTITY', 'UOM', 'RETAIL', 'GST'] },
  received: { title: 'Cash Receivable / Receive Payment', fields: ['A/C No.', 'RV No.', 'RV Date', 'Cash/Cheque No.', 'Pay Amount'], columns: ['A/C', 'DATE', 'INVOICE', 'AMOUNT', 'RV No.', 'CHQ No.', 'CHQ DATE'] },
  'close-shift': { title: 'Close Shift / Settlement', fields: ['Amount Counted', 'Expected Amount', 'Difference'], columns: ['CASHIER', 'OPEN', 'EXPECTED', 'COUNTED', 'DIFFERENCE', 'TIME'] },
  'daily-sales': { title: 'End of Day Sales', fields: ['Date'], columns: ['DATE', 'CASH', 'CARD', 'CREDIT', 'TOTAL'] },
  attendance: { title: 'Attendance', fields: ['Start Code', 'End Code', 'Start Date', 'End Date'], columns: ['CODE', 'NAME', 'SIGN IN', 'SIGN OUT', 'STATUS'] },
};

const REPORTS = [
  'Cash Bill', 'Cash Receipt', 'Tax Invoice', 'CloseShift', 'Reprint-CloseShift', 'Reprint-Cash Bill',
  'Sales By Date', 'Sales By Product', 'Product Listing Summary', 'Product Listing Detail', 'Day End',
  'Sales By Hour', 'Payout', 'Discount', 'Cash In', 'Void', 'Send Order', 'Kitchen Copy', 'Stall Copy 1',
  'Knock Off Bill', 'Full Tax Invoice', 'Payment Type', 'Stock Report', 'Member Points',
];

export default function DesktopPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const feature = new URLSearchParams(location.search).get('feature');
  const [showReports, setShowReports] = useState(feature === 'reports');
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setShowReports(feature === 'reports'), [feature]);

  const goFeature = (key) => {
    if (key === 'sales') return navigate('/desktop?feature=sales');
    if (key === 'tables') return navigate('/tables');
    if (key === 'menu') return navigate('/menu');
    if (key === 'inventory') return navigate('/inventory');
    if (key === 'reports') return navigate('/operations?tab=reports');
    if (key === 'cash-in' || key === 'close-shift') return navigate(`/operations?tab=${key === 'close-shift' ? 'shifts' : 'finance'}`);
    navigate(`/desktop?feature=${key}`);
  };

  // perm 有值就按按键权限显示(后台矩阵可授予/收回),否则回落到角色
  const ALL_ACTIONS = [
    ['sales', 'Sales', 'Start a new order', 'accent', 'order.create'],
    ['cash-in', 'Cash In', 'Record cash received', 'mint', 'payment.cash_move'],
    ['close-shift', 'Close Shift', 'Settle the current shift', 'gold', 'shift.manage'],
    ['reports', 'Reports', 'Open sales reports', 'lavender', 'report.view'],
    ['tables', 'Floor Plan', 'View tables and sales', 'sky', 'order.create'],
    ['menu', 'Menu Control', 'Edit products and prices', 'rose', 'menu.edit'],
  ];
  const actions = ALL_ACTIONS.filter(([, , , , perm]) => can(perm));

  return (
    <div className="modern-dashboard">
      <section className="modern-welcome">
        <div>
          <div className="modern-eyebrow">SMPOS / OPERATIONS</div>
          <h1>Good evening, {user?.name || localStorage.getItem('userName') || 'Cashier'}</h1>
          <p>Your store is ready for service. Choose a workspace to continue.</p>
        </div>
        <div className="modern-time"><strong>{clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong><span>{clock.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' })}</span></div>
      </section>

      <section className="modern-status-row">
        <div className="modern-status-card"><span className="status-dot green" /><div><small>Service status</small><strong>Ready to trade</strong></div></div>
        <div className="modern-status-card"><span className="status-icon">$</span><div><small>Today&apos;s sales</small><strong>¥0.00</strong></div></div>
        <div className="modern-status-card"><span className="status-icon">▦</span><div><small>Open tables</small><strong>0 / 3</strong></div></div>
        <div className="modern-status-card"><span className="status-icon">⌁</span><div><small>Shift</small><strong>Not closed</strong></div></div>
      </section>

      <section className="modern-section-heading"><div><h2>Quick workspace</h2><p>Frequently used operations</p></div><span>Demo Store</span></section>
      <section className="modern-action-grid">
        {actions.map(([key, title, subtitle, tone]) => <button key={key} className={`modern-action-card ${tone}`} onClick={() => goFeature(key)}><span className="modern-action-symbol">{key === 'sales' ? '+' : key === 'reports' ? '▥' : key === 'tables' ? '▦' : key === 'menu' ? '≡' : key === 'close-shift' ? '✓' : '$'}</span><span><strong>{title}</strong><small>{subtitle}</small></span><b>→</b></button>)}
        {!actions.length && <div className="modern-action-empty">当前角色没有可用的工作区,请联系管理员在「Back Office → Permissions」里授权。</div>}
      </section>

      <section className="modern-lower-grid">
        <div className="modern-info-card"><div className="modern-card-heading"><span>Shift checklist</span><small>Today</small></div><div className="check-row done"><span>✓</span>Sign in as cashier<strong>Done</strong></div><div className="check-row"><span>2</span>Open the first table<strong>Next</strong></div><div className="check-row"><span>3</span>Close shift at the end<strong>Pending</strong></div></div>
        <div className="modern-info-card accent-card"><div className="modern-card-heading"><span>Shortcut</span><small>Fast access</small></div><h3>Start taking orders</h3><p>Use the Sales screen for dine-in, takeaway and member orders.</p><button onClick={() => goFeature('sales')}>Open Sales <b>→</b></button></div>
      </section>

      {feature === 'sales' && <SalesWindow onClose={() => navigate('/')} onCashier={() => navigate('/cashier')} navigate={navigate} />}
      {feature === 'password' && <AccountWindow onClose={() => navigate('/')} />}
      {feature && feature !== 'sales' && feature !== 'reports' && feature !== 'password' && FEATURE_INFO[feature] && <FeatureWindow info={FEATURE_INFO[feature]} onClose={() => navigate('/')} />}
      {showReports && <ReportWindow onClose={() => navigate('/')} />}
    </div>
  );
}

function Shortcut({ title, color, onClick }) {
  return <button className={`legacy-shortcut ${color}`} onClick={onClick}><span className="shortcut-icon">◆</span>{title}</button>;
}

function SalesWindow({ onClose, onCashier, navigate }) {
  return <div className="legacy-window-wrap"><section className="legacy-window sales-window"><header><span>▣ Sales</span><button onClick={onClose}>×</button></header><div className="sales-submenu">
    <button className="sales-submenu-item" onClick={onCashier}><b>▣</b> Sales / Cashier Screen</button>
    <button className="sales-submenu-item" onClick={() => { onClose(); navigate('/operations?tab=members'); }}><b>♨</b> Knock Off Bill</button>
    <button className="sales-submenu-item" onClick={() => { onClose(); navigate('/operations?tab=members'); }}><b>♨</b> Member Top Up</button>
    <button className="sales-submenu-item" onClick={() => { onClose(); navigate('/operations?tab=members'); }}><b>♨</b> Calculate Member Points</button>
    <div className="legacy-window-actions"><button className="legacy-btn pink" onClick={onClose}>Exit</button></div>
  </div></section></div>;
}

// ---------------------------------------------------------------------------
// Account:真实改密 + PIN 设置 + 换班(与桌面 POS 的 Password 菜单对应)
// ---------------------------------------------------------------------------
function AccountWindow({ onClose }) {
  const { user, loginWithPin } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('password');

  const [pw, setPw] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [pinForm, setPinForm] = useState({ password: '', pin: '' });
  const [switchPin, setSwitchPin] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const flash = (t) => { setMsg(t); setErr(''); setTimeout(() => setMsg(''), 2500); };
  const fail = (t) => { setErr(t); setMsg(''); };

  const changePassword = async () => {
    setErr(''); setMsg('');
    if (!pw.oldPassword || !pw.newPassword) return fail('请填写旧密码与新密码');
    if (pw.newPassword.length < 6) return fail('新密码至少 6 位');
    if (pw.newPassword !== pw.confirm) return fail('两次输入的新密码不一致');
    try {
      await api.put('/auth/password', { oldPassword: pw.oldPassword, newPassword: pw.newPassword });
      setPw({ oldPassword: '', newPassword: '', confirm: '' });
      flash('密码已修改,下次登录请使用新密码');
    } catch (e) { fail(e.response?.data?.error || '修改失败'); }
  };

  const savePin = async () => {
    setErr(''); setMsg('');
    if (!pinForm.password) return fail('请输入当前登录密码以确认');
    if (pinForm.pin && !/^\d{4,6}$/.test(pinForm.pin)) return fail('PIN 必须是 4-6 位数字');
    try {
      const r = await api.put('/auth/pin', { password: pinForm.password, pin: pinForm.pin });
      setPinForm({ password: '', pin: '' });
      flash(r.data.hasPin ? 'PIN 已设置,可在登录页用它快速登录' : 'PIN 已清除');
    } catch (e) { fail(e.response?.data?.error || 'PIN 保存失败'); }
  };

  const switchUser = async () => {
    setErr(''); setMsg('');
    if (switchPin.length < 4) return fail('PIN 至少 4 位');
    try {
      const u = await loginWithPin(switchPin, { storeId: user.storeId });
      setSwitchPin('');
      navigate(u.role === 'kitchen' ? '/kds' : '/');
    } catch (e) {
      setSwitchPin('');
      fail(e.response?.status === 429 ? (e.response?.data?.error || '尝试次数过多') : 'PIN 不正确');
    }
  };

  return (
    <div className="legacy-window-wrap">
      <section className="legacy-window large">
        <header><span>▣ Account · {user?.name} ({user?.employeeNo || user?.role})</span><button onClick={onClose}>×</button></header>
        <div className="legacy-window-body">
          <div className="login-mode-switch account-switch">
            <button className={tab === 'password' ? 'active' : ''} onClick={() => { setTab('password'); setErr(''); }}>Change Password</button>
            <button className={tab === 'pin' ? 'active' : ''} onClick={() => { setTab('pin'); setErr(''); }}>Set PIN</button>
            <button className={tab === 'switch' ? 'active' : ''} onClick={() => { setTab('switch'); setErr(''); }}>Switch User</button>
          </div>

          {tab === 'password' && <>
            <h2>Change Password</h2>
            <div className="legacy-form-row">
              <label>Old Password<input type="password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} /></label>
              <label>New Password<input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></label>
              <label>Confirm New<input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
            </div>
            <div className="legacy-window-actions">
              <button className="legacy-btn green" onClick={changePassword}>Save</button>
              <button className="legacy-btn yellow" onClick={() => setPw({ oldPassword: '', newPassword: '', confirm: '' })}>Clear</button>
              <button className="legacy-btn pink" onClick={onClose}>Exit</button>
            </div>
            <div className="account-note">新密码不能与旧密码相同,至少 6 位。修改后当前会话仍有效,下次登录用新密码。</div>
          </>}

          {tab === 'pin' && <>
            <h2>Set PIN {user?.hasPin ? <small className="account-badge on">已设置</small> : <small className="account-badge">未设置</small>}</h2>
            <div className="legacy-form-row">
              <label>Current Password<input type="password" value={pinForm.password} onChange={(e) => setPinForm({ ...pinForm, password: e.target.value })} /></label>
              <label>New PIN (4-6 digits)<input value={pinForm.pin} onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="留空 = 清除 PIN" /></label>
            </div>
            <div className="pin-pad inline">
              {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['Clear', '0', 'Back']].flat().map((k) => (
                <button key={k} type="button" className="pin-key" onClick={() => setPinForm((f) => ({
                  ...f,
                  pin: k === 'Clear' ? '' : k === 'Back' ? f.pin.slice(0, -1) : (f.pin.length >= 6 ? f.pin : f.pin + k),
                }))}>{k === 'Back' ? '⌫' : k}</button>
              ))}
            </div>
            <div className="legacy-window-actions">
              <button className="legacy-btn green" onClick={savePin}>Save PIN</button>
              <button className="legacy-btn yellow" onClick={() => setPinForm({ password: pinForm.password, pin: '' })}>Clear PIN</button>
              <button className="legacy-btn pink" onClick={onClose}>Exit</button>
            </div>
            <div className="account-note">PIN 用于登录页快捷登录与收银台换班,只需 4-6 位数字。设置/清除都需要当前登录密码确认。</div>
          </>}

          {tab === 'switch' && <>
            <h2>Switch User <small className="account-badge">当前 {user?.name}</small></h2>
            <div className="legacy-form-row">
              <label>PIN<input type="password" value={switchPin} onChange={(e) => setSwitchPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            </div>
            <div className="pin-pad inline">
              {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['Clear', '0', 'Back']].flat().map((k) => (
                <button key={k} type="button" className="pin-key" onClick={() => setSwitchPin((p) => (k === 'Clear' ? '' : k === 'Back' ? p.slice(0, -1) : (p.length >= 6 ? p : p + k)))}>{k === 'Back' ? '⌫' : k}</button>
              ))}
            </div>
            <div className="legacy-window-actions">
              <button className="legacy-btn green" onClick={switchUser}>Switch</button>
              <button className="legacy-btn pink" onClick={onClose}>Exit</button>
            </div>
            <div className="account-note">输入本店其他员工的 PIN 即可换班,无需退出登录。连续 5 次错误将锁定 60 秒。</div>
          </>}

          {err && <div className="account-msg error">{err}</div>}
          {msg && <div className="account-msg ok">{msg}</div>}
        </div>
      </section>
    </div>
  );
}

function FeatureWindow({ info, onClose }) {
  const [values, setValues] = useState({});
  return (
    <div className="legacy-window-wrap">
      <section className="legacy-window large">
        <header><span>▣ {info.title}</span><button onClick={onClose}>×</button></header>
        <div className="legacy-window-body">
          <h2>{info.title}</h2>
          <div className="legacy-form-row">
            {info.fields.map((field) => (
              <label key={field}>{field}<input value={values[field] || ''} onChange={(e) => setValues({ ...values, [field]: e.target.value })} /></label>
            ))}
          </div>
          <div className="legacy-table"><div className="legacy-table-head">{info.columns.map((c) => <span key={c}>{c}</span>)}</div><div className="legacy-empty-row">暂无记录</div></div>
          <div className="legacy-window-actions"><button className="legacy-btn green" onClick={() => alert('已保存')}>Save</button><button className="legacy-btn yellow">Calculator</button><button className="legacy-btn pink" onClick={onClose}>Exit</button></div>
          <VirtualKeyboard compact />
        </div>
      </section>
    </div>
  );
}

function ReportWindow({ onClose }) {
  return (
    <div className="legacy-window-wrap">
      <section className="legacy-window report-window">
        <header><span>▣ Design Report Layout</span><button onClick={onClose}>×</button></header>
        <div className="report-button-grid">
          {REPORTS.map((name, i) => <button key={name} className={`report-tile tone-${i % 6}`}>{name}</button>)}
          <button className="report-tile tone-4" onClick={onClose}>Exit</button>
        </div>
      </section>
    </div>
  );
}

export function VirtualKeyboard({ compact = false }) {
  const rows = [['1','2','3','4','5','6','7','8','9','0','Back'], ['Q','W','E','R','T','Y','U','I','O','P'], ['A','S','D','F','G','H','J','K','L','Enter'], ['Z','X','C','V','B','N','M','<','>','Tab']];
  return <div className={`virtual-keyboard ${compact ? 'compact' : ''}`}>{rows.map((row, ri) => <div className="vk-row" key={ri}>{row.map((key) => <button key={key}>{key}</button>)}</div>)}</div>;
}
