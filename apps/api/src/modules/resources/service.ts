import { randomUUID } from 'node:crypto';
import { listQuerySchema } from '@brickledger/shared';
import { and, count, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { DB, Executor } from '../../db/client';
import type { TokenService } from '../../lib/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { Storage } from '../../lib/storage';
import { isIsoDate, isUuid } from '../../lib/util';
import { parse } from '../../lib/validate';
import { logActivity } from '../activity';
import { requireRole, type ProjectAccess } from '../projects/access';
import type { ResourceDef } from './registry';

type Row = Record<string, any>;

export interface ServiceCtx {
  db: DB;
  tokens: TokenService;
  storage: Storage;
}

const nextSeq = sql`nextval('sync_seq')`;

/** Public shape of a row: storage internals stripped, signed URL added for files. */
export function serializeRow(def: ResourceDef, row: Row, tokens: TokenService): Row {
  if (def.key !== 'files') return row;
  const { storageKey: _omit, ...rest } = row;
  return { ...rest, url: tokens.signFileUrl(row.id) };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listRows(ctx: ServiceCtx, def: ResourceDef, projectId: string, query: Record<string, unknown>) {
  const q = parse(listQuerySchema, query);
  const table = def.table;
  const conds: (SQL | undefined)[] = [eq(table.projectId, projectId), isNull(table.deletedAt)];

  for (const [param, filter] of Object.entries(def.filters ?? {})) {
    const raw = query[param];
    if (raw === undefined || raw === '') continue;
    const value = String(raw);
    if (filter.type === 'uuid') {
      if (value === 'none') conds.push(isNull(filter.column));
      else if (isUuid(value)) conds.push(eq(filter.column, value));
      else return { items: [], total: 0, sum: 0 };
    } else if (filter.type === 'bool') {
      conds.push(eq(filter.column, value === 'true'));
    } else if (filter.type === 'date') {
      if (!isIsoDate(value)) throw badRequest(`${param} must be a yyyy-mm-dd date`);
      conds.push(eq(filter.column, value));
    } else {
      conds.push(eq(filter.column, value));
    }
  }
  if (q.q && def.search?.length) {
    const pattern = `%${escapeLike(q.q)}%`;
    conds.push(or(...def.search.map((c) => ilike(c, pattern))));
  }
  if (def.dateColumn && q.from) conds.push(gte(def.dateColumn, q.from));
  if (def.dateColumn && q.to) conds.push(lte(def.dateColumn, q.to));

  const where = and(...conds);
  const [agg] = await ctx.db
    .select({
      n: count(),
      sum: def.sumColumn ? sql<number>`coalesce(sum(${def.sumColumn}), 0)`.mapWith(Number) : sql<number>`0`.mapWith(Number),
    })
    .from(table)
    .where(where);
  const rows: Row[] = await ctx.db
    .select()
    .from(table)
    .where(where)
    .orderBy(...def.orderBy)
    .limit(q.limit ?? 1000)
    .offset(q.offset ?? 0);
  return { items: rows.map((r) => serializeRow(def, r, ctx.tokens)), total: agg?.n ?? 0, sum: agg?.sum ?? 0 };
}

export async function findRow(db: Executor, def: ResourceDef, projectId: string, id: string, includeDeleted = false): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const conds = [eq(def.table.id, id), eq(def.table.projectId, projectId)];
  if (!includeDeleted) conds.push(isNull(def.table.deletedAt));
  const [row] = await db.select().from(def.table).where(and(...conds)).limit(1);
  return row ?? null;
}

interface WriteOptions {
  /** Skip the activity entry (bulk operations log one summary instead). */
  quiet?: boolean;
}

export interface WriteResult {
  row: Row;
  /** Set when the change was merged into an existing record with a different id. */
  canonicalId?: string;
}

async function describe(db: Executor, def: ResourceDef, access: ProjectAccess, row: Row) {
  try {
    return await def.describe(row, { db, currency: access.project.currency });
  } catch {
    return def.noun;
  }
}

export async function createRow(db: Executor, def: ResourceDef, access: ProjectAccess, input: unknown, opts: WriteOptions = {}): Promise<WriteResult> {
  requireRole(access, def.writeRole, `add a ${def.noun}`);
  if (!def.creatable) throw badRequest(`Use the upload endpoint to add a ${def.noun}.`);
  let data: Row = parse(def.schema, input);
  data = def.prepare?.(data, null) ?? data;

  if (def.findDuplicate) {
    const dup = await def.findDuplicate(db, access.project.id, data);
    if (dup) {
      const { id: _drop, ...changes } = data;
      const result = await updateRow(db, def, access, dup.id, changes, opts);
      return { row: result.row, canonicalId: dup.id };
    }
  }

  const id = typeof data.id === 'string' ? data.id : randomUUID();
  const existing = await db.select({ id: def.table.id }).from(def.table).where(eq(def.table.id, id)).limit(1);
  if (existing.length) throw conflict(`A ${def.noun} with this id already exists.`);

  const inserted = (await db
    .insert(def.table)
    .values({ ...data, id, projectId: access.project.id, createdBy: access.userId, updatedBy: access.userId })
    .returning()) as Row[];
  const row = inserted[0]!;
  if (!opts.quiet) {
    await logActivity(db, {
      projectId: access.project.id,
      userId: access.userId,
      action: 'create',
      entityType: def.key,
      entityId: id,
      summary: `Added ${await describe(db, def, access, row)}`,
    });
  }
  return { row };
}

export async function updateRow(db: Executor, def: ResourceDef, access: ProjectAccess, id: string, input: unknown, opts: WriteOptions = {}): Promise<WriteResult> {
  requireRole(access, def.writeRole, `edit a ${def.noun}`);
  const existing = await findRow(db, def, access.project.id, id);
  if (!existing) throw notFound(capitalize(def.noun));
  let data: Row = parse(def.schema.partial(), input);
  delete data.id;
  data = def.prepare?.(data, existing) ?? data;

  if (def.findDuplicate && Object.keys(data).some((k) => k === 'workerId' || k === 'date')) {
    const dup = await def.findDuplicate(db, access.project.id, { ...existing, ...data }, id);
    if (dup) throw conflict(`Another ${def.noun} already exists for that day.`);
  }

  const [row] = await db
    .update(def.table)
    .set({ ...data, updatedBy: access.userId, updatedAt: new Date(), serverSeq: nextSeq })
    .where(eq(def.table.id, id))
    .returning();
  if (!opts.quiet) {
    await logActivity(db, {
      projectId: access.project.id,
      userId: access.userId,
      action: 'update',
      entityType: def.key,
      entityId: id,
      summary: `Updated ${await describe(db, def, access, row)}`,
    });
  }
  return { row };
}

export async function deleteRow(ctx: ServiceCtx, db: Executor, def: ResourceDef, access: ProjectAccess, id: string, opts: WriteOptions = {}): Promise<void> {
  requireRole(access, def.writeRole, `delete a ${def.noun}`);
  const existing = await findRow(db, def, access.project.id, id);
  if (!existing) throw notFound(capitalize(def.noun));
  if (access.role !== 'manager' && existing.createdBy !== access.userId) {
    throw forbidden('Contributors can only delete entries they added. Ask a project manager.');
  }
  await db
    .update(def.table)
    .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: access.userId, serverSeq: nextSeq })
    .where(eq(def.table.id, id));
  if (def.key === 'files' && existing.storageKey) {
    await ctx.storage.delete(existing.storageKey).catch(() => undefined);
  }
  if (!opts.quiet) {
    await logActivity(db, {
      projectId: access.project.id,
      userId: access.userId,
      action: 'delete',
      entityType: def.key,
      entityId: id,
      summary: `Deleted ${await describe(db, def, access, existing)}`,
    });
  }
}

/**
 * Offline-sync upsert. Records are keyed by client-generated UUIDs, so replays are
 * idempotent. Last write received wins; a record deleted on the server stays deleted.
 */
export async function syncUpsert(db: Executor, def: ResourceDef, access: ProjectAccess, id: string, data: Row, opts: WriteOptions = {}): Promise<WriteResult | null> {
  const existing = await findRow(db, def, access.project.id, id, true);
  if (existing?.deletedAt) return null;
  if (existing) return updateRow(db, def, access, id, data, opts);
  return createRow(db, def, access, { ...data, id }, opts);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
