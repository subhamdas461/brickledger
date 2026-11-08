import { TRIAL_DAYS, TRIAL_PLAN, type MeResponse, type OrgRole, type OrgSummary, type PlanStatus, type User } from '@brickledger/shared';
import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { orgMembers, organizations, users } from '../../db/schema';
import { firstName } from '../../lib/util';
import { planOf } from '../billing/limits';

type UserRow = typeof users.$inferSelect;

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, createdAt: row.createdAt.toISOString() };
}

export async function listUserOrgs(db: Executor, userId: string): Promise<OrgSummary[]> {
  const rows = await db
    .select({ org: organizations, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(orgMembers.createdAt));
  // Owned workspaces first.
  rows.sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));
  return rows.map(({ org, role }) => ({
    id: org.id,
    name: org.name,
    role: role as OrgRole,
    plan: planOf(org),
    planStatus: org.planStatus as PlanStatus,
    trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
  }));
}

export async function buildMe(db: Executor, userId: string): Promise<MeResponse | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  return { user: toUser(user), orgs: await listUserOrgs(db, userId) };
}

/** Every new account gets its own workspace, starting with a free trial of Pro. */
export async function createWorkspace(
  db: Executor,
  opts: { ownerId: string; ownerName: string; name?: string | null; currency: string },
) {
  const [org] = await db
    .insert(organizations)
    .values({
      name: opts.name?.trim() || `${firstName(opts.ownerName)}'s workspace`,
      ownerId: opts.ownerId,
      plan: TRIAL_PLAN,
      planStatus: 'trialing',
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      defaultCurrency: opts.currency,
    })
    .returning();
  await db.insert(orgMembers).values({ orgId: org!.id, userId: opts.ownerId, role: 'owner' });
  return org!;
}
