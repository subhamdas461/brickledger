import { PLANS, type OrgRole, type PlanId, type Project, type ProjectDetail, type ProjectRole } from '@brickledger/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Executor } from '../../db/client';
import { orgMembers, organizations, projectMembers, projects } from '../../db/schema';
import { forbidden, notFound } from '../../lib/errors';
import { isUuid } from '../../lib/util';
import { planOf } from '../billing/limits';
import { ROLE_RANK } from '../members/service';

export type ProjectRow = typeof projects.$inferSelect;
export type OrgRow = typeof organizations.$inferSelect;

export interface ProjectAccess {
  project: ProjectRow;
  org: OrgRow;
  role: ProjectRole;
  orgRole: OrgRole | null;
  plan: PlanId;
  userId: string;
}

/**
 * Resolves the caller's effective role on a project. Workspace owners/admins are
 * managers of every project in their workspace; everyone else needs a project
 * membership. Projects the caller can't see are reported as "not found".
 */
export async function loadProjectAccess(db: Executor, userId: string, projectId: string): Promise<ProjectAccess> {
  if (!isUuid(projectId)) throw notFound('Project');
  const [row] = await db
    .select({ project: projects, org: organizations, orgRole: orgMembers.role, projectRole: projectMembers.role })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .leftJoin(orgMembers, and(eq(orgMembers.orgId, projects.orgId), eq(orgMembers.userId, userId)))
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Project');
  const orgRole = (row.orgRole as OrgRole | null) ?? null;
  const role: ProjectRole | null =
    orgRole === 'owner' || orgRole === 'admin' ? 'manager' : ((row.projectRole as ProjectRole | null) ?? null);
  if (!role) throw notFound('Project');
  return { project: row.project, org: row.org, role, orgRole, plan: planOf(row.org), userId };
}

/** Request-scoped cache so several helpers can resolve access without repeating the query. */
export async function projectAccess(req: FastifyRequest, projectId: string): Promise<ProjectAccess> {
  const cache = ((req as any)._projectAccess ??= new Map<string, Promise<ProjectAccess>>()) as Map<string, Promise<ProjectAccess>>;
  let hit = cache.get(projectId);
  if (!hit) {
    hit = loadProjectAccess(req.server.ctx.db, req.userId, projectId);
    cache.set(projectId, hit);
  }
  return hit;
}

export function requireRole(access: ProjectAccess, min: ProjectRole, action = 'do that') {
  if (ROLE_RANK[access.role] < ROLE_RANK[min]) {
    const needed = min === 'manager' ? 'a project manager' : 'a contributor or manager';
    throw forbidden(`Only ${needed} can ${action}.`);
  }
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    address: row.address,
    city: row.city,
    status: row.status,
    currency: row.currency,
    totalBudget: row.totalBudget,
    plotArea: row.plotArea,
    builtUpArea: row.builtUpArea,
    areaUnit: row.areaUnit,
    floors: row.floors,
    startDate: row.startDate,
    targetEndDate: row.targetEndDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProjectDetail(access: ProjectAccess): ProjectDetail {
  return {
    ...toProject(access.project),
    role: access.role,
    orgName: access.org.name,
    orgPlan: access.plan,
    features: PLANS[access.plan].features,
  };
}
