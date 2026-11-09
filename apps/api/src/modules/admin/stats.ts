import { PLANS, effectivePlanId, type AdminAppStats, type AdminEngagement, type AdminOverview, type AdminPoint, type AdminRank, type PricingCurrency } from '@brickledger/shared';
import { and, gte, inArray, sql } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { rowsOf } from '../../db/client';
import { analyticsCounters, appDevices, organizations } from '../../db/schema';
import { statsDay } from '../tracking/routes';

const DAY_MS = 86_400_000;

function lastDays(count: number, tz: string): string[] {
  return Array.from({ length: count }, (_, i) => statsDay(tz, new Date(Date.now() - (count - 1 - i) * DAY_MS)));
}

interface CounterRow {
  day: string;
  metric: string;
  dimension: string;
  count: number;
}

async function counters(db: DB, metrics: string[], from?: string): Promise<CounterRow[]> {
  return db
    .select({ day: analyticsCounters.day, metric: analyticsCounters.metric, dimension: analyticsCounters.dimension, count: analyticsCounters.count })
    .from(analyticsCounters)
    .where(from ? and(inArray(analyticsCounters.metric, metrics), gte(analyticsCounters.day, from)) : inArray(analyticsCounters.metric, metrics));
}

const total = (rows: CounterRow[], metric: string, from?: string) =>
  rows.filter((r) => r.metric === metric && (!from || r.day >= from)).reduce((sum, r) => sum + Number(r.count), 0);

function series(rows: CounterRow[], metric: string, days: string[]): AdminPoint[] {
  const byDay = new Map<string, number>();
  for (const r of rows) if (r.metric === metric) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.count));
  return days.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

function ranking(rows: CounterRow[], metric: string, limit = 12): AdminRank[] {
  const byName = new Map<string, number>();
  for (const r of rows) if (r.metric === metric) byName.set(r.dimension, (byName.get(r.dimension) ?? 0) + Number(r.count));
  return [...byName].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, limit);
}

export async function buildOverview(db: DB, tz: string, currency: PricingCurrency): Promise<AdminOverview> {
  const days = lastDays(30, tz);
  const from = days[0]!;
  const today = days[days.length - 1]!;

  const [u] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      select count(*)::int as total,
        count(*) filter (where (created_at at time zone ${tz})::date = ${today}::date)::int as "newToday",
        count(*) filter (where created_at >= now() - interval '7 days')::int as "new7d",
        count(*) filter (where created_at >= now() - interval '30 days')::int as "new30d",
        count(*) filter (where last_seen_at >= now() - interval '1 day')::int as "active1d",
        count(*) filter (where last_seen_at >= now() - interval '7 days')::int as "active7d",
        count(*) filter (where last_seen_at >= now() - interval '30 days')::int as "active30d",
        count(*) filter (where banned_at is not null)::int as banned
      from users`),
  );

  const signupRows = rowsOf<{ day: string; value: number }>(
    await db.execute(sql`
      select to_char((created_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, count(*)::int as value
      from users where created_at >= now() - interval '31 days' group by 1`),
  );
  const signups = new Map(signupRows.map((r) => [r.day, Number(r.value)]));

  // Plans, as each workspace is entitled to them right now.
  const orgs = await db
    .select({
      plan: organizations.plan,
      planStatus: organizations.planStatus,
      planInterval: organizations.planInterval,
      trialEndsAt: organizations.trialEndsAt,
      currentPeriodEnd: organizations.currentPeriodEnd,
      billingProvider: organizations.billingProvider,
      billingSubscriptionId: organizations.billingSubscriptionId,
    })
    .from(organizations);
  const workspaces = { total: orgs.length, free: 0, pro: 0, business: 0, trialing: 0, paying: 0, comped: 0 };
  let mrr = 0;
  for (const org of orgs) {
    const plan = effectivePlanId(org);
    workspaces[plan] += 1;
    if (plan === 'free') continue;
    if (org.planStatus === 'trialing') workspaces.trialing += 1;
    else if (org.billingSubscriptionId && org.billingProvider !== 'mock') {
      workspaces.paying += 1;
      const price = PLANS[plan].price[currency];
      mrr += org.planInterval === 'year' ? price.year / 12 : price.month;
    } else workspaces.comped += 1;
  }

  const [usage] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      select
        (select count(*)::int from projects where deleted_at is null and not is_demo) as projects,
        (select count(*)::int from projects where deleted_at is null and is_demo) as "demoProjects",
        (select count(*)::int from expenses where deleted_at is null) as expenses,
        (select count(*)::int from workers where deleted_at is null) as workers,
        (select count(*)::int from tasks where deleted_at is null) as tasks,
        (select count(*)::int from daily_logs where deleted_at is null) as "diaryEntries",
        (select count(*)::int from issues where deleted_at is null) as issues,
        (select count(*)::int from files where deleted_at is null) as files,
        (select coalesce(sum(size_bytes), 0)::float8 from files where deleted_at is null) as "storageBytes"`),
  );

  const rows = await counters(db, ['page_view', 'visitor', 'engaged_seconds', 'apk_download'], from);
  const allDownloads = await counters(db, ['apk_download']);
  const [devices] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active7d: sql<number>`(count(*) filter (where ${appDevices.lastSeenAt} >= now() - interval '7 days'))::int`,
    })
    .from(appDevices);

  const visitors30d = total(rows, 'visitor');
  return {
    generatedAt: new Date().toISOString(),
    users: u as AdminOverview['users'],
    workspaces,
    revenue: { currency, mrr: Math.round(mrr), paying: workspaces.paying },
    usage: usage as AdminOverview['usage'],
    web: {
      viewsToday: total(rows, 'page_view', today),
      visitorsToday: total(rows, 'visitor', today),
      views30d: total(rows, 'page_view'),
      visitors30d,
      avgSeconds30d: visitors30d ? Math.round(total(rows, 'engaged_seconds') / visitors30d) : 0,
    },
    app: { downloads: total(allDownloads, 'apk_download'), downloads30d: total(rows, 'apk_download'), devices: devices?.total ?? 0, activeDevices7d: devices?.active7d ?? 0 },
    series: {
      signups: days.map((day) => ({ day, value: signups.get(day) ?? 0 })),
      views: series(rows, 'page_view', days),
      downloads: series(rows, 'apk_download', days),
    },
  };
}

export async function buildEngagement(db: DB, tz: string, dayCount: number): Promise<AdminEngagement> {
  const days = lastDays(dayCount, tz);
  const rows = await counters(db, ['page_view', 'visitor', 'engaged_seconds', 'page', 'referrer', 'country', 'device'], days[0]);
  const views = total(rows, 'page_view');
  const visitors = total(rows, 'visitor');
  return {
    days: dayCount,
    views,
    visitors,
    viewsPerVisitor: visitors ? Math.round((views / visitors) * 10) / 10 : 0,
    avgSeconds: visitors ? Math.round(total(rows, 'engaged_seconds') / visitors) : 0,
    viewSeries: series(rows, 'page_view', days),
    visitorSeries: series(rows, 'visitor', days),
    pages: ranking(rows, 'page'),
    referrers: ranking(rows, 'referrer'),
    countries: ranking(rows, 'country'),
    devices: ranking(rows, 'device'),
  };
}

export async function buildAppStats(db: DB, tz: string): Promise<AdminAppStats> {
  const days = lastDays(30, tz);
  const all = await counters(db, ['apk_download', 'apk_unique', 'apk_source', 'apk_version', 'app_open']);
  const [devices] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active1d: sql<number>`(count(*) filter (where ${appDevices.lastSeenAt} >= now() - interval '1 day'))::int`,
      active7d: sql<number>`(count(*) filter (where ${appDevices.lastSeenAt} >= now() - interval '7 days'))::int`,
      active30d: sql<number>`(count(*) filter (where ${appDevices.lastSeenAt} >= now() - interval '30 days'))::int`,
    })
    .from(appDevices);
  const versions = await db
    .select({ name: appDevices.versionName, value: sql<number>`count(*)::int` })
    .from(appDevices)
    .where(gte(appDevices.lastSeenAt, new Date(Date.now() - 30 * DAY_MS)))
    .groupBy(appDevices.versionName)
    .orderBy(sql`max(${appDevices.versionCode}) desc`);
  return {
    downloads: total(all, 'apk_download'),
    downloads30d: total(all, 'apk_download', days[0]),
    uniqueDownloads: total(all, 'apk_unique'),
    opens30d: total(all, 'app_open', days[0]),
    downloadSeries: series(all, 'apk_download', days),
    opensSeries: series(all, 'app_open', days),
    sources: ranking(all, 'apk_source'),
    downloadVersions: ranking(all, 'apk_version'),
    devices: { total: devices?.total ?? 0, active1d: devices?.active1d ?? 0, active7d: devices?.active7d ?? 0, active30d: devices?.active30d ?? 0 },
    activeVersions: versions,
  };
}
