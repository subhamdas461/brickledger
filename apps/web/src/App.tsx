import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppLayout, ProjectLayout, PublicLayout, RequireAuth } from './components/layout';
import { Spinner } from './components/ui/surface';
import { startAnalytics } from './lib/analytics';

/** Route-level code splitting: each page is its own chunk. */
function page<T extends Record<string, ComponentType<any>>>(loader: () => Promise<T>, name: keyof T) {
  return lazy(() => loader().then((m) => ({ default: m[name] as ComponentType<any> })));
}

const Landing = page(() => import('./pages/marketing/Landing'), 'Landing');
const PricingPage = page(() => import('./pages/marketing/Landing'), 'PricingPage');
const Legal = page(() => import('./pages/marketing/Legal'), 'Legal');
const DownloadPage = page(() => import('./pages/marketing/Download'), 'DownloadPage');
const Login = page(() => import('./pages/auth/AuthPages'), 'Login');
const Register = page(() => import('./pages/auth/AuthPages'), 'Register');
const ForgotPassword = page(() => import('./pages/auth/AuthPages'), 'ForgotPassword');
const ResetPassword = page(() => import('./pages/auth/AuthPages'), 'ResetPassword');
const AcceptInvite = page(() => import('./pages/auth/AuthPages'), 'AcceptInvite');
const NotFound = page(() => import('./pages/auth/AuthPages'), 'NotFound');
const Projects = page(() => import('./pages/app/Projects'), 'Projects');
const NewProject = page(() => import('./pages/app/Projects'), 'NewProject');
const AccountSettings = page(() => import('./pages/app/AccountSettings'), 'AccountSettings');
const Dashboard = page(() => import('./pages/project/Dashboard'), 'Dashboard');
const Expenses = page(() => import('./pages/project/Expenses'), 'Expenses');
const Budget = page(() => import('./pages/project/Budget'), 'Budget');
const Vendors = page(() => import('./pages/project/Vendors'), 'Vendors');
const Funds = page(() => import('./pages/project/Funds'), 'Funds');
const Materials = page(() => import('./pages/project/Materials'), 'Materials');
const Labour = page(() => import('./pages/project/Labour'), 'Labour');
const Schedule = page(() => import('./pages/project/Schedule'), 'Schedule');
const Tasks = page(() => import('./pages/project/Tasks'), 'Tasks');
const Diary = page(() => import('./pages/project/Diary'), 'Diary');
const Issues = page(() => import('./pages/project/Issues'), 'Issues');
const Documents = page(() => import('./pages/project/Documents'), 'Documents');
const Reports = page(() => import('./pages/project/Reports'), 'Reports');
const Team = page(() => import('./pages/project/Team'), 'Team');
const ActivityPage = page(() => import('./pages/project/ActivityPage'), 'ActivityPage');
const ProjectSettings = page(() => import('./pages/project/ProjectSettings'), 'ProjectSettings');
const AdminLayout = page(() => import('./pages/admin/AdminLayout'), 'AdminLayout');
const AdminOverview = page(() => import('./pages/admin/Overview'), 'Overview');
const AdminUsers = page(() => import('./pages/admin/Users'), 'Users');
const AdminUserDetail = page(() => import('./pages/admin/Users'), 'UserDetail');
const AdminWorkspaces = page(() => import('./pages/admin/OtherPages'), 'Workspaces');
const AdminEngagement = page(() => import('./pages/admin/OtherPages'), 'Engagement');
const AdminAppStats = page(() => import('./pages/admin/OtherPages'), 'AppStats');
const AdminAudit = page(() => import('./pages/admin/OtherPages'), 'Audit');
const AdminSystem = page(() => import('./pages/admin/OtherPages'), 'System');

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/pricing', element: <PricingPage /> },
      { path: '/download', element: <DownloadPage /> },
      { path: '/terms', element: <Legal kind="terms" /> },
      { path: '/privacy', element: <Legal kind="privacy" /> },
    ],
  },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/invite/:token', element: <AcceptInvite /> },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Projects /> },
      { path: 'new', element: <NewProject /> },
      { path: 'settings', element: <AccountSettings /> },
      {
        path: 'p/:pid',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'expenses', element: <Expenses /> },
          { path: 'budget', element: <Budget /> },
          { path: 'vendors', element: <Vendors /> },
          { path: 'funds', element: <Funds /> },
          { path: 'materials', element: <Materials /> },
          { path: 'labour', element: <Labour /> },
          { path: 'schedule', element: <Schedule /> },
          { path: 'tasks', element: <Tasks /> },
          { path: 'diary', element: <Diary /> },
          { path: 'issues', element: <Issues /> },
          { path: 'documents', element: <Documents /> },
          { path: 'reports', element: <Reports /> },
          { path: 'team', element: <Team /> },
          { path: 'activity', element: <ActivityPage /> },
          { path: 'settings', element: <ProjectSettings /> },
        ],
      },
    ],
  },
  {
    path: '/admin',
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <AdminOverview /> },
      { path: 'users', element: <AdminUsers /> },
      { path: 'users/:id', element: <AdminUserDetail /> },
      { path: 'workspaces', element: <AdminWorkspaces /> },
      { path: 'engagement', element: <AdminEngagement /> },
      { path: 'app', element: <AdminAppStats /> },
      { path: 'audit', element: <AdminAudit /> },
      { path: 'system', element: <AdminSystem /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

startAnalytics(router.state.location.pathname, (onPath) => {
  router.subscribe((state) => onPath(state.location.pathname));
});

export function App() {
  return (
    <Suspense fallback={<Spinner className="min-h-dvh" />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
