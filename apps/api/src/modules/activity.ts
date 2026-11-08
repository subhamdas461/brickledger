import type { ActivityItem } from '@brickledger/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { activities, users } from '../db/schema';

export interface ActivityInput {
  projectId: string;
  userId: string | null;
  action: 'create' | 'update' | 'delete';
  entityType: string;
  entityId?: string | null;
  summary: string;
}

export async function logActivity(db: Executor, input: ActivityInput): Promise<void> {
  await db.insert(activities).values({ ...input, entityId: input.entityId ?? null, summary: input.summary.slice(0, 500) });
}

export async function listActivity(
  db: Executor,
  projectId: string,
  opts: { before?: number; limit?: number; entityId?: string } = {},
): Promise<ActivityItem[]> {
  const conditions = [eq(activities.projectId, projectId)];
  if (opts.before) conditions.push(lt(activities.id, opts.before));
  if (opts.entityId) conditions.push(eq(activities.entityId, opts.entityId));
  const rows = await db
    .select({
      id: activities.id,
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
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map((r) => ({
    id: r.id,
    action: r.action as ActivityItem['action'],
    entityType: r.entityType,
    entityId: r.entityId,
    summary: r.summary,
    createdAt: r.createdAt.toISOString(),
    user: r.userId ? { id: r.userId, name: r.userName ?? '' } : null,
  }));
}
