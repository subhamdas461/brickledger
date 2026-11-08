import { bulkAttendanceSchema, formatDate } from '@brickledger/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { workers } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { logActivity } from '../activity';
import { projectAccess, requireRole } from '../projects/access';
import { RESOURCES } from './registry';
import { createRow, deleteRow, findRow, listRows, serializeRow, updateRow, type ServiceCtx } from './service';

type P = { Params: { projectId: string; id: string }; Querystring: Record<string, string> };

export async function resourceRoutes(app: FastifyInstance) {
  const { db, tokens, storage } = app.ctx;
  const ctx: ServiceCtx = { db, tokens, storage };

  for (const def of Object.values(RESOURCES)) {
    const base = `/projects/:projectId/${def.key}`;

    app.get<P>(base, async (req) => {
      await projectAccess(req, req.params.projectId);
      return listRows(ctx, def, req.params.projectId, req.query ?? {});
    });

    app.get<P>(`${base}/:id`, async (req) => {
      await projectAccess(req, req.params.projectId);
      const row = await findRow(db, def, req.params.projectId, req.params.id);
      if (!row) throw notFound(def.noun);
      return serializeRow(def, row, tokens);
    });

    if (def.creatable) {
      app.post<P>(base, async (req, reply) => {
        const access = await projectAccess(req, req.params.projectId);
        const result = await db.transaction((tx) => createRow(tx, def, access, req.body));
        reply.code(result.canonicalId ? 200 : 201);
        return serializeRow(def, result.row, tokens);
      });
    }

    app.patch<P>(`${base}/:id`, async (req) => {
      const access = await projectAccess(req, req.params.projectId);
      const result = await db.transaction((tx) => updateRow(tx, def, access, req.params.id, req.body));
      return serializeRow(def, result.row, tokens);
    });

    app.delete<P>(`${base}/:id`, async (req) => {
      const access = await projectAccess(req, req.params.projectId);
      await db.transaction((tx) => deleteRow(ctx, tx, def, access, req.params.id));
      return { ok: true };
    });
  }

  /** Mark a whole day's attendance in one request (web attendance sheet). */
  app.post<P>('/projects/:projectId/attendance/bulk', async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'contributor', 'mark attendance');
    const input = parse(bulkAttendanceSchema, req.body);
    const ids = [...new Set(input.entries.map((e) => e.workerId))];
    if (ids.length) {
      const found = await db
        .select({ id: workers.id })
        .from(workers)
        .where(and(eq(workers.projectId, access.project.id), inArray(workers.id, ids), isNull(workers.deletedAt)));
      if (found.length !== ids.length) throw badRequest('One or more workers do not belong to this project.');
    }
    const def = RESOURCES.attendance;
    await db.transaction(async (tx) => {
      for (const e of input.entries) {
        const data = { workerId: e.workerId, date: input.date, status: e.status, overtimeHours: e.overtimeHours ?? 0 };
        const dup = await def.findDuplicate!(tx, access.project.id, data);
        if (dup) await updateRow(tx, def, access, dup.id, { status: e.status, overtimeHours: data.overtimeHours }, { quiet: true });
        else await createRow(tx, def, access, data, { quiet: true });
      }
      if (input.entries.length) {
        const present = input.entries.filter((e) => e.status === 'present').length;
        const half = input.entries.filter((e) => e.status === 'half').length;
        await logActivity(tx, {
          projectId: access.project.id,
          userId: access.userId,
          action: 'update',
          entityType: 'attendance',
          summary: `Marked attendance for ${formatDate(input.date)}: ${present} present${half ? `, ${half} half-day` : ''}, ${input.entries.length - present - half} absent`,
        });
      }
    });
    return listRows(ctx, def, access.project.id, { date: input.date });
  });
}
