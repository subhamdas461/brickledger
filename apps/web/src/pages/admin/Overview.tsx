import { formatBytes, formatMoney, type AdminOverview } from '@brickledger/shared/web';
import { Building2, Download, Eye, ShieldBan, Timer, UserPlus, Users, Wallet } from 'lucide-react';
import { SegmentedBar } from '../../components/charts';
import { PageHeader, Spinner, Stat } from '../../components/ui/surface';
import { DayChart, Panel, SectionTitle, count, duration, timeAgo, useAdmin } from './parts';

export function Overview() {
  const { data } = useAdmin<AdminOverview>('/overview');
  if (!data) return <Spinner />;
  const { users, workspaces, revenue, usage, web, app, series } = data;
  return (
    <>
      <PageHeader title="Overview" description={`Everything across BrickLedger. Updated ${timeAgo(data.generatedAt).toLowerCase()}.`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Accounts" value={count(users.total)} note={`+${count(users.new7d)} in 7 days`} icon={<Users className="size-4" />} />
        <Stat label="Active this week" value={count(users.active7d)} note={`${count(users.active1d)} today · ${count(users.active30d)} this month`} icon={<UserPlus className="size-4" />} />
        <Stat label="App downloads" value={count(app.downloads)} note={`${count(app.downloads30d)} in 30 days`} icon={<Download className="size-4" />} />
        <Stat label="Website visitors today" value={count(web.visitorsToday)} note={`${count(web.viewsToday)} pages opened`} icon={<Eye className="size-4" />} />
        <Stat label="Monthly revenue" value={formatMoney(revenue.mrr, revenue.currency)} note={`${count(revenue.paying)} paying, at list price`} icon={<Wallet className="size-4" />} />
        <Stat label="Workspaces" value={count(workspaces.total)} note={`${count(workspaces.trialing)} on trial`} icon={<Building2 className="size-4" />} />
        <Stat label="Time on site" value={duration(web.avgSeconds30d)} note="per daily visitor, 30 days" icon={<Timer className="size-4" />} />
        <Stat label="Banned accounts" value={count(users.banned)} note={users.banned ? 'See Accounts' : 'None'} icon={<ShieldBan className="size-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DayChart title="New accounts" subtitle="Per day, last 30 days" data={series.signups} unit="accounts" />
        <DayChart title="Pages opened" subtitle="Website, per day, last 30 days" data={series.views} unit="pages" />
        <DayChart title="App downloads" subtitle="Per day, last 30 days" data={series.downloads} unit="downloads" />
        <Panel title="Plans" subtitle="What each workspace has right now">
          <div className="mt-4">
            <SegmentedBar
              ariaLabel="Workspaces by plan"
              format={(n) => `${count(n)} workspaces`}
              parts={[
                { label: 'Starter', value: workspaces.free, color: 'var(--series-other)', dark: true },
                { label: 'Pro', value: workspaces.pro, color: 'var(--series-1)' },
                { label: 'Business', value: workspaces.business, color: 'var(--series-2)' },
              ]}
            />
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
            {[
              ['Paying', workspaces.paying],
              ['On trial', workspaces.trialing],
              ['Free upgrades', workspaces.comped],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-stone-100 p-3 dark:border-stone-800">
                <dt className="text-xs text-stone-500">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-stone-900 dark:text-stone-100">{count(Number(value))}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <SectionTitle>What people have recorded</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Projects" value={count(usage.projects)} note={`+${count(usage.demoProjects)} sample projects`} />
        <Stat label="Expenses" value={count(usage.expenses)} />
        <Stat label="Workers" value={count(usage.workers)} />
        <Stat label="Tasks" value={count(usage.tasks)} />
        <Stat label="Diary entries" value={count(usage.diaryEntries)} />
        <Stat label="Issues" value={count(usage.issues)} />
        <Stat label="Files" value={count(usage.files)} />
        <Stat label="Storage used" value={formatBytes(usage.storageBytes)} />
      </div>
    </>
  );
}
