import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { auth } from './api';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Databases } from './pages/Databases';
import { Login } from './pages/Login';
import { MigrationDetail } from './pages/MigrationDetail';
import { MigrationNew } from './pages/MigrationNew';
import { Migrations } from './pages/Migrations';
import { Settings } from './pages/Settings';
import { SiteDetail } from './pages/SiteDetail';
import { SiteNew } from './pages/SiteNew';
import { SiteBuilder } from './pages/SiteBuilder';
import { Sites } from './pages/Sites';

function Protected({ children }: { children: ReactNode }) {
  return auth.token ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="sites" element={<Sites />} />
        <Route path="sites/new" element={<SiteNew />} />
        <Route path="sites/new/builder" element={<SiteBuilder />} />
        <Route path="sites/:id" element={<SiteDetail />} />
        <Route path="databases" element={<Databases />} />
        <Route path="migrations" element={<Migrations />} />
        <Route path="migrations/new" element={<MigrationNew />} />
        <Route path="migrations/:id" element={<MigrationDetail />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
