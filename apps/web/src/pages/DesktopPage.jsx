import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const FEATURE_INFO = {
  'cash-in': { title: 'Cash-In', fields: ['Date', 'Cashier ID', 'Amount'], columns: ['DATE', 'Cashier ID', 'AMOUNT', 'TIME', 'REMARK'] },
  withdraw: { title: 'Withdraw Voucher', fields: ['Pay To', 'Amount', 'For'], columns: ['VOUCHER', 'PAY TO', 'AMOUNT', 'FOR', 'DATE'] },
  payment: { title: 'Payment / Pay Out', fields: ['Voucher', 'Pay To', 'Amount', 'For'], columns: ['VOUCHER', 'PAY TO', 'AMOUNT', 'FOR', 'DATE'] },
  'credit-note': { title: 'Credit Note', fields: ['CREDIT NO', 'CUST NAME', 'DATE', 'ORDER NO', 'REMARK'], columns: ['CODE', 'DESCRIPTION', 'LOCATION', 'QUANTITY', 'UOM', 'RETAIL', 'GST'] },
  received: { title: 'Cash Receivable / Receive Payment', fields: ['A/C No.', 'RV No.', 'RV Date', 'Cash/Cheque No.', 'Pay Amount'], columns: ['A/C', 'DATE', 'INVOICE', 'AMOUNT', 'RV No.', 'CHQ No.', 'CHQ DATE'] },
  'close-shift': { title: 'Close Shift / Settlement', fields: ['Amount Counted', 'Expected Amount', 'Difference'], columns: ['CASHIER', 'OPEN', 'EXPECTED', 'COUNTED', 'DIFFERENCE', 'TIME'] },
  'daily-sales': { title: 'End of Day Sales', fields: ['Date'], columns: ['DATE', 'CASH', 'CARD', 'CREDIT', 'TOTAL'] },
  attendance: { title: 'Attendance', fields: ['Start Code', 'End Code', 'Start Date', 'End Date'], columns: ['CODE', 'NAME', 'SIGN IN', 'SIGN OUT', 'STATUS'] },
  password: { title: 'Change Password', fields: ['User', 'Old Password', 'New Password', 'Confirm New Password'], columns: [] },
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
    if (key === 'reports') return navigate('/desktop?feature=reports');
    navigate(`/desktop?feature=${key}`);
  };

  const actions = [
    ['sales', 'Sales', 'Start a new order', 'accent'],
    ['cash-in', 'Cash In', 'Record cash received', 'mint'],
    ['close-shift', 'Close Shift', 'Settle the current shift', 'gold'],
    ['reports', 'Reports', 'Open sales reports', 'lavender'],
    ['tables', 'Floor Plan', 'View tables and sales', 'sky'],
    ['menu', 'Menu Control', 'Edit products and prices', 'rose'],
  ];

  return (
    <div className="modern-dashboard">
      <section className="modern-welcome">
        <div>
          <div className="modern-eyebrow">SMPOS / OPERATIONS</div>
          <h1>Good evening, {localStorage.getItem('userName') || 'Cashier'}</h1>
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
      </section>

      <section className="modern-lower-grid">
        <div className="modern-info-card"><div className="modern-card-heading"><span>Shift checklist</span><small>Today</small></div><div className="check-row done"><span>✓</span>Sign in as cashier<strong>Done</strong></div><div className="check-row"><span>2</span>Open the first table<strong>Next</strong></div><div className="check-row"><span>3</span>Close shift at the end<strong>Pending</strong></div></div>
        <div className="modern-info-card accent-card"><div className="modern-card-heading"><span>Shortcut</span><small>Fast access</small></div><h3>Start taking orders</h3><p>Use the Sales screen for dine-in, takeaway and member orders.</p><button onClick={() => goFeature('sales')}>Open Sales <b>→</b></button></div>
      </section>

      {feature === 'sales' && <SalesWindow onClose={() => navigate('/')} onCashier={() => navigate('/cashier')} />}
      {feature && feature !== 'sales' && feature !== 'reports' && FEATURE_INFO[feature] && <FeatureWindow info={FEATURE_INFO[feature]} onClose={() => navigate('/')} />}
      {showReports && <ReportWindow onClose={() => navigate('/')} />}
    </div>
  );
}

function Shortcut({ title, color, onClick }) {
  return <button className={`legacy-shortcut ${color}`} onClick={onClick}><span className="shortcut-icon">◆</span>{title}</button>;
}

function SalesWindow({ onClose, onCashier }) {
  return <div className="legacy-window-wrap"><section className="legacy-window sales-window"><header><span>▣ Sales</span><button onClick={onClose}>×</button></header><div className="sales-submenu"><button className="sales-submenu-item" onClick={onCashier}><b>▣</b> Sales / Cashier Screen</button><button className="sales-submenu-item" onClick={() => alert('Knock Off Bill：会员账单结算窗口已预留，下一步接会员 API。')}><b>♨</b> Knock Off Bill</button><button className="sales-submenu-item" onClick={() => alert('Member Top Up：会员充值窗口已预留，下一步接会员 API。')}><b>♨</b> Member Top Up</button><button className="sales-submenu-item" onClick={() => alert('Calculate Member Points：积分计算窗口已预留。')}><b>♨</b> Calculate Member Points</button><div className="legacy-window-actions"><button className="legacy-btn pink" onClick={onClose}>Exit</button></div></div></section></div>;
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
