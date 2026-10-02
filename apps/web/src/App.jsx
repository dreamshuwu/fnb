import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import DesktopPage from './pages/DesktopPage.jsx';
import CashierPage from './pages/CashierPage.jsx';
import KDSPage from './pages/KDSPage.jsx';
import MenuPage from './pages/MenuPage.jsx';
import TablesPage from './pages/TablesPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import OperationsPage from './pages/OperationsPage.jsx';
import BackOfficePage from './pages/BackOfficePage.jsx';

function Require({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (role && !role.includes(user.role)) return <Navigate to="/" />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8">加载中…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route
        path="/"
        element={
          <Require>
            <Layout />
          </Require>
        }
      >
        <Route index element={<DesktopPage />} />
        <Route path="desktop" element={<DesktopPage />} />
        <Route path="operations" element={<Require role={['admin', 'manager', 'cashier']}><OperationsPage /></Require>} />
        <Route path="backoffice" element={<Require role={['admin', 'manager']}><BackOfficePage /></Require>} />
        <Route path="cashier" element={<CashierPage />} />
        <Route
          path="kds"
          element={
            <Require role={['kitchen', 'admin', 'manager']}>
              <KDSPage />
            </Require>
          }
        />
        <Route
          path="tables"
          element={
            <Require role={['admin', 'manager', 'cashier', 'waiter']}>
              <TablesPage />
            </Require>
          }
        />
        <Route
          path="menu"
          element={
            <Require role={['admin', 'manager']}>
              <MenuPage />
            </Require>
          }
        />
        <Route
          path="inventory"
          element={
            <Require role={['admin', 'manager']}>
              <InventoryPage />
            </Require>
          }
        />
        <Route
          path="reports"
          element={
            <Require role={['admin', 'manager']}>
              <ReportsPage />
            </Require>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
