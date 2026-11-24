import type { NotificationItem, NotificationsResponse } from '@brickledger/shared';
import { and, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Executor } from '../../db/client';
import { activities, orgMembers, projectMembers, projects, pushDevices, users } from '../../db/schema';
import { parse } from '../../lib/validate';

/** More than this many unread shows as "99+"; counting stops there. */
const UNREAD_CAP = 100;

type Watched = Map<string, { name: string; since: Date }>;

/**
 * Projects whose changes reach this user, and since when: joining a project later doesn't replay
 * its history. Workspace owners and admins see every project in the workspace, as they do in the app.
 */
export async function watchedProjects(db: Executor, userId: string): Promise<Watched> {
  const direct = await db
    .select({ id: projects.id, name: projects.name, since: projectMembers.createdAt })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, userId), isNull(projects.deletedAt)));
  const viaWorkspace = await db
    .select({ id: projects.id, name: projects.name, since: orgMembers.createdAt })
    .from(orgMembers)
    .innerJoin(projects, eq(projects.orgId, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, userId), inArray(orgMembers.role, ['owner', 'admin']), isNull(projects.deletedAt)));
  const out: Watched = new Map();
  for (const p of [...direct, ...viaWorkspace]) {
    const known = out.get(p.id);
    if (!known || p.since < known.since) out.set(p.id, { name: p.name, since: p.since });
  }
  return out;
}

/** Changes by anyone but this user, in their projects, since they joined each. */
function scope(userId: string, watched: Watched): SQL | undefined {
  if (!watched.size) return undefined;
  return and(
    or(...[...watched].map(([id, p]) => and(eq(activities.projectId, id), gte(activities.createdAt, p.since)))),
    or(isNull(activities.userId), ne(activities.userId, userId)),
  );
}

async function seenId(db: Executor, userId: string): Promise<number> {
  const [row] = await db.select({ seen: users.notificationsSeenId }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.seen ?? 0;
}

async function counts(db: Executor, where: SQL | undefined, seen: number) {
  if (!where) return { unread: 0, latestId: 0 };
  const unread = await db.select({ id: activities.id }).from(activities).where(and(where, gt(activities.id, seen))).limit(UNREAD_CAP);
  const [latest] = await db.select({ id: activities.id }).from(activities).where(where).orderBy(desc(activities.id)).limit(1);
  return { unread: unread.length, latestId: latest?.id ?? 0 };
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Older than this id (paging back through the list). */
  before: z.coerce.number().int().positive().optional(),
  /** Newer than this id (what a phone hasn't shown yet). */
  after: z.coerce.number().int().min(0).optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  /** A phone's push token, so changes reach it instantly. A token moves to whoever signed in on that phone last. */
  app.post('/devices', async (req) => {
    const { token, platform } = parse(z.object({ token: z.string().trim().min(20).max(4096), platform: z.enum(['android']).default('android') }), req.body);
    await db
      .insert(pushDevices)
      .values({ token, userId: req.userId, platform })
      .onConflictDoUpdate({ target: pushDevices.token, set: { userId: req.userId, platform, lastSeenAt: new Date() } });
    return { ok: true, instant: app.ctx.push.enabled };
  });

  /** Signing out (or turning team updates off) on a phone. */
  app.post('/devices/remove', async (req) => {
    const { token } = parse(z.object({ token: z.string().trim().max(4096) }), req.body);
    await db.delete(pushDevices).where(and(eq(pushDevices.token, token), eq(pushDevices.userId, req.userId)));
    return { ok: true };
  });

  app.get('/notifications', async (req): Promise<NotificationsResponse> => {
    const q = parse(listQuery, req.query);
    const watched = await watchedProjects(db, req.userId);
    const where = scope(req.userId, watched);
    const seen = await seenId(db, req.userId);
    if (!where) return { items: [], unread: 0, latestId: 0 };

    const conditions = [where];
    if (q.before) conditions.push(lt(activities.id, q.before));
    if (q.after !== undefined) conditions.push(gt(activities.id, q.after));
    const rows = await db
      .select({
        id: activities.id,
        projectId: activities.projectId,
        action: activities.action,
        entityType: activities.entityType,
        entityId: activities.entityId,
        summary: activities.summary,
        createdAt: activities.createdAt,
        userId: users.id,
        userName: users.name,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.userId))
      .where(and(...conditions))
      .orderBy(desc(activities.id))
      .limit(q.limit ?? 30);
    const items: NotificationItem[] = rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: watched.get(r.projectId)?.name ?? '',
      action: r.action as NotificationItem['action'],
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
      user: r.userId ? { id: r.userId, name: r.userName ?? '' } : null,
      unread: r.id > seen,
    }));
    return { items, ...(await counts(db, where, seen)) };
  });

  /** Cheap enough to poll: the unread count and the newest id. */
  app.get('/notifications/count', async (req) => {
    const watched = await watchedProjects(db, req.userId);
    return counts(db, scope(req.userId, watched), await seenId(db, req.userId));
  });

  /** Marks everything up to `upTo` (default: the newest) as read. Never moves backwards. */
  app.post('/notifications/read', async (req) => {
    // The Android app sends `upTo: null` for "everything".
    const { upTo } = parse(z.object({ upTo: z.number().int().min(0).nullish() }), req.body ?? {});
    const watched = await watchedProjects(db, req.userId);
    const where = scope(req.userId, watched);
    const target = upTo ?? (await counts(db, where, Number.MAX_SAFE_INTEGER)).latestId;
    await db
      .update(users)
      .set({ notificationsSeenId: sql`greatest(${users.notificationsSeenId}, ${target})` })
      .where(eq(users.id, req.userId));
    return counts(db, where, await seenId(db, req.userId));
  });
}
