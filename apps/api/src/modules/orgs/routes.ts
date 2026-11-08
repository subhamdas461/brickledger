import { OrgRoles, PLANS, updateOrgSchema, type OrgDetail, type OrgMember, type OrgRole, type PlanStatus } from '@brickledger/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../../db/client';
import { orgMembers, organizations, projectMembers, projects, users } from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { isUuid } from '../../lib/util';
import { parse } from '../../lib/validate';
import { getOrgUsage, planOf } from '../billing/limits';
import { applyBillingEvent } from '../billing/service';

type OrgRow = typeof organizations.$inferSelect;

export async function loadOrgAccess(db: DB, userId: string, orgId: string, adminOnly = false) {
  if (!isUuid(orgId)) throw notFound('Workspace');
  const [row] = await db
    .select({ org: organizations, role: orgMembers.role })
    .from(organizations)
    .innerJoin(orgMembers, and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, userId)))
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!row) throw notFound('Workspace');
  if (adminOnly && row.role !== 'owner' && row.role !== 'admin') throw forbidden('Only workspace owners and admins can do that.');
  return { org: row.org, role: row.role as OrgRole };
}

export async function orgDetail(db: DB, org: OrgRow, role: OrgRole): Promise<OrgDetail> {
  const usage = await getOrgUsage(db, org.id);
  const plan = planOf(org);
  return {
    id: org.id,
    name: org.name,
    defaultCurrency: org.defaultCurrency,
    role,
    plan: org.plan as OrgDetail['plan'],
    effectivePlan: plan,
    planStatus: org.planStatus as PlanStatus,
    planInterval: (org.planInterval as OrgDetail['planInterval']) ?? null,
    trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
    billingProvider: org.billingProvider,
    hasSubscription: Boolean(org.billingSubscriptionId),
    usage: { projects: usage.projects, members: usage.members, storageMb: Math.round((usage.storageBytes / 1024 / 1024) * 10) / 10 },
    limits: PLANS[plan].limits,
    features: PLANS[plan].features,
  };
}

const checkoutSchema = z.object({ plan: z.enum(['pro', 'business']), interval: z.enum(['month', 'year']) });

export async function orgRoutes(app: FastifyInstance) {
  const { db, billing, config } = app.ctx;

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId', async (req) => {
    const { org, role } = await loadOrgAccess(db, req.userId, req.params.orgId);
    return orgDetail(db, org, role);
  });

  app.patch<{ Params: { orgId: string } }>('/orgs/:orgId', async (req) => {
    const { org, role } = await loadOrgAccess(db, req.userId, req.params.orgId, true);
    const input = parse(updateOrgSchema, req.body);
    const [updated] = await db
      .update(organizations)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(organizations.id, org.id))
      .returning();
    return orgDetail(db, updated!, role);
  });

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/members', async (req): Promise<OrgMember[]> => {
    const { org } = await loadOrgAccess(db, req.userId, req.params.orgId, true);
    const rows = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: orgMembers.role, joinedAt: orgMembers.createdAt })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(eq(orgMembers.orgId, org.id));
    const projectCounts = await db
      .select({ userId: projectMembers.userId, n: count() })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projects.orgId, org.id))
      .groupBy(projectMembers.userId);
    const byUser = new Map(projectCounts.map((p) => [p.userId, p.n]));
    const rank: Record<string, number> = { owner: 0, admin: 1, member: 2 };
    return rows
      .map((r) => ({ ...r, role: r.role as OrgRole, projects: byUser.get(r.userId) ?? 0, joinedAt: r.joinedAt.toISOString() }))
      .sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name));
  });

  app.patch<{ Params: { orgId: string; userId: string } }>('/orgs/:orgId/members/:userId', async (req) => {
    const { org, role } = await loadOrgAccess(db, req.userId, req.params.orgId, true);
    if (role !== 'owner') throw forbidden('Only the workspace owner can change roles.');
    const input = parse(z.object({ role: z.enum(['admin', 'member']) }), req.body);
    if (!isUuid(req.params.userId) || req.params.userId === org.ownerId) throw badRequest("The owner's role can't be changed.");
    const updated = await db
      .update(orgMembers)
      .set({ role: input.role })
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, req.params.userId)))
      .returning();
    if (!updated.length) throw notFound('Member');
    return { ok: true, role: OrgRoles.label(input.role) };
  });

  app.delete<{ Params: { orgId: string; userId: string } }>('/orgs/:orgId/members/:userId', async (req) => {
    const { org } = await loadOrgAccess(db, req.userId, req.params.orgId, true);
    if (!isUuid(req.params.userId)) throw notFound('Member');
    if (req.params.userId === org.ownerId) throw badRequest("The workspace owner can't be removed.");
    const orgProjects = db.select({ id: projects.id }).from(projects).where(eq(projects.orgId, org.id));
    await db.transaction(async (tx) => {
      await tx.delete(projectMembers).where(and(eq(projectMembers.userId, req.params.userId), inArray(projectMembers.projectId, orgProjects)));
      await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, req.params.userId)));
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- billing actions

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/billing/checkout', async (req) => {
    const { org } = await loadOrgAccess(db, req.userId, req.params.orgId, true);
    const input = parse(checkoutSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.id, req.userId)).limit(1);
    const returnBase = `${config.APP_URL}/app/settings/billing`;
    const result = await billing.createCheckout({
      org: { id: org.id, name: org.name, billingCustomerId: org.billingCustomerId },
      user: { email: user!.email, name: user!.name },
      plan: input.plan,
      interval: input.interval,
      successUrl: `${returnBase}?checkout=success`,
      cancelUrl: `${returnBase}?checkout=cancelled`,
    });
    if (billing.name === 'mock') {
      // Development/demo: activate instantly so the full upgrade flow can be exercised without a gateway.
      await applyBillingEvent(db, 'mock', {
        id: `mock-${org.id}-${Date.now()}`,
        type: 'mock.checkout',
        orgId: org.id,
        subscriptionId: `mock_sub_${org.id.slice(0, 8)}`,
        plan: input.plan,
        interval: input.interval,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + (input.interval === 'year' ? 365 : 30) * 86_400_000),
      });
    }
    return result;
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/billing/portal', async (req) => {
    const { org } = await loadOrgAccess(db, req.userId, req.params.orgId, true);
    const portal = await billing.createPortal(org, `${config.APP_URL}/app/settings/billing`);
    return portal ?? { url: null };
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/billing/cancel', async (req) => {
    const { org, role } = await loadOrgAccess(db, req.userId, req.params.orgId, true);
    if (billing.name === 'mock' || org.billingProvider === 'mock') {
      const [updated] = await db
        .update(organizations)
        .set({ planStatus: 'canceled', updatedAt: new Date() })
        .where(eq(organizations.id, org.id))
        .returning();
      return orgDetail(db, updated!, role);
    }
    await billing.cancel(org);
    // The provider confirms via webhook; the plan stays active until the period ends.
    return orgDetail(db, org, role);
  });
}
