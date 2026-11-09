import { effectivePlanId, emailSchema, type AdminUserDetail, type AdminUserRow, type AdminWorkspaceRow, type PlanId } from '@brickledger/shared';
import { and, asc, desc, eq, gt, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminAudit, organizations, passwordResets, sessions, users } from '../../db/schema';
import { randomToken, sha256 } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { isUuid } from '../../lib/util';
import { parse } from '../../lib/validate';
import { deleteUserAccount, listUserOrgs } from '../account/service';
import { toCsv } from '../reports/csv';
import { rowsOf } from '../../db/client';
import { VERSION } from '../../version';
import { buildAppStats, buildEngagement, buildOverview } from './stats';

declare module 'fastify' {
  interface FastifyRequest {
    adminEmail: string;
  }
}

const paging = {
  limit: z.coerce.number().int().min(1).max(100).catch(25),
  offset: z.coerce.number().int().min(0).catch(0),
};
const listUsersSchema = z.object({
  q: z.string().trim().max(120).catch(''),
  status: z.enum(['all', 'active', 'banned', 'admin']).catch('all'),
  sort: z.enum(['newest', 'lastSeen', 'name']).catch('newest'),
  ...paging,
});
const listWorkspacesSchema = z.object({
  q: z.string().trim().max(120).catch(''),
  plan: z.enum(['all', 'free', 'pro', 'business']).catch('all'),
  ...paging,
});
const banSchema = z.object({ reason: z.string().trim().min(3, 'Say why, so the decision is on record.').max(500) });
const updateUserSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), email: emailSchema.optional() });
const deleteUserSchema = z.object({ confirmEmail: z.string().trim().toLowerCase() });
const setPlanSchema = z.object({ plan: z.enum(['free', 'pro', 'business']) });
const extendTrialSchema = z.object({ days: z.number().int().min(1).max(365) });

const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

function planLabel(org: { plan: string; planStatus: string; trialEndsAt?: Date | null; currentPeriodEnd?: Date | null } | null | undefined) {
  if (!org) return null;
  const plan = effectivePlanId(org);
  return { plan, trialing: plan !== 'free' && org.planStatus === 'trialing' };
}

/**
 * The admin panel API. Only for accounts flagged as super admin (see `npm run admin`); the flag is
 * re-read from the database on every request, and everyone else gets a plain 404.
 */
export async function adminRoutes(app: FastifyInstance) {
  const { db, config, storage, database, billing } = app.ctx;

  app.decorateRequest('adminEmail', '');
  app.addHook('onRequest', async (req) => {
    const [me] = await db.select({ email: users.email, isSuperAdmin: users.isSuperAdmin, bannedAt: users.bannedAt }).from(users).where(eq(users.id, req.userId)).limit(1);
    if (!me?.isSuperAdmin || me.bannedAt) throw notFound('Page');
    req.adminEmail = me.email;
  });

  async function audit(req: FastifyRequest, action: string, targetType: string, targetId: string | null, targetLabel: string | null, details?: Record<string, unknown>) {
    await db.insert(adminAudit).values({ adminId: req.userId, adminEmail: req.adminEmail, action, targetType, targetId, targetLabel, details: details ?? null });
  }

  /** The target of an action, refusing the ones that could lock the site's owners out. */
  async function loadTarget(req: FastifyRequest<{ Params: { id: string } }>, opts: { protect?: boolean } = {}) {
    if (!isUuid(req.params.id)) throw notFound('User');
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!user) throw notFound('User');
    if (opts.protect && user.id === req.userId) throw badRequest('You can’t do this to your own account.');
    if (opts.protect && user.isSuperAdmin) throw badRequest('This is a super admin. Remove their admin rights from the command line first.');
    return user;
  }

  // ------------------------------------------------------------------ stats
  app.get('/overview', async () => buildOverview(db, config.STATS_TIMEZONE, config.PRICING_CURRENCY));

  app.get<{ Querystring: { days?: string } }>('/engagement', async (req) => {
    const days = Number(req.query.days);
    return buildEngagement(db, config.STATS_TIMEZONE, days === 7 || days === 90 ? days : 30);
  });

  app.get('/app-stats', async () => buildAppStats(db, config.STATS_TIMEZONE));

  // ------------------------------------------------------------------ users
  // Nested queries name their tables literally: the query builder omits them on single-table selects.
  async function userRows(input: z.output<typeof listUsersSchema>, limit: number, offset: number) {
    const conds = [
      input.q ? or(ilike(users.email, like(input.q)), ilike(users.name, like(input.q))) : undefined,
      input.status === 'banned' ? isNotNull(users.bannedAt) : input.status === 'active' ? isNull(users.bannedAt) : input.status === 'admin' ? eq(users.isSuperAdmin, true) : undefined,
    ];
    const where = and(...conds);
    const order = input.sort === 'lastSeen' ? sql`${users.lastSeenAt} desc nulls last` : input.sort === 'name' ? asc(users.name) : desc(users.createdAt);
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
        bannedAt: users.bannedAt,
        isSuperAdmin: users.isSuperAdmin,
        projects: sql<number>`(select count(*)::int from projects p join organizations o on o.id = p.org_id where o.owner_id = users.id and p.deleted_at is null and not p.is_demo)`,
        workspace: sql<{ plan: string; planStatus: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null>`(
          select json_build_object('plan', o.plan, 'planStatus', o.plan_status, 'trialEndsAt', o.trial_ends_at, 'currentPeriodEnd', o.current_period_end)
          from organizations o where o.owner_id = users.id order by o.created_at limit 1)`,
      })
      .from(users)
      .where(where)
      .orderBy(order)
      .limit(limit)
      .offset(offset);
    const items: AdminUserRow[] = rows.map(({ workspace, ...r }) => {
      const label = workspace ? planLabel({ ...workspace, trialEndsAt: workspace.trialEndsAt ? new Date(workspace.trialEndsAt) : null, currentPeriodEnd: workspace.currentPeriodEnd ? new Date(workspace.currentPeriodEnd) : null }) : null;
      return {
        ...r,
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
        bannedAt: r.bannedAt?.toISOString() ?? null,
        plan: label?.plan ?? null,
        trialing: label?.trialing ?? false,
      };
    });
    return { items, where };
  }

  app.get('/users', async (req) => {
    const input = parse(listUsersSchema, req.query);
    const { items, where } = await userRows(input, input.limit, input.offset);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(where);
    return { items, total: count?.n ?? 0 };
  });

  app.get('/users/export.csv', async (req, reply) => {
    const input = parse(listUsersSchema, req.query);
    const { items } = await userRows(input, 50_000, 0);
    await audit(req, 'users.export', 'user', null, `${items.length} accounts`, input.q ? { search: input.q } : undefined);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="brickledger-users.csv"');
    return toCsv(
      ['Name', 'Email', 'Phone', 'Plan', 'Projects', 'Signed up', 'Last seen', 'Status'],
      items.map((u) => [u.name, u.email, u.phone, u.plan ?? '', u.projects, u.createdAt, u.lastSeenAt ?? '', u.bannedAt ? 'Banned' : 'Active']),
    );
  });

  app.get<{ Params: { id: string } }>('/users/:id', async (req): Promise<AdminUserDetail> => {
    const user = await loadTarget(req);
    const [workspaces, activeSessions, ownedProjects, history] = await Promise.all([
      listUserOrgs(db, user.id),
      db
        .select({ id: sessions.id, userAgent: sessions.userAgent, ip: sessions.ip, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt })
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
        .orderBy(desc(sessions.createdAt))
        .limit(10),
      rowsOf<{ id: string; name: string; status: string; isDemo: boolean; expenses: number; members: number; orgName: string; updatedAt: string }>(
        await db.execute(sql`
          select p.id, p.name, p.status, p.is_demo as "isDemo", o.name as "orgName", p.updated_at as "updatedAt",
            (select count(*)::int from expenses e where e.project_id = p.id and e.deleted_at is null) as expenses,
            (select count(*)::int from project_members m where m.project_id = p.id) as members
          from projects p join organizations o on o.id = p.org_id
          where o.owner_id = ${user.id} and p.deleted_at is null
          order by p.updated_at desc limit 50`),
      ),
      db.select().from(adminAudit).where(eq(adminAudit.targetId, user.id)).orderBy(desc(adminAudit.createdAt)).limit(20),
    ]);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      bannedAt: user.bannedAt?.toISOString() ?? null,
      banReason: user.banReason,
      isSuperAdmin: user.isSuperAdmin,
      workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role, plan: w.plan })),
      sessions: activeSessions.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt?.toISOString() ?? null })),
      projects: ownedProjects.map((p) => ({ ...p, updatedAt: new Date(p.updatedAt).toISOString() })),
      history: history.map((h) => ({ id: h.id, adminEmail: h.adminEmail, action: h.action, targetType: h.targetType, targetId: h.targetId, targetLabel: h.targetLabel, details: (h.details as Record<string, unknown> | null) ?? null, createdAt: h.createdAt.toISOString() })),
    };
  });

  app.patch<{ Params: { id: string } }>('/users/:id', async (req) => {
    const user = await loadTarget(req);
    const input = parse(updateUserSchema, req.body);
    if (input.email && input.email !== user.email) {
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
      if (taken) throw conflict('Another account already uses this email.');
    }
    await db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, user.id));
    await audit(req, 'user.update', 'user', user.id, user.email, { from: { name: user.name, email: user.email }, to: input });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/users/:id/ban', async (req) => {
    const user = await loadTarget(req, { protect: true });
    const input = parse(banSchema, req.body);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ bannedAt: new Date(), banReason: input.reason, updatedAt: new Date() }).where(eq(users.id, user.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    });
    app.accountGate.forget(user.id);
    await audit(req, 'user.ban', 'user', user.id, user.email, { reason: input.reason });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/users/:id/unban', async (req) => {
    const user = await loadTarget(req);
    await db.update(users).set({ bannedAt: null, banReason: null, updatedAt: new Date() }).where(eq(users.id, user.id));
    app.accountGate.forget(user.id);
    await audit(req, 'user.unban', 'user', user.id, user.email);
    return { ok: true };
  });

  /** Signs the account out on every device. */
  app.post<{ Params: { id: string } }>('/users/:id/sign-out', async (req) => {
    const user = await loadTarget(req);
    const revoked = await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt))).returning({ id: sessions.id });
    await audit(req, 'user.sign_out', 'user', user.id, user.email, { sessions: revoked.length });
    return { ok: true, sessions: revoked.length };
  });

  /** A one-hour password reset link to pass on by hand (and by email, when email is set up). */
  app.post<{ Params: { id: string } }>('/users/:id/reset-link', async (req) => {
    const user = await loadTarget(req);
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + 3600_000);
    await db.insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt });
    await audit(req, 'user.reset_link', 'user', user.id, user.email);
    return { url: `${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() };
  });

  app.delete<{ Params: { id: string } }>('/users/:id', async (req) => {
    const user = await loadTarget(req, { protect: true });
    const input = parse(deleteUserSchema, req.body);
    if (input.confirmEmail !== user.email) throw badRequest('Type the account’s email address to confirm.');
    await deleteUserAccount(db, storage, user.id);
    app.accountGate.forget(user.id);
    await audit(req, 'user.delete', 'user', user.id, user.email, { name: user.name });
    return { ok: true };
  });

  // ------------------------------------------------------------------ workspaces
  app.get('/workspaces', async (req) => {
    const input = parse(listWorkspacesSchema, req.query);
    const where = and(
      input.q ? or(ilike(organizations.name, like(input.q)), sql`exists (select 1 from users u where u.id = organizations.owner_id and u.email ilike ${like(input.q)})`) : undefined,
      input.plan !== 'all' ? eq(organizations.plan, input.plan) : undefined,
    );
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
        planStatus: organizations.planStatus,
        trialEndsAt: organizations.trialEndsAt,
        currentPeriodEnd: organizations.currentPeriodEnd,
        billingProvider: organizations.billingProvider,
        billingSubscriptionId: organizations.billingSubscriptionId,
        createdAt: organizations.createdAt,
        ownerEmail: sql<string | null>`(select u.email from users u where u.id = organizations.owner_id)`,
        ownerId: organizations.ownerId,
        members: sql<number>`(select count(*)::int from org_members m where m.org_id = organizations.id)`,
        projects: sql<number>`(select count(*)::int from projects p where p.org_id = organizations.id and p.deleted_at is null and not p.is_demo)`,
        storageBytes: sql<number>`(select coalesce(sum(f.size_bytes), 0)::float8 from files f join projects p on p.id = f.project_id where p.org_id = organizations.id and f.deleted_at is null)`,
      })
      .from(organizations)
      .where(where)
      .orderBy(desc(organizations.createdAt))
      .limit(input.limit)
      .offset(input.offset);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(where);
    const items: AdminWorkspaceRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      plan: effectivePlanId(r),
      planStatus: r.planStatus,
      trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
      hasSubscription: Boolean(r.billingSubscriptionId) && r.billingProvider !== 'mock',
      ownerEmail: r.ownerEmail,
      ownerId: r.ownerId,
      members: r.members,
      projects: r.projects,
      storageBytes: Number(r.storageBytes),
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total: count?.n ?? 0 };
  });

  async function loadWorkspace(id: string) {
    if (!isUuid(id)) throw notFound('Workspace');
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!org) throw notFound('Workspace');
    return org;
  }

  /** Gives a workspace a plan for free (or removes it). A live paid subscription keeps its own billing. */
  app.patch<{ Params: { id: string } }>('/workspaces/:id/plan', async (req) => {
    const org = await loadWorkspace(req.params.id);
    const input = parse(setPlanSchema, req.body);
    if (org.billingSubscriptionId && org.billingProvider !== 'mock') {
      throw conflict('This workspace has a paid subscription. Change or cancel it with your payment provider instead.');
    }
    const plan: PlanId = input.plan;
    await db.update(organizations).set({ plan, planStatus: 'active', trialEndsAt: null, currentPeriodEnd: null, updatedAt: new Date() }).where(eq(organizations.id, org.id));
    await audit(req, 'workspace.plan', 'workspace', org.id, org.name, { from: effectivePlanId(org), to: plan });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/workspaces/:id/extend-trial', async (req) => {
    const org = await loadWorkspace(req.params.id);
    const input = parse(extendTrialSchema, req.body);
    if (org.billingSubscriptionId && org.billingProvider !== 'mock') throw conflict('This workspace already has a paid subscription.');
    const base = org.trialEndsAt && org.trialEndsAt.getTime() > Date.now() ? org.trialEndsAt.getTime() : Date.now();
    const trialEndsAt = new Date(base + input.days * 86_400_000);
    await db.update(organizations).set({ plan: org.plan === 'free' ? 'pro' : org.plan, planStatus: 'trialing', trialEndsAt, updatedAt: new Date() }).where(eq(organizations.id, org.id));
    await audit(req, 'workspace.extend_trial', 'workspace', org.id, org.name, { days: input.days, until: trialEndsAt.toISOString() });
    return { ok: true, trialEndsAt: trialEndsAt.toISOString() };
  });

  // ------------------------------------------------------------------ audit log & system
  app.get('/audit', async (req) => {
    const input = parse(z.object({ q: z.string().trim().max(120).catch(''), ...paging }), req.query);
    const where = input.q ? or(ilike(adminAudit.targetLabel, like(input.q)), ilike(adminAudit.action, like(input.q)), ilike(adminAudit.adminEmail, like(input.q))) : undefined;
    const rows = await db.select().from(adminAudit).where(where).orderBy(desc(adminAudit.createdAt)).limit(input.limit).offset(input.offset);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(adminAudit).where(where);
    return {
      total: count?.n ?? 0,
      items: rows.map((h) => ({ id: h.id, adminEmail: h.adminEmail, action: h.action, targetType: h.targetType, targetId: h.targetId, targetLabel: h.targetLabel, details: (h.details as Record<string, unknown> | null) ?? null, createdAt: h.createdAt.toISOString() })),
    };
  });

  app.get('/system', async () => {
    const started = performance.now();
    const dbUp = await database.ping().catch(() => false);
    const latencyMs = Math.round(performance.now() - started);
    const size = await db.execute(sql`select pg_database_size(current_database())::float8 as size`).then((r) => Number(rowsOf<{ size: number }>(r)[0]?.size ?? 0)).catch(() => 0);
    const [sessionCount] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
    const emailOn = Boolean(config.SMTP_URL);
    const checks = [
      { key: 'database', level: dbUp ? 'ok' : 'error', title: 'Database', message: dbUp ? `Connected (${database.driver}), ${latencyMs} ms` : 'Not reachable' },
      database.driver === 'pglite' ? { key: 'database-kind', level: 'warning', title: 'Local database', message: 'Using the built-in database. Set DATABASE_URL to PostgreSQL for real use.' } : null,
      storage.driver === 'not-configured'
        ? { key: 'storage', level: 'warning', title: 'File storage', message: 'Not set up, so photo and document uploads are refused. Connect S3 or Cloudflare R2.' }
        : { key: 'storage', level: 'ok', title: 'File storage', message: storage.driver === 's3' ? 'S3-compatible storage connected' : 'Saved on this server’s disk' },
      emailOn
        ? { key: 'email', level: 'ok', title: 'Email', message: 'Connected' }
        : { key: 'email', level: 'warning', title: 'Email', message: 'Not set up: password resets and invites aren’t emailed. Add SMTP_URL, or use “Reset link” on an account.' },
      billing.name === 'mock'
        ? { key: 'billing', level: 'info', title: 'Payments', message: 'Test mode: upgrades are free. Set BILLING_PROVIDER to take real payments.' }
        : { key: 'billing', level: 'ok', title: 'Payments', message: `${billing.name} connected` },
    ].filter(Boolean);
    return {
      version: VERSION,
      node: process.version,
      region: process.env.VERCEL_REGION ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      statsTimezone: config.STATS_TIMEZONE,
      database: { driver: database.driver, up: dbUp, latencyMs, sizeBytes: size },
      activeSessions: sessionCount?.n ?? 0,
      checks,
    };
  });

}
