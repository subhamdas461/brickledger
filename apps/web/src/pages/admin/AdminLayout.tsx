import { ArrowLeft, Building2, ChartColumn, History, LayoutDashboard, Server, Smartphone, Users } from 'lucide-react';
import { Suspense } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Logo } from '../../components/logo';
import { Spinner } from '../../components/ui/surface';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';

const nav = [
  { to: '/admin', end: true, label: 'Overview', icon: LayoutDashboard },
  { to: '/admin/users', label: 'Accounts', icon: Users },
  { to: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { to: '/admin/engagement', label: 'Website', icon: ChartColumn },
  { to: '/admin/app', label: 'Android app', icon: Smartphone },
  { to: '/admin/audit', label: 'Audit log', icon: History },
  { to: '/admin/system', label: 'System', icon: Server },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
    isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white',
  );

/** Shell of the admin panel. Only rendered for super admins; the API enforces that on every request too. */
export function AdminLayout() {
  const { me } = useAuth();
  if (!me?.user.isSuperAdmin) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-white">Page not found</h1>
        <Link to="/app" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">Back to your projects</Link>
      </main>
    );
  }
  return (
    <div className="min-h-dvh bg-stone-50 lg:grid lg:grid-cols-[232px_1fr] dark:bg-[#0f0e0d]">
      <aside className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/95 backdrop-blur lg:h-dvh lg:border-r lg:border-b-0 dark:border-stone-800 dark:bg-stone-950/95">
        <div className="flex h-14 items-center justify-between gap-3 px-4 lg:h-16 lg:px-5">
          <Link to="/admin" className="flex items-center gap-2">
            <Logo />
          </Link>
          <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-stone-100 dark:text-stone-900">Admin</span>
        </div>
        <nav aria-label="Admin sections" className="scroll-thin flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-col lg:overflow-visible lg:pb-4">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              <item.icon className="size-[18px]" />
              {item.label}
            </NavLink>
          ))}
          <Link to="/app" className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap text-stone-500 hover:bg-stone-100 hover:text-stone-900 lg:mt-4 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white">
            <ArrowLeft className="size-[18px]" />
            Back to the app
          </Link>
        </nav>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
