import { PLANS, type ProjectDetail } from '@brickledger/shared/web';
import {
  Activity,
  BookOpen,
  CalendarRange,
  ChartColumn,
  ChevronDown,
  CreditCard,
  FolderOpen,
  HardHat,
  House,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Package,
  PiggyBank,
  Plus,
  Receipt,
  Settings,
  Smartphone,
  Sparkles,
  Store,
  Sun,
  TriangleExclamationPoint,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useProject, useProjects } from '../lib/queries';
import { useTheme } from '../lib/theme';
import { Logo } from './logo';
import { ButtonLink, buttonClass } from './ui/button';
import { Menu } from './ui/menu';
import { Avatar, EmptyState, Spinner } from './ui/surface';

// ---------------------------------------------------------------- auth guard

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner className="min-h-dvh" />;
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

// ---------------------------------------------------------------- project context

export interface ProjectCtx {
  pid: string;
  project: ProjectDetail;
  currency: string;
  canEdit: boolean;
  isManager: boolean;
}

export function useProjectCtx() {
  return useOutletContext<ProjectCtx>();
}

export function ProjectLayout() {
  const { pid = '' } = useParams();
  const { data, error, isLoading } = useProject(pid);
  if (isLoading) return <Spinner />;
  if (error || !data) {
    return (
      <EmptyState
        icon={<TriangleExclamationPoint />}
        title={error instanceof ApiError && error.status === 404 ? 'Project not found' : 'Could not load project'}
        description="It may have been deleted, or you no longer have access."
        action={<ButtonLink to="/app">All projects</ButtonLink>}
      />
    );
  }
  const ctx: ProjectCtx = {
    pid,
    project: data,
    currency: data.currency,
    canEdit: data.role !== 'viewer',
    isManager: data.role === 'manager',
  };
  return (
    <Suspense fallback={<Spinner />}>
      <Outlet context={ctx} />
    </Suspense>
  );
}

// ---------------------------------------------------------------- navigation

const projectNav: { group: string; items: { to: string; label: string; icon: typeof House; end?: boolean }[] }[] = [
  { group: '', items: [{ to: '', label: 'Overview', icon: LayoutDashboard, end: true }] },
  {
    group: 'Money',
    items: [
      { to: 'expenses', label: 'Expenses', icon: Receipt },
      { to: 'budget', label: 'Budget', icon: PiggyBank },
      { to: 'vendors', label: 'Vendors', icon: Store },
      { to: 'funds', label: 'Funds', icon: Landmark },
    ],
  },
  {
    group: 'Site',
    items: [
      { to: 'materials', label: 'Materials', icon: Package },
      { to: 'labour', label: 'Labour', icon: HardHat },
      { to: 'schedule', label: 'Schedule', icon: CalendarRange },
      { to: 'tasks', label: 'Tasks', icon: ListChecks },
      { to: 'diary', label: 'Site diary', icon: BookOpen },
      { to: 'issues', label: 'Issues', icon: TriangleExclamationPoint },
      { to: 'documents', label: 'Documents', icon: FolderOpen },
    ],
  },
  {
    group: 'Insights',
    items: [
      { to: 'reports', label: 'Reports', icon: ChartColumn },
      { to: 'activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    group: 'Project',
    items: [
      { to: 'team', label: 'Team', icon: Users },
      { to: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 rounded-xl px-3 py-[7px] text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300'
      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
  );
}

function ProjectSwitcher({ pid }: { pid: string }) {
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const current = projects?.find((p) => p.id === pid);
  return (
    <Menu
      align="left"
      className="w-full"
      trigger={(props) => (
        <button
          {...props}
          className="flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <House className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{current?.name ?? 'Project'}</span>
            <span className="block truncate text-xs text-stone-500">{current?.orgName}</span>
          </span>
          <ChevronDown className="size-4 text-stone-400" />
        </button>
      )}
      items={[
        ...(projects ?? []).slice(0, 8).map((p) => ({ label: <span className="truncate">{p.name}</span>, icon: <House />, onSelect: () => navigate(`/app/p/${p.id}`) })),
        { label: 'All projects', icon: <LayoutDashboard />, onSelect: () => navigate('/app') },
        { label: 'New project', icon: <Plus />, onSelect: () => navigate('/app/new') },
      ]}
    />
  );
}

function PlanBadge() {
  const { currentOrg } = useAuth();
  if (!currentOrg) return null;
  const trialDays = currentOrg.planStatus === 'trialing' && currentOrg.trialEndsAt ? Math.max(0, Math.ceil((Date.parse(currentOrg.trialEndsAt) - Date.now()) / 86_400_000)) : null;
  if (currentOrg.plan === 'business') return null;
  return (
    <Link
      to="/app/settings?tab=billing"
      className="mx-3 mb-3 block rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white px-3.5 py-3 text-sm dark:border-brand-500/20 dark:from-brand-500/10 dark:to-transparent"
    >
      <span className="flex items-center gap-2 font-semibold text-brand-800 dark:text-brand-300">
        <Sparkles className="size-4" />
        {trialDays !== null ? `${PLANS[currentOrg.plan].name} trial · ${trialDays} day${trialDays === 1 ? '' : 's'} left` : `${PLANS[currentOrg.plan].name} plan`}
      </span>
      <span className="mt-1 block text-xs text-stone-600 dark:text-stone-400">
        {trialDays !== null
          ? 'Choose a plan to keep PDF reports and more projects.'
          : currentOrg.plan === 'free'
            ? 'Upgrade for more projects, PDF reports and your team.'
            : 'Upgrade to Business for unlimited projects.'}
      </span>
    </Link>
  );
}

export function UserMenu({ compact }: { compact?: boolean }) {
  const { me, logout } = useAuth();
  const { pref, setPref } = useTheme();
  const navigate = useNavigate();
  if (!me) return null;
  const nextTheme = pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light';
  const ThemeIcon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;
  return (
    <Menu
      align={compact ? 'right' : 'left'}
      className={compact ? '' : 'w-full'}
      trigger={(props) => (
        <button {...props} className={cn('flex items-center gap-3 rounded-xl text-left transition hover:bg-stone-100 dark:hover:bg-stone-800', compact ? 'p-1' : 'w-full px-2 py-2')}>
          <Avatar name={me.user.name} />
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{me.user.name}</span>
              <span className="block truncate text-xs text-stone-500">{me.user.email}</span>
            </span>
          )}
        </button>
      )}
      items={[
        { label: 'Account settings', icon: <UserRound />, onSelect: () => navigate('/app/settings') },
        { label: 'Plan & billing', icon: <CreditCard />, onSelect: () => navigate('/app/settings?tab=billing') },
        { label: 'Get the Android app', icon: <Smartphone />, onSelect: () => navigate('/download') },
        { label: `Theme: ${pref}`, icon: <ThemeIcon />, onSelect: () => setPref(nextTheme) },
        {
          label: 'Sign out',
          icon: <LogOut />,
          onSelect: async () => {
            await logout();
            navigate('/');
          },
        },
      ]}
    />
  );
}

function Sidebar({ pid, onNavigate }: { pid?: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col border-r border-stone-200/80 bg-stone-50/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
      <div className="flex h-16 items-center px-5">
        <Link to="/app" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-4">
        {pid ? (
          <>
            <div className="mb-4">
              <ProjectSwitcher pid={pid} />
            </div>
            {projectNav.map((g) => (
              <div key={g.group} className="mb-3">
                {g.group && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{g.group}</p>}
                {g.items.map((item) => (
                  <NavLink key={item.to} to={`/app/p/${pid}${item.to ? `/${item.to}` : ''}`} end={item.end} className={navClass} onClick={onNavigate}>
                    <item.icon className="size-[18px]" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </>
        ) : (
          <div className="space-y-0.5">
            <NavLink to="/app" end className={navClass} onClick={onNavigate}>
              <House className="size-[18px]" />
              Projects
            </NavLink>
            <NavLink to="/app/new" className={navClass} onClick={onNavigate}>
              <Plus className="size-[18px]" />
              New project
            </NavLink>
            <NavLink to="/app/settings" className={navClass} onClick={onNavigate}>
              <Settings className="size-[18px]" />
              Settings
            </NavLink>
          </div>
        )}
      </nav>
      <PlanBadge />
      <div className="border-t border-stone-200/80 p-3 dark:border-stone-800">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppLayout() {
  const { pid } = useParams();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <Sidebar pid={pid} />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-stone-950/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-pop-in bg-stone-50 shadow-2xl dark:bg-stone-950">
            <button aria-label="Close menu" onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-1.5 text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800">
              <X className="size-5" />
            </button>
            <Sidebar pid={pid} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-stone-200/80 bg-white/85 px-4 backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/85">
        <button aria-label="Open menu" onClick={() => setDrawer(true)} className={buttonClass('ghost', 'icon')}>
          <MenuIcon className="size-5" />
        </button>
        <Link to="/app" className="flex-1">
          <Logo />
        </Link>
        <UserMenu compact />
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- public / marketing

export function PublicLayout() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.hash]);
  return (
    <div className="min-h-dvh bg-white dark:bg-[#0f0e0d]">
      <header className="sticky top-0 z-40 border-b border-stone-200/60 bg-white/85 backdrop-blur dark:border-stone-800 dark:bg-[#0f0e0d]/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/">
            <Logo />
          </Link>
          <nav className="hidden flex-1 items-center gap-6 text-sm font-medium text-stone-600 md:flex dark:text-stone-300">
            <a href="/#features" className="hover:text-stone-900 dark:hover:text-white">Features</a>
            <Link to="/pricing" className="hover:text-stone-900 dark:hover:text-white">Pricing</Link>
            <a href="/#faq" className="hover:text-stone-900 dark:hover:text-white">FAQ</a>
            <Link to="/download" className="flex items-center gap-1.5 hover:text-stone-900 dark:hover:text-white">
              <Smartphone className="size-4" /> Download app
            </Link>
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {status === 'authenticated' ? (
              <ButtonLink to="/app">Open app</ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">Sign in</ButtonLink>
                <ButtonLink to="/register">Start free</ButtonLink>
              </>
            )}
          </div>
          <button aria-label="Menu" className={cn(buttonClass('ghost', 'icon'), 'ml-auto md:hidden')} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>
        {open && (
          <div className="border-t border-stone-200 px-4 py-4 md:hidden dark:border-stone-800">
            <div className="flex flex-col gap-1 text-sm font-medium">
              <a href="/#features" className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">Features</a>
              <Link to="/pricing" className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">Pricing</Link>
              <a href="/#faq" className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">FAQ</a>
              <Link to="/download" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800">
                <Smartphone className="size-4" /> Download Android app
              </Link>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {status === 'authenticated' ? (
                  <ButtonLink to="/app" className="col-span-2">Open app</ButtonLink>
                ) : (
                  <>
                    <ButtonLink to="/login" variant="secondary">Sign in</ButtonLink>
                    <ButtonLink to="/register">Start free</ButtonLink>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </header>
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
      <footer className="border-t border-stone-200/70 bg-stone-50 dark:border-stone-800 dark:bg-stone-950">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-stone-500 dark:text-stone-400">
              Cost, material, labour and progress tracking for house construction - built for homeowners, contractors and their families.
            </p>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-stone-900 dark:text-white">Product</p>
            <ul className="mt-3 space-y-2 text-stone-500 dark:text-stone-400">
              <li><a href="/#features" className="hover:text-stone-900 dark:hover:text-white">Features</a></li>
              <li><Link to="/pricing" className="hover:text-stone-900 dark:hover:text-white">Pricing</Link></li>
              <li><Link to="/download" className="hover:text-stone-900 dark:hover:text-white">Android app</Link></li>
              <li><Link to="/register" className="hover:text-stone-900 dark:hover:text-white">Create account</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-stone-900 dark:text-white">Company</p>
            <ul className="mt-3 space-y-2 text-stone-500 dark:text-stone-400">
              <li><Link to="/terms" className="hover:text-stone-900 dark:hover:text-white">Terms of service</Link></li>
              <li><Link to="/privacy" className="hover:text-stone-900 dark:hover:text-white">Privacy policy</Link></li>
              <li><a href="mailto:support@brickledger.app" className="hover:text-stone-900 dark:hover:text-white">support@brickledger.app</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-stone-200/70 py-5 text-center text-xs text-stone-400 dark:border-stone-800">© {new Date().getFullYear()} BrickLedger. All rights reserved.</div>
      </footer>
    </div>
  );
}
