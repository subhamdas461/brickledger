import { PhaseStatuses, ProjectStatuses, formatDate, formatMonth, type Alert, type Expense } from '@brickledger/shared/web';
import {
  ArrowRight,
  CircleCheck,
  FileDown,
  HardHat,
  Info,
  ListChecks,
  OctagonExclamationPoint,
  Package,
  Plus,
  Receipt,
  TriangleExclamationPoint,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ColumnChart, Meter, SegmentedBar, SERIES, SERIES_DARK_TEXT } from '../../components/charts';
import { useProjectCtx } from '../../components/layout';
import { Button, ButtonLink } from '../../components/ui/button';
import { Segmented } from '../../components/ui/form';
import { Badge, Card, CardHeader, PageHeader, Skeleton, Stat } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { ApiError, downloadFile } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useDashboard } from '../../lib/queries';
import { CategoryIcon, useMoney } from './common';
import { ExpenseFormModal } from './Expenses';

const ALERT_STYLE: Record<Alert['severity'], { icon: typeof Info; color: string; label: string }> = {
  critical: { icon: OctagonExclamationPoint, color: 'var(--critical)', label: 'Critical' },
  serious: { icon: TriangleExclamationPoint, color: 'var(--serious)', label: 'Attention' },
  warning: { icon: TriangleExclamationPoint, color: 'var(--warning)', label: 'Heads-up' },
  info: { icon: Info, color: 'var(--series-1)', label: 'Info' },
};

const ALERT_LINK: Partial<Record<string, string>> = {
  expenses: 'expenses',
  categories: 'budget',
  materials: 'materials',
  tasks: 'tasks',
  files: 'documents',
  issues: 'issues',
};

export function Dashboard() {
  const { pid, project, canEdit } = useProjectCtx();
  const { data, isLoading, isPlaceholderData } = useDashboard(pid);
  const { money, compact } = useMoney();
  const toast = useToast();
  const [adding, setAdding] = useState<Expense | 'new' | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const t = data.totals;
  const over = t.budget > 0 && t.committed > t.budget;
  const usedPct = t.budget > 0 ? Math.round((t.committed / t.budget) * 100) : 0;
  const ranked = [...data.categories].map((c) => ({ ...c, committed: c.spent + c.due })).sort((a, b) => b.committed - a.committed);
  // At most 5 named categories + "Other" (a 6th colour is never generated).
  const positive = ranked.filter((c) => c.committed > 0);
  const top = positive.slice(0, 5);
  const otherTotal = positive.slice(5).reduce((s, c) => s + c.committed, 0);
  const meters = ranked.filter((c) => c.planned > 0 || c.committed > 0).slice(0, 6);

  async function pdf() {
    try {
      await downloadFile(`/projects/${pid}/report.pdf`, 'report.pdf');
    } catch (err) {
      if (err instanceof ApiError && err.isPlanLimit) toast.error(err.message, { label: 'See plans', onClick: () => window.location.assign('/app/settings?tab=billing') });
      else toast.error('Could not create the report.');
    }
  }

  return (
    <div className={cn('transition-opacity', isPlaceholderData && 'opacity-60')}>
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {[project.address, project.city].filter(Boolean).join(', ') || project.orgName}
            <Badge tone="blue">{ProjectStatuses.label(project.status)}</Badge>
            {t.daysTotal ? <span className="text-stone-400">· Day {t.daysElapsed} of {t.daysTotal}</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={pdf}>
              PDF report
            </Button>
            {canEdit && (
              <Button icon={<Plus className="size-4" />} onClick={() => setAdding('new')}>
                Add expense
              </Button>
            )}
          </>
        }
      />

      {data.alerts.length > 0 && (
        <Card className="mb-6 divide-y divide-stone-100 dark:divide-stone-800">
          {data.alerts.slice(0, 5).map((a, i) => {
            const s = ALERT_STYLE[a.severity];
            const to = a.entityType ? ALERT_LINK[a.entityType] : undefined;
            const body = (
              <div className="flex items-start gap-3 px-4 py-3">
                <s.icon className="mt-0.5 size-[18px] shrink-0" style={{ color: s.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    <span className="sr-only">{s.label}: </span>
                    {a.title}
                  </p>
                  {a.detail && <p className="text-xs text-stone-500">{a.detail}</p>}
                </div>
                <span className="hidden text-xs font-medium text-stone-400 sm:block">{s.label}</span>
                {to && <ArrowRight className="mt-0.5 size-4 text-stone-300" />}
              </div>
            );
            return to ? (
              <Link key={i} to={to} className="block transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/40">
                {body}
              </Link>
            ) : (
              <div key={i}>{body}</div>
            );
          })}
        </Card>
      )}

      {/* Hero: the one number this view leads with */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-stone-500">Committed so far</p>
              <p className="mt-1 text-5xl font-semibold tracking-tight text-stone-900 dark:text-white">{compact(t.committed)}</p>
              <p className="mt-1 text-sm text-stone-500">
                {usedPct}% of {money(t.budget)} budget
              </p>
            </div>
            {over ? (
              <Badge tone="red" icon={<OctagonExclamationPoint className="size-3.5" />}>
                Over budget by {compact(t.committed - t.budget)}
              </Badge>
            ) : (
              <Badge tone="green" icon={<CircleCheck className="size-3.5" />}>
                {compact(t.remaining)} left to spend
              </Badge>
            )}
          </div>
          <div className="mt-6">
            <SegmentedBar
              ariaLabel="Budget split into paid, due and remaining"
              format={money}
              total={Math.max(t.budget, t.committed)}
              parts={[
                { label: 'Paid', value: t.spent, color: 'var(--series-1)' },
                { label: 'Bills due', value: t.due, color: 'var(--series-2)' },
                { label: 'Remaining', value: Math.max(0, t.remaining), color: 'var(--series-other)', dark: true },
              ]}
            />
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Paid so far" value={compact(t.spent)} note={`${money(t.labourPaid)} wages`} />
          <Stat label="Bills due" value={compact(t.due)} note={t.overdue > 0 ? `${compact(t.overdue)} overdue` : 'Nothing overdue'} noteTone={t.overdue > 0 ? 'bad' : 'good'} />
          <Stat label="Cash in hand" value={compact(t.cashInHand)} note={`${compact(t.fundsReceived)} received`} noteTone={t.cashInHand < 0 ? 'bad' : 'muted'} />
          <Stat
            label="Progress"
            value={`${t.progress}%`}
            note={t.costPerArea ? `${money(t.costPerArea)} / ${project.areaUnit === 'sqm' ? 'sq m' : 'sq ft'}` : 'Set built-up area for cost per sq ft'}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Monthly spending"
            subtitle={`Paid expenses per month (${project.currency})`}
            action={
              <Segmented
                size="sm"
                aria-label="Chart or table"
                value={view}
                onChange={setView}
                options={[
                  { value: 'chart', label: 'Chart' },
                  { value: 'table', label: 'Table' },
                ]}
              />
            }
          />
          <div className="px-5 pb-5 pt-4">
            {view === 'chart' && data.monthly.every((m) => m.amount === 0) ? (
              <p className="py-16 text-center text-sm text-stone-500">No paid expenses yet - the chart fills in as you record payments.</p>
            ) : view === 'chart' ? (
              <ColumnChart
                ariaLabel="Monthly spending"
                format={money}
                formatTick={(n) => compact(n).replace(/\.0(?=\D|$)/, '')}
                data={data.monthly.map((m) => ({ key: m.month, label: formatMonth(m.month), value: m.amount }))}
              />
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {data.monthly.map((m) => (
                    <tr key={m.month}>
                      <td className="py-2 text-stone-600 dark:text-stone-300">{formatMonth(m.month)}</td>
                      <td className="tabular py-2 text-right font-medium">{money(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Where the money went" subtitle="Top categories by committed spend" />
          <div className="p-5">
            <SegmentedBar
              ariaLabel="Spend by category"
              format={money}
              parts={[
                ...top.map((c, i) => ({ label: c.name, value: c.committed, color: SERIES[i]!, dark: SERIES_DARK_TEXT[i] })),
                ...(otherTotal > 0 ? [{ label: 'Other', value: otherTotal, color: 'var(--series-other)', dark: true }] : []),
              ]}
            />
            <ul className="mt-5 space-y-2.5">
              {top.map((c) => (
                <li key={c.id ?? 'none'} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-stone-600 dark:text-stone-300">{c.name}</span>
                  <span className="tabular font-medium">{compact(c.committed)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Budget by category" subtitle="Committed vs planned" action={<ButtonLink to="budget" variant="ghost" size="sm">All categories</ButtonLink>} />
          <ul className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
            {meters.map((c) => (
              <li key={c.id ?? 'none'}>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-stone-700 dark:text-stone-300">
                    <CategoryIcon icon={c.icon} className="shrink-0 text-stone-400" />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-stone-500">
                    {compact(c.committed)} / {compact(c.planned)}
                  </span>
                </div>
                <Meter value={c.committed} max={c.planned} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Today on site" subtitle={formatDate(new Date().toISOString().slice(0, 10))} />
          <ul className="grid grid-cols-2 gap-3 p-5">
            {[
              { icon: HardHat, label: 'Present today', value: `${data.counts.presentToday}/${data.counts.activeWorkers}`, to: 'labour' },
              { icon: ListChecks, label: 'Open tasks', value: data.counts.openTasks, note: data.counts.overdueTasks ? `${data.counts.overdueTasks} overdue` : undefined, to: 'tasks' },
              { icon: TriangleExclamationPoint, label: 'Open issues', value: data.counts.openIssues, to: 'issues' },
              { icon: Package, label: 'Low stock', value: data.counts.lowStock, to: 'materials' },
            ].map((s) => (
              <li key={s.label}>
                <Link to={s.to} className="block rounded-2xl border border-stone-100 p-3 transition hover:border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/40">
                  <s.icon className="size-4 text-stone-400" />
                  <p className="mt-2 text-xl font-semibold">{s.value}</p>
                  <p className="text-xs text-stone-500">{s.label}</p>
                  {s.note && <p className="text-xs font-medium text-[var(--critical)]">{s.note}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Schedule" subtitle={`${t.progress}% overall`} action={<ButtonLink to="schedule" variant="ghost" size="sm">Open</ButtonLink>} />
          <ul className="space-y-3 p-5">
            {data.phases.slice(0, 8).map((ph) => (
              <li key={ph.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                <span className="truncate text-sm text-stone-700 dark:text-stone-300">{ph.name}</span>
                <span className="text-xs text-stone-500">{ph.progress === 100 ? PhaseStatuses.label('completed') : `${ph.progress}%`}</span>
                <div className="col-span-2">
                  <Meter value={ph.progress} max={100} thin kind="progress" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Recent expenses" action={<ButtonLink to="expenses" variant="ghost" size="sm">View all</ButtonLink>} />
          <ul className="divide-y divide-stone-100 px-2 pb-2 dark:divide-stone-800">
            {data.recentExpenses.length === 0 && <li className="px-3 py-8 text-center text-sm text-stone-500">No expenses yet.</li>}
            {data.recentExpenses.map((e) => (
              <li key={e.id}>
                <button onClick={() => setAdding(e)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/40">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 dark:bg-stone-800">
                    <Receipt className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.title}</span>
                    <span className="block truncate text-xs text-stone-500">{[formatDate(e.date), e.vendorName ?? e.categoryName].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block text-sm font-semibold">{money(e.amount)}</span>
                    {e.status === 'due' && <span className="text-xs font-medium text-[var(--critical)]">Due</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 flex flex-wrap items-center gap-4 p-5">
        <Users className="size-5 text-stone-400" />
        <p className="flex-1 text-sm text-stone-600 dark:text-stone-300">Keep your contractor, engineer and family in the loop - invite them with the right access.</p>
        <ButtonLink to="team" variant="secondary" size="sm">
          Manage team
        </ButtonLink>
      </Card>

      <ExpenseFormModal key={adding === 'new' ? 'new' : adding?.id ?? 'none'} expense={adding} onClose={() => setAdding(null)} />
    </div>
  );
}
