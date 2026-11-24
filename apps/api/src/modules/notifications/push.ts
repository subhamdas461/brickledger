import { activityWords } from '@brickledger/shared';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { Executor } from '../../db/client';
import { activities, orgMembers, projectMembers, projects, pushDevices, users } from '../../db/schema';

/** Everyone who sees a project (members, and workspace owners/admins), except the person who made the change. */
async function watchers(db: Executor, projectId: string, actorId: string | null): Promise<string[]> {
  const members = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
  const admins = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .innerJoin(projects, eq(projects.orgId, orgMembers.orgId))
    .where(and(eq(projects.id, projectId), inArray(orgMembers.role, ['owner', 'admin'])));
  return [...new Set([...members, ...admins].map((m) => m.userId))].filter((id) => id !== actorId);
}

/**
 * Pushes the changes one request made to the other members' phones: one message per project,
 * naming the change (or "made 3 changes"). Only committed changes go out; tokens Google says are
 * gone (app uninstalled) are forgotten.
 */
export async function pushActivities(ctx: AppContext, ids: number[]): Promise<void> {
  if (!ctx.push.enabled || !ids.length) return;
  const { db } = ctx;
  const rows = await db
    .select({
      id: activities.id,
      projectId: activities.projectId,
      projectName: projects.name,
      userId: activities.userId,
      userName: users.name,
      entityType: activities.entityType,
      summary: activities.summary,
    })
    .from(activities)
    .innerJoin(projects, and(eq(projects.id, activities.projectId), isNull(projects.deletedAt)))
    .leftJoin(users, eq(users.id, activities.userId))
    .where(inArray(activities.id, ids));

  const byProject = new Map<string, typeof rows>();
  for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);

  const gone = new Set<string>();
  const sends: Promise<void>[] = [];
  for (const [projectId, items] of byProject) {
    const newest = items.reduce((a, b) => (b.id > a.id ? b : a));
    const recipients = await watchers(db, projectId, newest.userId);
    if (!recipients.length) continue;
    const devices = await db
      .select({ token: pushDevices.token, userId: pushDevices.userId })
      .from(pushDevices)
      .where(and(inArray(pushDevices.userId, recipients), newest.userId ? ne(pushDevices.userId, newest.userId) : undefined));
    const name = newest.userName ?? 'Someone';
    const text = items.length === 1 ? `${name}${activityWords(newest.summary, newest.userName)}` : `${name} made ${items.length} changes`;
    const types = new Set(items.map((i) => i.entityType));
    for (const d of devices) {
      sends.push(
        ctx.push
          .send(d.token, {
            type: 'activity',
            // The phone ignores it if someone else is signed in there now.
            to: d.userId,
            id: String(newest.id),
            projectId,
            projectName: newest.projectName,
            entityType: types.size === 1 ? newest.entityType : '',
            text,
          })
          .then((result) => {
            if (result === 'gone') gone.add(d.token);
          }),
      );
    }
  }
  await Promise.all(sends);
  if (gone.size) await db.delete(pushDevices).where(inArray(pushDevices.token, [...gone]));
}
