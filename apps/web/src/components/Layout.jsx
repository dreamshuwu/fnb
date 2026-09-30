import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const NAV = [
  { feature: 'sales', label: 'Sales', icon: '⚑', roles: ['admin', 'manager', 'cashier', 'waiter'] },
  { feature: 'cash-in', label: 'Cash In', icon: '▰', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'withdraw', label: 'Withdraw', icon: '♢', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'payment', label: 'Payment', icon: '▱', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'credit-note', label: 'Credit Note', icon: '▰', roles: ['admin', 'manager'] },
  { feature: 'received', label: 'Received', icon: '♨', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'drawer', label: 'Open Drawer', icon: '▣', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'close-shift', label: 'Close shift', icon: '◉', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'daily-sales', label: 'Daily sales', icon: '▱', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'reports', label: 'Reports', icon: '◌', roles: ['admin', 'manager'] },
  { feature: 'attendance', label: 'Attendance', icon: '◍', roles: ['admin', 'manager', 'cashier'] },
  { feature: 'password', label: 'Password', icon: '▣', roles: ['admin', 'manager', 'cashier', 'waiter', 'kitchen'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = NAV.filter((n) => n.roles.includes(user.role));

  const go = (item) => {
    if (item.to) navigate(item.to);
    else if (item.feature === 'drawer') alert('钱箱开启指令已发送（浏览器版会在硬件连接后执行）');
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
