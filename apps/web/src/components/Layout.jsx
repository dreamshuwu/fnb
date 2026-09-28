import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const NAV = [
  { to: '/cashier', label: '收银', roles: ['admin', 'manager', 'cashier', 'waiter'] },
  { to: '/kds', label: 'KDS 厨房', roles: ['admin', 'manager', 'kitchen'] },
  { to: '/tables', label: '桌台', roles: ['admin', 'manager', 'cashier', 'waiter'] },
  { to: '/menu', label: '菜单', roles: ['admin', 'manager'] },
  { to: '/inventory', label: '库存', roles: ['admin', 'manager'] },
  { to: '/reports', label: '报表', roles: ['admin', 'manager'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = NAV.filter((n) => n.roles.includes(user.role));

  return (
    <div className="min-h-screen flex">
      <aside className="w-48 bg-slate-900 text-slate-100 flex flex-col">
        <div className="p-4 font-bold text-lg">F&B POS</div>
        <nav className="flex-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `block px-4 py-3 ${isActive ? 'bg-slate-700' : 'hover:bg-slate-800'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-sm">
          <div>
            {user.name} ({user.role})
          </div>
          <button
            className="mt-2 text-slate-300 underline"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            退出
          </button>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
