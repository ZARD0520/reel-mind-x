import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { AdminLayout } from '../layouts/AdminLayout';
import { LoginPage } from '../pages/LoginPage';
import { adminNavigation } from './navigation';

function IndexRedirect() {
  const { hash } = useLocation();
  // Keep bookmarks to the former hash-based menus usable.
  const legacy = adminNavigation.find((item) => item.path === `/${hash.slice(1)}`);
  return <Navigate to={legacy?.path ?? '/overview'} replace />;
}

export const router = createBrowserRouter([
  { path: '/login', Component: LoginPage },
  {
    path: '/',
    Component: AdminLayout,
    children: [
      { index: true, Component: IndexRedirect },
      {
        path: 'overview',
        lazy: async () => ({ Component: (await import('../pages/OverviewPage')).OverviewPage }),
      },
      {
        path: 'users',
        lazy: async () => ({ Component: (await import('../pages/UsersPage')).UsersPage }),
      },
      {
        path: 'projects',
        lazy: async () => ({ Component: (await import('../pages/ProjectsPage')).ProjectsPage }),
      },
      {
        path: 'assets',
        lazy: async () => ({ Component: (await import('../pages/AssetsPage')).AssetsPage }),
      },
      {
        path: 'tasks',
        lazy: async () => ({ Component: (await import('../pages/TasksPage')).TasksPage }),
      },
      {
        path: 'ledger',
        lazy: async () => ({ Component: (await import('../pages/LedgerPage')).LedgerPage }),
      },
      {
        path: 'prices',
        lazy: async () => ({ Component: (await import('../pages/PricingPage')).PricingPage }),
      },
      {
        path: 'audits',
        lazy: async () => ({ Component: (await import('../pages/AuditsPage')).AuditsPage }),
      },
      { path: '*', element: <Navigate to="/overview" replace /> },
    ],
  },
]);
