import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';

// perm 有值时按「按键权限」显示(后台权限矩阵可授予/收回);
// 没有对应按键的条目才回落到 roles 判断。
const NAV = [
  { feature: 'sales', label: 'Sales', icon: '⚑', perm: 'order.create' },
  { feature: 'cash-in', label: 'Cash In', icon: '▰', perm: 'payment.cash_move' },
  { feature: 'withdraw', label: 'Withdraw', icon: '♢', perm: 'payment.cash_move' },
  { feature: 'payment', label: 'Payment', icon: '▱', perm: 'payment.settle' },
  { feature: 'credit-note', label: 'Credit Note', icon: '▰', perm: 'payment.credit_note' },
  { feature: 'refund', label: 'Refund', icon: '↩', perm: 'payment.refund' },
  { feature: 'reprint', label: 'Reprint', icon: '⎙', perm: 'reprint' },
  { feature: 'void-approval', label: 'Void Approval', icon: '⊘', perm: 'order.void_approve' },
  { feature: 'received', label: 'Received', icon: '♨', perm: 'payment.settle' },
  { feature: 'drawer', label: 'Open Drawer', icon: '▣', perm: 'payment.open_drawer' },
  { feature: 'close-shift', label: 'Close shift', icon: '◉', perm: 'shift.manage' },
  { feature: 'daily-sales', label: 'Daily sales', icon: '▱', perm: 'report.view' },
  { feature: 'reports', label: 'Reports', icon: '◌', perm: 'report.view' },
  { feature: 'attendance', label: 'Attendance', icon: '◍', perm: 'shift.manage' },
  { feature: 'back-office', label: 'Back Office', icon: '⚙', perm: 'settings.edit' },
  { feature: 'password', label: 'Password', icon: '▣', roles: ['admin', 'manager', 'cashier', 'waiter', 'kitchen'] },
];

const FEATURE_TABS = {
  'cash-in': 'finance', withdraw: 'finance', payment: 'finance', 'credit-note': 'finance', received: 'finance',
  refund: 'refunds', reprint: 'reprint', 'void-approval': 'voids', 'close-shift': 'shifts', 'daily-sales': 'day-end', attendance: 'attendance', reports: 'reports',
};

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const nav = NAV.filter((n) => (n.perm ? can(n.perm) : n.roles.includes(user.role)));

  const go = (item) => {
    if (item.to) navigate(item.to);
    else if (item.feature === 'drawer') { api.post('/hardware/drawer', {}).catch(() => {}); alert('钱箱开启指令已发送（ESC/POS）'); }
    else if (item.feature === 'back-office') navigate('/backoffice');
    else if (FEATURE_TABS[item.feature]) navigate(`/operations?tab=${FEATURE_TABS[item.feature]}`);
    else navigate(`/desktop?feature=${item.feature}`);
  };

  return (
    <div className="legacy-app-shell">
      <aside className="legacy-sidebar">
        <div className="legacy-sidebar-title">Food and Beverage<br />Management</div>
        <nav>
          {nav.map((item) => item.to ? (
            <NavLink key={item.label} to={item.to} className={({ isActive }) => `legacy-nav-item ${isActive ? 'active' : ''}`}>
              <span>{item.icon}</span>{item.label}
            </NavLink>
          ) : (
            <button key={item.label} className="legacy-nav-item" onClick={() => go(item)}><span>{item.icon}</span>{item.label}</button>
          ))}
          <button className="legacy-nav-item exit" onClick={() => { logout(); navigate('/login'); }}><span>◀</span>Exit</button>
        </nav>
        <div className="legacy-user">{user.name}<br /><small>{user.role}</small></div>
      </aside>
      <main className="legacy-main"><Outlet /></main>
    </div>
  );
}
