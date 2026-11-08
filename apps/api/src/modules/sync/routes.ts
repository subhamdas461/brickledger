import { RESOURCE_KEYS, formatDate, syncPushSchema, type ResourceKey, type SyncPullResponse, type SyncPushResponse, type SyncPushResult } from '@brickledger/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { logActivity } from '../activity';
import { projectAccess, requireRole, toProjectDetail } from '../projects/access';
import { RESOURCES, getResource } from '../resources/registry';
import { deleteRow, findRow, serializeRow, syncUpsert, type ServiceCtx } from '../resources/service';

const ORDER = new Map<string, number>(RESOURCE_KEYS.map((k, i) => [k, i]));

/**
 * Offline-first sync protocol used by the Android app.
 *
 *   GET  /projects/:id/sync?since=<cursor>  -> changes with server_seq > cursor (incl. tombstones)
 *   POST /projects/:id/sync                 -> batch of upserts/deletes keyed by client UUIDs
 *
 * Clients push first, then pull until hasMore is false, storing the returned cursor.
 */
export async function syncRoutes(app: FastifyInstance) {
  const { db, tokens, storage } = app.ctx;
  const ctx: ServiceCtx = { db, tokens, storage };

  app.get<{ Params: { projectId: string }; Querystring: { since?: string; limit?: string } }>('/projects/:projectId/sync', async (req): Promise<SyncPullResponse> => {
    const access = await projectAccess(req, req.params.projectId);
    const since = Math.max(0, Number(req.query.since) || 0);
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));

    const perTable = await Promise.all(
      RESOURCE_KEYS.map(async (key) => {
        const def = RESOURCES[key];
        const rows: Record<string, any>[] = await db
          .select()
          .from(def.table)
          .where(and(eq(def.table.projectId, access.project.id), gt(def.table.serverSeq, since)))
          .orderBy(asc(def.table.serverSeq))
          .limit(limit + 1);
        return rows.map((row) => ({ key, row }));
      }),
    );
    // Each table contributes its `limit + 1` oldest changes, so the globally oldest `limit` are all present.
    const all = perTable.flat().sort((a, b) => a.row.serverSeq - b.row.serverSeq);
    const page = all.slice(0, limit);
    const changes: Partial<Record<ResourceKey, unknown[]>> = {};
    for (const { key, row } of page) (changes[key] ??= []).push(serializeRow(RESOURCES[key], row, tokens));
    return {
      cursor: page.length ? page[page.length - 1]!.row.serverSeq : since,
      hasMore: all.length > limit,
      project: toProjectDetail(access),
      changes,
    };
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/sync', async (req): Promise<SyncPushResponse> => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'contributor', 'make changes');
    const input = parse(syncPushSchema, req.body);

    // Referenced entities first (categories before expenses...), deletes after upserts.
    const mutations = [...input.mutations].sort(
      (a, b) => (ORDER.get(a.entity) ?? 99) - (ORDER.get(b.entity) ?? 99) || Number(a.op === 'delete') - Number(b.op === 'delete'),
    );

    const results: SyncPushResult[] = [];
    const attendanceDays = new Map<string, number>();
    for (const m of mutations) {
      const def = getResource(m.entity);
      if (!def) {
        results.push({ id: m.id, entity: m.entity, status: 'error', error: `Unknown entity "${m.entity}"`, retryable: false });
        continue;
      }
      const quiet = def.key === 'attendance';
      try {
        const outcome = await db.transaction(async (tx) => {
          if (m.op === 'delete') {
            const existing = await findRow(tx, def, access.project.id, m.id);
            if (existing) await deleteRow(ctx, tx, def, access, m.id, { quiet });
            return null;
          }
          return syncUpsert(tx, def, access, m.id, m.data ?? {}, { quiet });
        });
        if (def.key === 'attendance' && m.op === 'upsert' && typeof m.data?.date === 'string') {
          attendanceDays.set(m.data.date, (attendanceDays.get(m.data.date) ?? 0) + 1);
        }
        const result: SyncPushResult = { id: m.id, entity: m.entity, status: 'ok' };
        if (outcome?.canonicalId && outcome.canonicalId !== m.id) result.canonicalId = outcome.canonicalId;
        results.push(result);
      } catch (err) {
        const known = err instanceof AppError;
        if (!known) req.log.error({ err, entity: m.entity, id: m.id }, 'sync mutation failed');
        results.push({
          id: m.id,
          entity: m.entity,
          status: 'error',
          error: known ? err.message : 'Unexpected server error',
          retryable: !known || err.status >= 500,
        });
      }
    }

    for (const [date, n] of attendanceDays) {
      await logActivity(db, {
        projectId: access.project.id,
        userId: access.userId,
        action: 'update',
        entityType: 'attendance',
        summary: `Updated attendance for ${n} worker${n === 1 ? '' : 's'} on ${formatDate(date)}`,
      });
    }
    return { results };
  });
}
