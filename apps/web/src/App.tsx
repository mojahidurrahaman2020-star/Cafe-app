import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_HOME, type Permission } from '@bitebrew/shared';
import { useAuth } from './auth/AuthContext';
import { Loading } from './components/ui';
import { AppShell } from './layout/AppShell';
import { AccountPage } from './pages/AccountPage';
import { AuditPage } from './pages/AuditPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { ProductionPage } from './pages/ProductionPage';
import { ProductsPage } from './pages/ProductsPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { CustomersPage } from './pages/CustomersPage';
import { PosPage } from './pages/PosPage';
import { StationPage } from './pages/StationPage';
import { PrintersPage } from './pages/PrintersPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsExtras } from './pages/SettingsExtras';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center-screen"><Loading label="Starting Bite & Brew…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="page" data-testid="forbidden">
        <h1>Not available for your role</h1>
        <p className="muted">Your account does not have access to this area. Ask the owner if you need it.</p>
        <Link className="btn secondary" to="/" style={{ alignSelf: 'flex-start' }}>Go to my home screen</Link>
      </div>
    );
  }
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="dashboard" element={<Guard permission="dashboard.view"><DashboardPage /></Guard>} />
        <Route path="menu" element={<Guard permission="menu.view"><CategoriesPage /></Guard>} />
        <Route path="settings" element={<Guard permission="settings.view"><SettingsPage /><SettingsExtras /></Guard>} />
        <Route path="customers" element={<Guard permission="customers.manage"><CustomersPage /></Guard>} />
        <Route path="users" element={<Guard permission="users.view"><UsersPage /></Guard>} />
        <Route path="audit" element={<Guard permission="audit.view"><AuditPage /></Guard>} />
        <Route path="account" element={<AccountPage />} />
        <Route path="pos" element={<Guard permission="pos.use"><PosPage /></Guard>} />
        <Route path="kitchen" element={<Guard permission="kitchen.view"><StationPage key="kitchen" station="kitchen" /></Guard>} />
        <Route path="barista" element={<Guard permission="barista.view"><StationPage key="barista" station="barista" /></Guard>} />
        <Route path="availability" element={<Guard permission="menu.view"><AvailabilityPage /></Guard>} />
        <Route path="products" element={<Guard permission="menu.view"><ProductsPage /></Guard>} />
        <Route path="inventory" element={<Guard permission="inventory.view"><InventoryPage /></Guard>} />
        <Route path="production" element={<Guard permission="production.manage"><ProductionPage /></Guard>} />
        <Route path="expenses" element={<Guard permission="expenses.manage"><ExpensesPage /></Guard>} />
        <Route path="reports" element={<Guard permission="reports.view"><ReportsPage /></Guard>} />
        <Route path="printers" element={<Guard permission="printers.manage"><PrintersPage /></Guard>} />
        <Route
          path="*"
          element={
            <div className="page" data-testid="not-found">
              <h1>Page not found</h1>
              <Link className="btn secondary" to="/" style={{ alignSelf: 'flex-start' }}>Go home</Link>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
