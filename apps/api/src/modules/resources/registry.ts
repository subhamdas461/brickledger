import {
  AttendanceStatuses,
  FundSources,
  IssueSeverities,
  MovementTypes,
  PhaseStatuses,
  WorkerTrades,
  attendanceSchema,
  categorySchema,
  expenseSchema,
  fileSchema,
  formatDate,
  formatMoney,
  formatNumber,
  fundSchema,
  issueSchema,
  logSchema,
  materialSchema,
  movementSchema,
  phaseSchema,
  taskSchema,
  vendorSchema,
  workerSchema,
  type ProjectRole,
  type ResourceKey,
} from '@brickledger/shared';
import { and, asc, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { Executor } from '../../db/client';
import * as t from '../../db/schema';
import { utcToday } from '../../lib/util';

type Row = Record<string, any>;

export interface DescribeCtx {
  db: Executor;
  currency: string;
}

export interface FilterDef {
  column: PgColumn;
  type: 'uuid' | 'text' | 'bool' | 'date';
}

export interface ResourceDef {
  key: ResourceKey;
  /** Singular noun used in messages ("expense"). */
  noun: string;
  table: any;
  schema: z.ZodObject<any>;
  /** Minimum role to create/update. Deleting additionally requires ownership for contributors. */
  writeRole: ProjectRole;
  /** False for files (created through the upload endpoint). */
  creatable: boolean;
  orderBy: SQL[];
  search?: PgColumn[];
  dateColumn?: PgColumn;
  sumColumn?: PgColumn;
  filters?: Record<string, FilterDef>;
  describe(row: Row, ctx: DescribeCtx): string | Promise<string>;
  /** Derives server-managed fields (completedAt, resolvedAt...) from the incoming change. */
  prepare?(data: Row, existing: Row | null): Row;
  /** Natural-key duplicate (e.g. one attendance record per worker per day). */
  findDuplicate?(db: Executor, projectId: string, data: Row, excludeId?: string): Promise<Row | null>;
}

const money = (ctx: DescribeCtx, n: number) => formatMoney(n, ctx.currency);

async function nameOf(db: Executor, table: any, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [row] = await db.select({ name: table.name }).from(table).where(eq(table.id, id)).limit(1);
  return (row?.name as string | undefined) ?? null;
}

function stampStatus(data: Row, existing: Row | null, statusValue: string, field: string): Row {
  if (data.status === undefined) return data;
  if (data.status === statusValue) {
    return existing?.[field] ? data : { ...data, [field]: new Date() };
  }
  return { ...data, [field]: null };
}

export const RESOURCES: Record<ResourceKey, ResourceDef> = {
  categories: {
    key: 'categories',
    noun: 'budget category',
    table: t.categories,
    schema: categorySchema,
    writeRole: 'manager',
    creatable: true,
    orderBy: [asc(t.categories.sortOrder), asc(t.categories.createdAt)],
    search: [t.categories.name],
    describe: (r, ctx) => `budget category "${r.name}" (${money(ctx, r.plannedAmount ?? 0)} planned)`,
  },

  phases: {
    key: 'phases',
    noun: 'phase',
    table: t.phases,
    schema: phaseSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [asc(t.phases.sortOrder), asc(t.phases.createdAt)],
    search: [t.phases.name],
    filters: { status: { column: t.phases.status, type: 'text' } },
    describe: (r) => `phase "${r.name}" - ${PhaseStatuses.label(r.status)}, ${r.progress ?? 0}%`,
    prepare(data, existing) {
      const next = { ...data };
      const today = utcToday();
      if (next.status === 'completed' && next.progress === undefined) next.progress = 100;
      if (next.progress === 100 && next.status === undefined) next.status = 'completed';
      if (next.progress !== undefined && next.progress > 0 && next.progress < 100 && (next.status ?? existing?.status ?? 'not_started') === 'not_started') {
        next.status = 'in_progress';
      }
      const status = next.status ?? existing?.status;
      if ((status === 'in_progress' || status === 'completed') && !(next.actualStart ?? existing?.actualStart)) next.actualStart = today;
      if (status === 'completed' && !(next.actualEnd ?? existing?.actualEnd)) next.actualEnd = today;
      return next;
    },
  },

  vendors: {
    key: 'vendors',
    noun: 'vendor',
    table: t.vendors,
    schema: vendorSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [asc(t.vendors.name)],
    search: [t.vendors.name, t.vendors.contactPerson, t.vendors.phone],
    filters: { type: { column: t.vendors.type, type: 'text' } },
    describe: (r) => `vendor ${r.name}`,
  },

  materials: {
    key: 'materials',
    noun: 'material',
    table: t.materials,
    schema: materialSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [asc(t.materials.name)],
    search: [t.materials.name],
    filters: { category: { column: t.materials.category, type: 'text' } },
    describe: (r) => `material ${r.name} (${r.unit})`,
  },

  workers: {
    key: 'workers',
    noun: 'worker',
    table: t.workers,
    schema: workerSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [desc(t.workers.active), asc(t.workers.name)],
    search: [t.workers.name, t.workers.phone],
    filters: {
      trade: { column: t.workers.trade, type: 'text' },
      active: { column: t.workers.active, type: 'bool' },
      vendorId: { column: t.workers.vendorId, type: 'uuid' },
    },
    describe: (r, ctx) => `worker ${r.name} (${WorkerTrades.label(r.trade)}, ${money(ctx, r.dailyWage ?? 0)}/day)`,
  },

  expenses: {
    key: 'expenses',
    noun: 'expense',
    table: t.expenses,
    schema: expenseSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [desc(t.expenses.date), desc(t.expenses.createdAt)],
    search: [t.expenses.title, t.expenses.reference, t.expenses.notes, t.expenses.paidBy],
    dateColumn: t.expenses.date,
    sumColumn: t.expenses.amount,
    filters: {
      categoryId: { column: t.expenses.categoryId, type: 'uuid' },
      vendorId: { column: t.expenses.vendorId, type: 'uuid' },
      phaseId: { column: t.expenses.phaseId, type: 'uuid' },
      workerId: { column: t.expenses.workerId, type: 'uuid' },
      status: { column: t.expenses.status, type: 'text' },
      paymentMode: { column: t.expenses.paymentMode, type: 'text' },
    },
    describe: (r, ctx) => `${money(ctx, r.amount)} · ${r.title}${r.status === 'due' ? ' (due)' : ''}`,
    prepare(data) {
      // A paid expense has no due date; keep the data consistent for reports.
      if (data.status === 'paid' && data.dueDate === undefined) return { ...data, dueDate: null };
      return data;
    },
  },

  movements: {
    key: 'movements',
    noun: 'stock entry',
    table: t.movements,
    schema: movementSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [desc(t.movements.date), desc(t.movements.createdAt)],
    dateColumn: t.movements.date,
    search: [t.movements.notes],
    filters: {
      materialId: { column: t.movements.materialId, type: 'uuid' },
      type: { column: t.movements.type, type: 'text' },
      vendorId: { column: t.movements.vendorId, type: 'uuid' },
    },
    async describe(r, ctx) {
      const [m] = await ctx.db.select({ name: t.materials.name, unit: t.materials.unit }).from(t.materials).where(eq(t.materials.id, r.materialId)).limit(1);
      return `${MovementTypes.label(r.type).toLowerCase()} ${formatNumber(r.quantity)} ${m?.unit ?? ''} of ${m?.name ?? 'material'}`.replace(/\s+/g, ' ');
    },
  },

  attendance: {
    key: 'attendance',
    noun: 'attendance record',
    table: t.attendance,
    schema: attendanceSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [desc(t.attendance.date), asc(t.attendance.createdAt)],
    dateColumn: t.attendance.date,
    filters: {
      workerId: { column: t.attendance.workerId, type: 'uuid' },
      date: { column: t.attendance.date, type: 'date' },
      status: { column: t.attendance.status, type: 'text' },
    },
    async describe(r, ctx) {
      const worker = await nameOf(ctx.db, t.workers, r.workerId);
      return `attendance: ${worker ?? 'worker'} ${AttendanceStatuses.label(r.status).toLowerCase()} on ${formatDate(r.date)}`;
    },
    async findDuplicate(db, projectId, data, excludeId) {
      if (!data.workerId || !data.date) return null;
      const conds = [
        eq(t.attendance.projectId, projectId),
        eq(t.attendance.workerId, data.workerId),
        eq(t.attendance.date, data.date),
        isNull(t.attendance.deletedAt),
      ];
      if (excludeId) conds.push(ne(t.attendance.id, excludeId));
      const [row] = await db.select().from(t.attendance).where(and(...conds)).limit(1);
      return row ?? null;
    },
  },

  tasks: {
    key: 'tasks',
    noun: 'task',
    table: t.tasks,
    schema: taskSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [sql`${t.tasks.dueDate} asc nulls last`, desc(t.tasks.createdAt)],
    search: [t.tasks.title, t.tasks.assignee],
    filters: {
      status: { column: t.tasks.status, type: 'text' },
      priority: { column: t.tasks.priority, type: 'text' },
      phaseId: { column: t.tasks.phaseId, type: 'uuid' },
    },
    describe: (r) => `task "${r.title}"${r.status === 'done' ? ' (done)' : ''}`,
    prepare: (data, existing) => stampStatus(data, existing, 'done', 'completedAt'),
  },

  logs: {
    key: 'logs',
    noun: 'diary entry',
    table: t.dailyLogs,
    schema: logSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [desc(t.dailyLogs.date), desc(t.dailyLogs.createdAt)],
    search: [t.dailyLogs.workDone, t.dailyLogs.issues, t.dailyLogs.notes],
    dateColumn: t.dailyLogs.date,
    describe: (r) => `site diary for ${formatDate(r.date)}`,
  },

  funds: {
    key: 'funds',
    noun: 'fund entry',
    table: t.funds,
    schema: fundSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [desc(t.funds.date), desc(t.funds.createdAt)],
    search: [t.funds.description, t.funds.reference],
    dateColumn: t.funds.date,
    sumColumn: t.funds.amount,
    filters: { source: { column: t.funds.source, type: 'text' } },
    describe: (r, ctx) => `funds ${money(ctx, r.amount)} from ${r.description || FundSources.label(r.source)}`,
  },

  issues: {
    key: 'issues',
    noun: 'issue',
    table: t.issues,
    schema: issueSchema,
    writeRole: 'contributor',
    creatable: true,
    orderBy: [sql`case ${t.issues.status} when 'resolved' then 1 else 0 end`, desc(t.issues.createdAt)],
    search: [t.issues.title, t.issues.assignee],
    filters: {
      status: { column: t.issues.status, type: 'text' },
      severity: { column: t.issues.severity, type: 'text' },
      phaseId: { column: t.issues.phaseId, type: 'uuid' },
    },
    describe: (r) => `issue "${r.title}" (${IssueSeverities.label(r.severity)})${r.status === 'resolved' ? ' - resolved' : ''}`,
    prepare: (data, existing) => stampStatus(data, existing, 'resolved', 'resolvedAt'),
  },

  files: {
    key: 'files',
    noun: 'file',
    table: t.files,
    schema: fileSchema,
    writeRole: 'contributor',
    creatable: false,
    orderBy: [desc(t.files.createdAt)],
    search: [t.files.name, t.files.fileName],
    filters: {
      category: { column: t.files.category, type: 'text' },
      entityType: { column: t.files.entityType, type: 'text' },
      entityId: { column: t.files.entityId, type: 'uuid' },
    },
    describe: (r) => `file "${r.name}"`,
  },
};

export function getResource(key: string): ResourceDef | null {
  return (RESOURCES as Record<string, ResourceDef>)[key] ?? null;
}
