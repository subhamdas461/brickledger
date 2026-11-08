import { PLANS, effectivePlanId, type PlanFeatures, type PlanId } from '@brickledger/shared';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { files, invitations, orgMembers, organizations, projects } from '../../db/schema';
import { planLimit } from '../../lib/errors';

type OrgRow = typeof organizations.$inferSelect;

export function planOf(org: OrgRow): PlanId {
  return effectivePlanId(org);
}

export async function getOrgUsage(db: Executor, orgId: string) {
  const [p] = await db
    .select({ n: count() })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt), eq(projects.isDemo, false)));
  const [m] = await db.select({ n: count() }).from(orgMembers).where(eq(orgMembers.orgId, orgId));
  const [i] = await db
    .select({ n: count() })
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, sql`now()`)));
  const [s] = await db
    .select({ bytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)`.mapWith(Number) })
    .from(files)
    .innerJoin(projects, eq(projects.id, files.projectId))
    .where(and(eq(projects.orgId, orgId), isNull(files.deletedAt)));
  return {
    projects: p?.n ?? 0,
    members: (m?.n ?? 0) + (i?.n ?? 0),
    storageBytes: s?.bytes ?? 0,
  };
}

const upgradeHint = (plan: PlanId) => (plan === 'free' ? 'Upgrade to Pro' : plan === 'pro' ? 'Upgrade to Business' : 'Contact support');

export async function assertCanCreateProject(db: Executor, org: OrgRow) {
  const plan = planOf(org);
  const limit = PLANS[plan].limits.projects;
  if (limit === null) return;
  const usage = await getOrgUsage(db, org.id);
  if (usage.projects >= limit) {
    throw planLimit(
      `Your ${PLANS[plan].name} plan allows ${limit} active project${limit === 1 ? '' : 's'}. ${upgradeHint(plan)} to add more.`,
      { limit: 'projects', plan, max: limit },
    );
  }
}

export async function assertCanAddMember(db: Executor, org: OrgRow) {
  const plan = planOf(org);
  const limit = PLANS[plan].limits.members;
  if (limit === null) return;
  const usage = await getOrgUsage(db, org.id);
  if (usage.members >= limit) {
    throw planLimit(`Your ${PLANS[plan].name} plan allows ${limit} people. ${upgradeHint(plan)} to invite more.`, {
      limit: 'members',
      plan,
      max: limit,
    });
  }
}

export async function assertStorage(db: Executor, org: OrgRow, addBytes: number) {
  const plan = planOf(org);
  const limitBytes = PLANS[plan].limits.storageMb * 1024 * 1024;
  const usage = await getOrgUsage(db, org.id);
  if (usage.storageBytes + addBytes > limitBytes) {
    throw planLimit(`Storage full (${PLANS[plan].limits.storageMb} MB on ${PLANS[plan].name}). ${upgradeHint(plan)} for more space.`, {
      limit: 'storage',
      plan,
    });
  }
}

export function assertFeature(org: OrgRow, feature: keyof PlanFeatures, label: string) {
  const plan = planOf(org);
  if (!PLANS[plan].features[feature]) {
    throw planLimit(`${label} ${label.endsWith('s') ? 'are' : 'is'} available on Pro and Business plans.`, { feature, plan });
  }
}
