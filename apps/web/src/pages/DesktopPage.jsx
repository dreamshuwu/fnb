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

  return (
    <div className="legacy-desktop">
      <div className="legacy-brand-mark">SMPOS <small>F&amp;B MANAGEMENT SYSTEM</small></div>
      <div className="legacy-desktop-title">Food and Beverage Management</div>
      <div className="legacy-desktop-copy">COMPUTERISED POINT OF SALE</div>
      <div className="legacy-clock">{clock.toLocaleDateString('en-GB')} {clock.toLocaleTimeString('en-GB')}</div>

      <div className="legacy-launch-grid">
        <Shortcut title="Sales" color="green" onClick={() => goFeature('sales')} />
        <Shortcut title="Cash In" color="yellow" onClick={() => goFeature('cash-in')} />
        <Shortcut title="Withdraw" color="pink" onClick={() => goFeature('withdraw')} />
        <Shortcut title="Payment" color="blue" onClick={() => goFeature('payment')} />
        <Shortcut title="Credit Note" color="purple" onClick={() => goFeature('credit-note')} />
        <Shortcut title="Received" color="green" onClick={() => goFeature('received')} />
        <Shortcut title="Open Drawer" color="orange" onClick={() => alert('钱箱开启指令已发送（浏览器版会在硬件连接后执行）')} />
        <Shortcut title="Close Shift" color="pink" onClick={() => goFeature('close-shift')} />
        <Shortcut title="Daily Sales" color="yellow" onClick={() => goFeature('daily-sales')} />
        <Shortcut title="Reports" color="blue" onClick={() => goFeature('reports')} />
        <Shortcut title="Attendance" color="green" onClick={() => goFeature('attendance')} />
        <Shortcut title="Password" color="purple" onClick={() => goFeature('password')} />
      </div>

      <div className="legacy-home-hint">选择左侧功能，或点击上方快捷按钮开始操作</div>
      <div className="legacy-keyboard"><VirtualKeyboard /></div>

      {feature === 'sales' && <SalesWindow onClose={() => navigate('/')} onCashier={() => navigate('/cashier')} />}
      {feature && feature !== 'sales' && feature !== 'reports' && FEATURE_INFO[feature] && (
        <FeatureWindow info={FEATURE_INFO[feature]} onClose={() => navigate('/')} />
      )}
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
