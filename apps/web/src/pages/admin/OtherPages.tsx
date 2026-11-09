import { PLANS, formatBytes, formatDate, type AdminAppStats, type AdminAuditEntry, type AdminEngagement, type AdminSystem, type AdminWorkspaceRow, type PlanId } from '@brickledger/shared/web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Download, Eye, Info, MousePointerClick, RefreshCw, Search, Smartphone, Timer, Users, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Field, Input, Segmented, Select } from '../../components/ui/form';
import { Badge, Card, EmptyState, PageHeader, Spinner, Stat } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { api } from '../../lib/api';
import { DayChart, Pager, Panel, RankList, actionLabel, count, detailLine, duration, timeAgo, useAdmin } from './parts';

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
      <Input aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-9" />
    </div>
  );
}

// ---------------------------------------------------------------- workspaces

const planName = (plan: string) => PLANS[plan as PlanId]?.name ?? plan;

export function Workspaces() {
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const [plan, setPlan] = useState('all');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  useEffect(() => setOffset(0), [q, plan]);
  const { data } = useAdmin<{ items: AdminWorkspaceRow[]; total: number }>('/workspaces', { q, plan, limit, offset });
  const [editing, setEditing] = useState<AdminWorkspaceRow | null>(null);
  const [newPlan, setNewPlan] = useState('pro');
  const [days, setDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Workspaces" description={data ? `${count(data.total)} ${data.total === 1 ? 'workspace' : 'workspaces'}` : undefined} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <SearchBox value={input} onChange={setInput} label="Search workspaces" placeholder="Search by workspace name or owner’s email" />
        <Select aria-label="Filter by plan" className="sm:w-40" value={plan} onChange={(e) => setPlan(e.target.value)} options={[{ value: 'all', label: 'All plans' }, { value: 'free', label: 'Starter' }, { value: 'pro', label: 'Pro' }, { value: 'business', label: 'Business' }]} />
      </div>
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <Card><EmptyState title="No workspaces found" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800">
                  <th className="px-4 py-2.5 font-medium">Workspace</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 text-right font-medium">Projects</th>
                  <th className="px-4 py-2.5 text-right font-medium">People</th>
                  <th className="px-4 py-2.5 text-right font-medium">Storage</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {data.items.map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-stone-900 dark:text-stone-100">{w.name}</p>
                      {w.ownerId ? <Link to={`/admin/users/${w.ownerId}`} className="text-xs text-stone-500 hover:underline">{w.ownerEmail}</Link> : <p className="text-xs text-stone-500">No owner</p>}
                    </td>
                    <td className="px-4 py-2.5 text-stone-700 dark:text-stone-300">
                      {planName(w.plan)}
                      {w.planStatus === 'trialing' && w.plan !== 'free' && w.trialEndsAt ? <span className="block text-xs text-stone-500">Trial until {formatDate(w.trialEndsAt)}</span> : null}
                      {w.hasSubscription ? <span className="block text-xs text-stone-500">Paying</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{count(w.projects)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{count(w.members)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{formatBytes(w.storageBytes)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="secondary" size="sm" onClick={() => { setEditing(w); setNewPlan(w.plan); setDays('14'); }}>Change plan</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </Card>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `Plan for ${editing.name}` : ''} description={editing?.hasSubscription ? 'This workspace pays through your payment provider, so change the plan there.' : 'Takes effect at once, with no payment.'}>
        {editing && !editing.hasSubscription && (
          <div className="space-y-5">
            <div className="flex items-end gap-2">
              <Field className="flex-1" label="Set plan">
                <Select value={newPlan} onChange={(e) => setNewPlan(e.target.value)} options={[{ value: 'free', label: 'Starter' }, { value: 'pro', label: 'Pro' }, { value: 'business', label: 'Business' }]} />
              </Field>
              <Button loading={busy} onClick={() => run(() => api(`/admin/workspaces/${editing.id}/plan`, { method: 'PATCH', body: { plan: newPlan } }), 'Plan changed')}>Apply</Button>
            </div>
            <div className="flex items-end gap-2">
              <Field className="flex-1" label="Extend trial by (days)">
                <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
              <Button variant="secondary" loading={busy} disabled={!(Number(days) >= 1 && Number(days) <= 365)} onClick={() => run(() => api(`/admin/workspaces/${editing.id}/extend-trial`, { method: 'POST', body: { days: Number(days) } }), 'Trial extended')}>Extend</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- website

const PAGE_NAMES: Record<string, string> = {
  '/': 'Home',
  '/pricing': 'Pricing',
  '/download': 'Download app',
  '/login': 'Sign in',
  '/register': 'Sign up',
  '/forgot-password': 'Forgot password',
  '/reset-password': 'Reset password',
  '/terms': 'Terms',
  '/privacy': 'Privacy',
  '/app': 'App: projects',
  '/app/new': 'App: new project',
  '/app/settings': 'App: settings',
  '/app/p/:id': 'App: project dashboard',
  '/invite/:token': 'Invitation',
  '/other': 'Other',
};
const pageName = (path: string) => PAGE_NAMES[path] ?? (path.startsWith('/app/p/:id/') ? `App: ${path.split('/').pop()}` : path);

const countries = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  if (code === 'Unknown') return code;
  try {
    return countries.of(code) ?? code;
  } catch {
    return code;
  }
};

export function Engagement() {
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const { data } = useAdmin<AdminEngagement>('/engagement', { days: range });
  return (
    <>
      <PageHeader
        title="Website"
        description="Anonymous: no cookies, and no addresses or per-person history are kept."
        actions={<Segmented<'7' | '30' | '90'> value={range} onChange={setRange} aria-label="Time range" options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />}
      />
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Pages opened" value={count(data.views)} icon={<Eye className="size-4" />} />
            <Stat label="Daily visitors, added up" value={count(data.visitors)} note="One person on 2 days counts twice" icon={<Users className="size-4" />} />
            <Stat label="Pages per visitor" value={String(data.viewsPerVisitor)} icon={<MousePointerClick className="size-4" />} />
            <Stat label="Time on site" value={duration(data.avgSeconds)} note="Per daily visitor" icon={<Timer className="size-4" />} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DayChart title="Pages opened" subtitle="Per day" data={data.viewSeries} unit="pages" />
            <DayChart title="Visitors" subtitle="Per day" data={data.visitorSeries} unit="visitors" />
            <RankList title="Most opened pages" rows={data.pages} nameOf={pageName} />
            <RankList title="Where visitors came from" subtitle="Direct means typed or from an app" rows={data.referrers} />
            <RankList title="Countries" subtitle="Filled in on the live site" rows={data.countries} nameOf={countryName} />
            <RankList title="Devices" rows={data.devices} />
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Android app

export function AppStats() {
  const { data } = useAdmin<AdminAppStats>('/app-stats');
  const latest = useQuery({
    queryKey: ['admin', 'latest-apk'],
    queryFn: async () => {
      const res = await fetch('/apk/android.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('none');
      return (await res.json()) as { versionName: string; publishedAt: string };
    },
    retry: false,
  });
  if (!data) return <Spinner />;
  const names: Record<string, string> = { web: 'From the website', update: 'In-app updates' };
  return (
    <>
      <PageHeader title="Android app" description={latest.data ? `Latest published: ${latest.data.versionName}, ${formatDate(latest.data.publishedAt)}` : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Downloads" value={count(data.downloads)} note={`${count(data.downloads30d)} in 30 days`} icon={<Download className="size-4" />} />
        <Stat label="Installs seen" value={count(data.devices.total)} note="From version 1.0.3 on" icon={<Smartphone className="size-4" />} />
        <Stat label="Active this week" value={count(data.devices.active7d)} note={`${count(data.devices.active1d)} today · ${count(data.devices.active30d)} this month`} icon={<Users className="size-4" />} />
        <Stat label="App opens" value={count(data.opens30d)} note="Last 30 days" icon={<MousePointerClick className="size-4" />} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DayChart title="Downloads" subtitle="Per day, last 30 days" data={data.downloadSeries} unit="downloads" />
        <DayChart title="App opens" subtitle="Per day, last 30 days" data={data.opensSeries} unit="opens" />
        <RankList title="Versions in use" subtitle="Phones active in the last 30 days" rows={data.activeVersions} emptyText="Appears once phones run version 1.0.3." />
        <RankList title="Download source" rows={data.sources} nameOf={(n) => names[n] ?? n} />
        <RankList title="Downloads by version" rows={data.downloadVersions} />
      </div>
      <p className="mt-4 text-xs text-stone-500">Counting started with this feature. Someone opening the file’s direct address isn’t counted, and neither are copies shared between phones.</p>
    </>
  );
}

// ---------------------------------------------------------------- audit log

export function Audit() {
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  useEffect(() => setOffset(0), [q]);
  const { data } = useAdmin<{ items: AdminAuditEntry[]; total: number }>('/audit', { q, limit, offset });
  return (
    <>
      <PageHeader title="Audit log" description="Every action taken in this panel. Entries can’t be edited or removed here." />
      <div className="mb-4 flex">
        <SearchBox value={input} onChange={setInput} label="Search the audit log" placeholder="Search by account, admin or action" />
      </div>
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <Card><EmptyState title="Nothing here yet" description="Actions you take in this panel appear here." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {data.items.map((h) => {
              const inner = (
                <>
                  <p className="text-sm text-stone-900 dark:text-stone-100">
                    <span className="font-medium">{actionLabel(h.action)}</span>
                    {h.targetLabel && <span className="text-stone-600 dark:text-stone-300"> · {h.targetLabel}</span>}
                  </p>
                  {detailLine(h.details) && <p className="mt-0.5 text-xs text-stone-500">{detailLine(h.details)}</p>}
                  <p className="mt-0.5 text-xs text-stone-500">{h.adminEmail} · {timeAgo(h.createdAt)}</p>
                </>
              );
              return (
                <li key={h.id}>
                  {h.targetType === 'user' && h.targetId && h.action !== 'user.delete' ? <Link to={`/admin/users/${h.targetId}`} className="block px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800/40">{inner}</Link> : <div className="px-4 py-3">{inner}</div>}
                </li>
              );
            })}
          </ul>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- system

const LEVELS = {
  ok: { icon: <CircleCheck className="size-5 text-[var(--good)]" />, label: 'OK', tone: 'green' },
  info: { icon: <Info className="size-5 text-[var(--series-1)]" />, label: 'Note', tone: 'blue' },
  warning: { icon: <CircleAlert className="size-5 text-[var(--warning)]" />, label: 'Needs setup', tone: 'amber' },
  error: { icon: <XCircle className="size-5 text-[var(--critical)]" />, label: 'Problem', tone: 'red' },
} as const;

export function System() {
  const { data, refetch, isFetching } = useAdmin<AdminSystem>('/system');
  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader
        title="System"
        description="What’s connected and what still needs setting up."
        actions={<Button variant="secondary" loading={isFetching} icon={<RefreshCw className="size-4" />} onClick={() => void refetch()}>Check again</Button>}
      />
      <Card className="overflow-hidden">
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {data.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 px-4 py-3.5">
              <span className="mt-0.5 shrink-0">{LEVELS[c.level].icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{c.title}</p>
                <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-400">{c.message}</p>
              </div>
              <Badge tone={LEVELS[c.level].tone}>{LEVELS[c.level].label}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Database size" value={formatBytes(data.database.sizeBytes)} note={`${data.database.latencyMs} ms response`} />
        <Stat label="Signed-in sessions" value={count(data.activeSessions)} />
        <Stat label="Server version" value={data.version} note={data.commit ? `Commit ${data.commit}` : undefined} />
        <Stat label="Runtime" value={data.node} note={data.region ? `Region ${data.region}` : undefined} />
      </div>
      <Panel className="mt-4" title="Who is a super admin?" subtitle="Managed only from the command line, so it can’t be changed from this panel.">
        <pre className="mt-3 overflow-x-auto rounded-xl bg-stone-100 p-3 text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200">{`npm run admin -- list\nnpm run admin -- grant someone@example.com\nnpm run admin -- revoke someone@example.com`}</pre>
        <p className="mt-3 text-xs text-stone-500">Stats days run on {data.statsTimezone} time.</p>
      </Panel>
    </>
  );
}
