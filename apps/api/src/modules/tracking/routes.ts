import { createHmac, createHash } from 'node:crypto';
import { lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Executor } from '../../db/client';
import { analyticsCounters, analyticsUniques, appDevices } from '../../db/schema';
import { parse } from '../../lib/validate';

/**
 * Privacy-friendly product analytics, open to anonymous visitors. No cookies and no stored IP
 * addresses: daily totals only, plus a hash that counts each visitor once a day. The hash mixes in
 * the date and a server secret, so it can't be linked across days, and it is deleted after a few days.
 */

/** Calendar day in the stats timezone, as yyyy-mm-dd. */
export function statsDay(timeZone: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

interface Bump {
  metric: string;
  dimension?: string;
  by?: number;
}

/** Adds to daily counters in one statement. Each metric + dimension may appear only once per call. */
export async function bump(db: Executor, day: string, rows: Bump[]) {
  if (!rows.length) return;
  await db
    .insert(analyticsCounters)
    .values(rows.map((r) => ({ day, metric: r.metric, dimension: r.dimension ?? '', count: r.by ?? 1 })))
    .onConflictDoUpdate({
      target: [analyticsCounters.day, analyticsCounters.metric, analyticsCounters.dimension],
      set: { count: sql`${analyticsCounters.count} + excluded.count` },
    });
}

const PROJECT_SECTIONS = new Set(['expenses', 'budget', 'vendors', 'funds', 'materials', 'labour', 'schedule', 'tasks', 'diary', 'issues', 'documents', 'reports', 'team', 'activity', 'settings']);
const PAGES = new Set(['/', '/pricing', '/download', '/terms', '/privacy', '/login', '/register', '/forgot-password', '/reset-password', '/app', '/app/new', '/app/settings']);

/**
 * Maps a browser path to a known page. Ids and tokens never reach the database, and made-up paths
 * can't fill it. Returns null for pages that aren't counted (the admin panel itself).
 */
export function normalizePage(rawPath: string): string | null {
  const path = rawPath.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (path === '/admin' || path.startsWith('/admin/')) return null;
  if (PAGES.has(path)) return path;
  if (path.startsWith('/invite/')) return '/invite/:token';
  const project = /^\/app\/p\/[^/]+(?:\/([a-z-]+))?$/.exec(path);
  if (project) {
    if (!project[1]) return '/app/p/:id';
    if (PROJECT_SECTIONS.has(project[1])) return `/app/p/:id/${project[1]}`;
  }
  return '/other';
}

export function isBot(userAgent: string): boolean {
  return !userAgent || /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|curl|wget|python-requests|axios|go-http/i.test(userAgent);
}

function deviceOf(userAgent: string): string {
  if (/ipad|tablet/i.test(userAgent)) return 'Tablet';
  if (/mobi|android|iphone/i.test(userAgent)) return 'Mobile';
  return 'Desktop';
}

/** The referring site's domain, or null when the visit came from within this site. */
export function referrerHost(referrer: string | null | undefined, ownHosts: string[]): string | null {
  if (!referrer) return 'Direct';
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'Direct';
  }
  if (ownHosts.some((own) => own.toLowerCase().replace(/^www\./, '') === host)) return null;
  return /^[a-z0-9.-]{1,100}$/.test(host) ? host : 'Other';
}

const trackSchema = z.object({
  type: z.enum(['view', 'engaged']),
  path: z.string().max(500).optional(),
  referrer: z.string().max(1000).nullish(),
  seconds: z.number().int().min(0).max(1800).optional(),
});

const pingSchema = z.object({
  installId: z.uuid(),
  versionName: z.string().trim().min(1).max(30),
  versionCode: z.number().int().min(1).max(100_000_000),
});

const downloadSchema = z.object({
  source: z.enum(['web', 'update']).catch('web'),
  v: z
    .string()
    .regex(/^[0-9A-Za-z.+-]{1,30}$/)
    .optional()
    .catch(undefined),
});

export async function trackingRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx;
  const limited = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  /** True the first time this visitor is seen today for this scope. */
  async function firstToday(req: FastifyRequest, day: string, scope: string): Promise<boolean> {
    const hash = createHmac('sha256', config.JWT_SECRET)
      .update(`${day}|${scope}|${req.ip}|${req.headers['user-agent'] ?? ''}`)
      .digest('base64url')
      .slice(0, 32);
    const inserted = await db.insert(analyticsUniques).values({ day, scope, hash }).onConflictDoNothing().returning({ hash: analyticsUniques.hash });
    // Yesterday's hashes aren't needed: clear old ones now and then.
    if (Math.random() < 0.01) await db.delete(analyticsUniques).where(lt(analyticsUniques.day, statsDay(config.STATS_TIMEZONE, new Date(Date.now() - 3 * 86_400_000))));
    return inserted.length > 0;
  }

  /** Website: one call per page opened, and one with the active seconds when the page is left. */
  app.post('/track', limited, async (req, reply) => {
    reply.code(204);
    const input = parse(trackSchema, req.body);
    const userAgent = req.headers['user-agent'] ?? '';
    if (isBot(userAgent)) return;
    const day = statsDay(config.STATS_TIMEZONE);
    try {
      if (input.type === 'engaged') {
        if (input.seconds) await bump(db, day, [{ metric: 'engaged_seconds', by: input.seconds }]);
        return;
      }
      const page = normalizePage(input.path ?? '/');
      if (!page) return;
      const rows: Bump[] = [{ metric: 'page_view' }, { metric: 'page', dimension: page }];
      if (await firstToday(req, day, 'visitor')) {
        const country = String(req.headers['x-vercel-ip-country'] ?? '').toUpperCase();
        const ownHosts = [req.hostname.split(':')[0]!, new URL(config.APP_URL).hostname];
        const source = referrerHost(input.referrer, ownHosts);
        rows.push({ metric: 'visitor' }, { metric: 'device', dimension: deviceOf(userAgent) }, { metric: 'country', dimension: /^[A-Z]{2}$/.test(country) ? country : 'Unknown' });
        if (source) rows.push({ metric: 'referrer', dimension: source });
      }
      await bump(db, day, rows);
    } catch (err) {
      req.log.warn({ err }, 'tracking failed'); // never let analytics break the page
    }
  });

  /** Counts a download of the Android app, then sends the visitor to the file itself. */
  app.get('/download/android', limited, async (req, reply) => {
    const input = parse(downloadSchema, req.query);
    if (req.method === 'GET' && !isBot(req.headers['user-agent'] ?? '')) {
      try {
        const day = statsDay(config.STATS_TIMEZONE);
        const rows: Bump[] = [{ metric: 'apk_download' }, { metric: 'apk_source', dimension: input.source }];
        if (input.v) rows.push({ metric: 'apk_version', dimension: input.v });
        if (await firstToday(req, day, 'apk')) rows.push({ metric: 'apk_unique' });
        await bump(db, day, rows);
      } catch (err) {
        req.log.warn({ err }, 'download count failed'); // the download itself must still work
      }
    }
    return reply.header('Cache-Control', 'no-store').redirect('/apk/brickledger.apk', 302);
  });

  /** Android app: "this install is alive", with its version. The id is random and tied to no account. */
  app.post('/app-ping', limited, async (req, reply) => {
    reply.code(204);
    const input = parse(pingSchema, req.body);
    try {
      const now = new Date();
      await db
        .insert(appDevices)
        .values({ id: createHash('sha256').update(input.installId).digest('hex'), versionName: input.versionName, versionCode: input.versionCode })
        .onConflictDoUpdate({ target: appDevices.id, set: { versionName: input.versionName, versionCode: input.versionCode, lastSeenAt: now } });
      await bump(db, statsDay(config.STATS_TIMEZONE), [{ metric: 'app_open' }]);
    } catch (err) {
      req.log.warn({ err }, 'app ping failed');
    }
  });
}
