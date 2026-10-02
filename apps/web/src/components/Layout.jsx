import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';

const NAV = [
  { feature: 'sales', label: 'Sales', icon: '⚑', roles: ['admin', 'manager', 'cashier', 'waiter'] },
  { feature: 'cash-in', label: 'Cash In', icon: '▰', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'withdraw', label: 'Withdraw', icon: '♢', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'payment', label: 'Payment', icon: '▱', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'credit-note', label: 'Credit Note', icon: '▰', roles: ['admin', 'manager'] },
  { feature: 'refund', label: 'Refund', icon: '↩', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'reprint', label: 'Reprint', icon: '⎙', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'void-approval', label: 'Void Approval', icon: '⊘', roles: ['admin', 'manager'] },
  { feature: 'received', label: 'Received', icon: '♨', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'drawer', label: 'Open Drawer', icon: '▣', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'close-shift', label: 'Close shift', icon: '◉', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'daily-sales', label: 'Daily sales', icon: '▱', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'reports', label: 'Reports', icon: '◌', roles: ['admin', 'manager'] },
  { feature: 'attendance', label: 'Attendance', icon: '◍', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'back-office', label: 'Back Office', icon: '⚙', roles: ['admin', 'manager'] },
  { feature: 'password', label: 'Password', icon: '▣', roles: ['admin', 'manager', 'cashier', 'waiter', 'kitchen'] },
];

const FEATURE_TABS = {
  'cash-in': 'finance', withdraw: 'finance', payment: 'finance', 'credit-note': 'finance', received: 'finance',
  refund: 'refunds', reprint: 'reprint', 'void-approval': 'voids', 'close-shift': 'shifts', attendance: 'attendance', reports: 'reports',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = NAV.filter((n) => n.roles.includes(user.role));

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
