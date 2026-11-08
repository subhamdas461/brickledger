import { createProjectSchema, projectSchema, type ProjectListItem, type ProjectRole } from '@brickledger/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { expenses, orgMembers, organizations, phases, projectMembers, projects, tasks } from '../../db/schema';
import { forbidden } from '../../lib/errors';
import { isIsoDate, utcToday } from '../../lib/util';
import { parse } from '../../lib/validate';
import { listActivity, logActivity } from '../activity';
import { listUserOrgs } from '../account/service';
import { computeDashboard, computeReport } from '../analytics/queries';
import { assertCanCreateProject, assertFeature } from '../billing/limits';
import { loadOrgAccess } from '../orgs/routes';
import { buildExport } from '../reports/csv';
import { renderReportPdf } from '../reports/pdf';
import { loadProjectAccess, projectAccess, requireRole, toProject, toProjectDetail } from './access';
import { createDemoProject } from './demo';
import { seedProjectTemplates } from './templates';

type P = { Params: { projectId: string }; Querystring: Record<string, string | undefined> };

const today = (q: Record<string, string | undefined>) => (isIsoDate(q.today) ? q.today : utcToday());

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
}

export async function projectRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  app.get('/projects', async (req): Promise<ProjectListItem[]> => {
    const uid = req.userId;
    const rows = await db
      .select({ project: projects, orgName: organizations.name, orgRole: orgMembers.role, projectRole: projectMembers.role })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.orgId))
      .leftJoin(orgMembers, and(eq(orgMembers.orgId, projects.orgId), eq(orgMembers.userId, uid)))
      .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, uid)))
      .where(and(isNull(projects.deletedAt), or(inArray(orgMembers.role, ['owner', 'admin']), isNotNull(projectMembers.userId))))
      // Real projects first (newest first), the sample project last.
      .orderBy(asc(projects.isDemo), desc(projects.createdAt));
    const ids = rows.map((r) => r.project.id);
    if (!ids.length) return [];

    const spend = await db
      .select({
        projectId: expenses.projectId,
        spent: sql<number>`coalesce(sum(${expenses.amount}) filter (where ${expenses.status} = 'paid'), 0)`.mapWith(Number),
        due: sql<number>`coalesce(sum(${expenses.amount}) filter (where ${expenses.status} = 'due'), 0)`.mapWith(Number),
      })
      .from(expenses)
      .where(and(inArray(expenses.projectId, ids), isNull(expenses.deletedAt)))
      .groupBy(expenses.projectId);
    const progress = await db
      .select({ projectId: phases.projectId, avg: sql<number>`coalesce(round(avg(${phases.progress})), 0)`.mapWith(Number) })
      .from(phases)
      .where(and(inArray(phases.projectId, ids), isNull(phases.deletedAt)))
      .groupBy(phases.projectId);
    const openTasks = await db
      .select({ projectId: tasks.projectId, n: sql<number>`count(*) filter (where ${tasks.status} <> 'done')`.mapWith(Number) })
      .from(tasks)
      .where(and(inArray(tasks.projectId, ids), isNull(tasks.deletedAt)))
      .groupBy(tasks.projectId);
    const spendBy = new Map(spend.map((s) => [s.projectId, s]));
    const progressBy = new Map(progress.map((s) => [s.projectId, s.avg]));
    const tasksBy = new Map(openTasks.map((s) => [s.projectId, s.n]));

    return rows.map((r) => ({
      ...toProject(r.project),
      orgName: r.orgName,
      role: (r.orgRole === 'owner' || r.orgRole === 'admin' ? 'manager' : r.projectRole) as ProjectRole,
      stats: {
        spent: spendBy.get(r.project.id)?.spent ?? 0,
        due: spendBy.get(r.project.id)?.due ?? 0,
        progress: progressBy.get(r.project.id) ?? 0,
        openTasks: tasksBy.get(r.project.id) ?? 0,
      },
    }));
  });

  const resolveOrg = async (userId: string, orgId?: string) => {
    let target = orgId;
    if (!target) {
      const orgs = await listUserOrgs(db, userId);
      target = (orgs.find((o) => o.role === 'owner') ?? orgs.find((o) => o.role === 'admin'))?.id;
      if (!target) throw forbidden('You need your own workspace to create projects.');
    }
    return loadOrgAccess(db, userId, target, true);
  };

  app.post('/projects', async (req, reply) => {
    const input = parse(createProjectSchema, req.body);
    const { org } = await resolveOrg(req.userId, input.orgId);
    await assertCanCreateProject(db, org);
    const { orgId: _orgId, useTemplates, ...fields } = input;
    const projectId = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ ...fields, orgId: org.id, currency: fields.currency ?? org.defaultCurrency, createdBy: req.userId })
        .returning();
      await tx.insert(projectMembers).values({ projectId: project!.id, userId: req.userId, role: 'manager', addedBy: req.userId });
      if (useTemplates !== false) {
        await seedProjectTemplates(tx, {
          projectId: project!.id,
          userId: req.userId,
          budget: project!.totalBudget,
          startDate: project!.startDate,
          targetEndDate: project!.targetEndDate,
        });
      }
      await logActivity(tx, { projectId: project!.id, userId: req.userId, action: 'create', entityType: 'projects', entityId: project!.id, summary: `Created project "${project!.name}"` });
      return project!.id;
    });
    reply.code(201);
    return toProjectDetail(await loadProjectAccess(db, req.userId, projectId));
  });

  /** One sample project per workspace; it doesn't count toward plan limits. */
  app.post('/projects/demo', async (req, reply) => {
    const input = parse(z.object({ orgId: z.uuid().optional() }), req.body ?? {});
    const { org } = await resolveOrg(req.userId, input.orgId);
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, org.id), eq(projects.isDemo, true), isNull(projects.deletedAt)))
      .limit(1);
    const projectId = existing?.id ?? (await createDemoProject(db, { orgId: org.id, userId: req.userId, currency: org.defaultCurrency }));
    reply.code(existing ? 200 : 201);
    return toProjectDetail(await loadProjectAccess(db, req.userId, projectId));
  });

  app.get<P>('/projects/:projectId', async (req) => toProjectDetail(await projectAccess(req, req.params.projectId)));

  app.patch<P>('/projects/:projectId', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'manager', 'edit project details');
    const input = parse(projectSchema.partial(), req.body);
    await db.transaction(async (tx) => {
      await tx.update(projects).set({ ...input, updatedAt: new Date() }).where(eq(projects.id, access.project.id));
      await logActivity(tx, { projectId: access.project.id, userId: req.userId, action: 'update', entityType: 'projects', entityId: access.project.id, summary: 'Updated project details' });
    });
    return toProjectDetail(await loadProjectAccess(db, req.userId, access.project.id));
  });

  app.delete<P>('/projects/:projectId', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    if (access.orgRole !== 'owner' && access.orgRole !== 'admin') throw forbidden('Only workspace owners and admins can delete projects.');
    await db.update(projects).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(projects.id, access.project.id));
    return { ok: true };
  });

  app.get<P>('/projects/:projectId/dashboard', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    return computeDashboard(db, access, today(req.query));
  });

  app.get<P>('/projects/:projectId/report', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    return computeReport(db, access, today(req.query));
  });

  app.get<P>('/projects/:projectId/report.pdf', async (req, reply) => {
    const access = await projectAccess(req, req.params.projectId);
    assertFeature(access.org, 'pdfReports', 'PDF reports');
    const report = await computeReport(db, access, today(req.query));
    const pdf = await renderReportPdf(report, { branded: access.plan === 'business', orgName: access.org.name });
    reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="${slug(access.project.name)}-report-${report.generatedAt.slice(0, 10)}.pdf"`)
      .header('Cache-Control', 'no-store');
    return reply.send(pdf);
  });

  app.get<{ Params: { projectId: string; key: string } }>('/projects/:projectId/export/:key', async (req, reply) => {
    const access = await projectAccess(req, req.params.projectId);
    assertFeature(access.org, 'csvExport', 'CSV exports');
    const key = req.params.key.replace(/\.csv$/, '');
    const { filename, csv } = await buildExport(db, access.project.id, key);
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${slug(access.project.name)}-${filename}"`)
      .header('Cache-Control', 'no-store');
    return reply.send(csv);
  });

  app.get<P>('/projects/:projectId/activity', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    const before = Number(req.query.before) || undefined;
    const limit = Number(req.query.limit) || 50;
    const entityId = req.query.entityId && /^[0-9a-f-]{36}$/i.test(req.query.entityId) ? req.query.entityId : undefined;
    return listActivity(db, access.project.id, { before, limit, entityId });
  });
}
