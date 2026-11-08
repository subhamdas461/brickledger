import {
  AttendanceStatuses,
  ExpenseStatuses,
  FundSources,
  IssueSeverities,
  IssueStatuses,
  MaterialCategories,
  PaymentModes,
  Priorities,
  TaskStatuses,
  VendorTypes,
  Weathers,
  WorkerTrades,
  wageFor,
} from '@brickledger/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import * as t from '../../db/schema';
import { badRequest } from '../../lib/errors';
import { categoryBreakdown, labourSummary, materialStock, vendorBalances } from '../analytics/queries';

type Cell = string | number | null | undefined;

/** RFC 4180 CSV with a BOM (so Excel reads UTF-8) and formula-injection guarding. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export const EXPORTABLE = ['expenses', 'budget', 'vendors', 'materials', 'stock', 'labour', 'attendance', 'funds', 'tasks', 'issues', 'logs'] as const;
export type ExportKey = (typeof EXPORTABLE)[number];

async function nameMap(db: Executor, table: any, pid: string): Promise<Map<string, string>> {
  const rows: { id: string; name: string }[] = await db.select({ id: table.id, name: table.name }).from(table).where(eq(table.projectId, pid));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const live = (table: any, pid: string) => and(eq(table.projectId, pid), isNull(table.deletedAt));

export async function buildExport(db: Executor, pid: string, key: string): Promise<{ filename: string; csv: string }> {
  switch (key as ExportKey) {
    case 'expenses': {
      const [cats, phases, vendors, workers] = await Promise.all([
        nameMap(db, t.categories, pid),
        nameMap(db, t.phases, pid),
        nameMap(db, t.vendors, pid),
        nameMap(db, t.workers, pid),
      ]);
      const rows = await db.select().from(t.expenses).where(live(t.expenses, pid)).orderBy(desc(t.expenses.date), desc(t.expenses.createdAt));
      return {
        filename: 'expenses.csv',
        csv: toCsv(
          ['Date', 'Title', 'Category', 'Phase', 'Vendor', 'Worker', 'Amount', 'Status', 'Due date', 'Payment mode', 'Reference', 'Quantity', 'Unit', 'Rate', 'Tax', 'Paid by', 'Notes'],
          rows.map((r) => [
            r.date, r.title, cats.get(r.categoryId ?? '') ?? '', phases.get(r.phaseId ?? '') ?? '', vendors.get(r.vendorId ?? '') ?? '',
            workers.get(r.workerId ?? '') ?? '', r.amount, ExpenseStatuses.label(r.status), r.dueDate, PaymentModes.label(r.paymentMode),
            r.reference, r.quantity, r.unit, r.rate, r.taxAmount, r.paidBy, r.notes,
          ]),
        ),
      };
    }
    case 'budget': {
      const rows = await categoryBreakdown(db, pid);
      return {
        filename: 'budget-vs-actual.csv',
        csv: toCsv(
          ['Category', 'Planned', 'Spent', 'Due', 'Remaining', 'Used %'],
          rows.map((c) => [c.name, c.planned, c.spent, c.due, c.planned - c.spent - c.due, c.planned > 0 ? Math.round(((c.spent + c.due) / c.planned) * 100) : null]),
        ),
      };
    }
    case 'vendors': {
      const rows = await vendorBalances(db, pid);
      return {
        filename: 'vendors.csv',
        csv: toCsv(
          ['Vendor', 'Type', 'Phone', 'Contract amount', 'Paid', 'Due', 'Balance to pay'],
          rows.map((v) => [v.name, VendorTypes.label(v.type), v.phone, v.contractAmount, v.paid, v.due, v.balance]),
        ),
      };
    }
    case 'materials': {
      const rows = await materialStock(db, pid);
      return {
        filename: 'materials-stock.csv',
        csv: toCsv(
          ['Material', 'Category', 'Unit', 'Received', 'Used', 'In stock', 'Avg rate', 'Purchase value', 'Minimum stock', 'Estimated total'],
          rows.map((m) => [m.name, MaterialCategories.label(m.category), m.unit, m.received, m.used, m.stock, m.avgRate, m.value, m.minStock, m.estimatedQty]),
        ),
      };
    }
    case 'stock': {
      const [materials, vendors] = await Promise.all([nameMap(db, t.materials, pid), nameMap(db, t.vendors, pid)]);
      const rows = await db.select().from(t.movements).where(live(t.movements, pid)).orderBy(desc(t.movements.date));
      return {
        filename: 'stock-movements.csv',
        csv: toCsv(
          ['Date', 'Material', 'Type', 'Quantity', 'Rate', 'Vendor', 'Notes'],
          rows.map((m) => [m.date, materials.get(m.materialId) ?? '', m.type === 'in' ? 'Received' : 'Used', m.quantity, m.rate, vendors.get(m.vendorId ?? '') ?? '', m.notes]),
        ),
      };
    }
    case 'labour': {
      const rows = await labourSummary(db, pid);
      return {
        filename: 'labour-summary.csv',
        csv: toCsv(
          ['Worker', 'Trade', 'Daily wage', 'Present days', 'Half days', 'Overtime hours', 'Earned', 'Paid', 'Balance'],
          rows.map((l) => [l.name, WorkerTrades.label(l.trade), l.dailyWage, l.presentDays, l.halfDays, l.overtimeHours, l.earned, l.paid, l.balance]),
        ),
      };
    }
    case 'attendance': {
      const workers = await db.select().from(t.workers).where(eq(t.workers.projectId, pid));
      const byId = new Map(workers.map((w) => [w.id, w]));
      const rows = await db.select().from(t.attendance).where(live(t.attendance, pid)).orderBy(desc(t.attendance.date), asc(t.attendance.workerId));
      return {
        filename: 'attendance.csv',
        csv: toCsv(
          ['Date', 'Worker', 'Trade', 'Status', 'Overtime hours', 'Wage'],
          rows.map((a) => {
            const w = byId.get(a.workerId);
            return [a.date, w?.name ?? '', WorkerTrades.label(w?.trade), AttendanceStatuses.label(a.status), a.overtimeHours, Math.round(wageFor(a.status, a.overtimeHours, w?.dailyWage ?? 0) * 100) / 100];
          }),
        ),
      };
    }
    case 'funds': {
      const rows = await db.select().from(t.funds).where(live(t.funds, pid)).orderBy(desc(t.funds.date));
      return {
        filename: 'funds.csv',
        csv: toCsv(['Date', 'Source', 'Description', 'Amount', 'Reference', 'Notes'], rows.map((f) => [f.date, FundSources.label(f.source), f.description, f.amount, f.reference, f.notes])),
      };
    }
    case 'tasks': {
      const phases = await nameMap(db, t.phases, pid);
      const rows = await db.select().from(t.tasks).where(live(t.tasks, pid)).orderBy(asc(t.tasks.dueDate));
      return {
        filename: 'tasks.csv',
        csv: toCsv(
          ['Task', 'Status', 'Priority', 'Assignee', 'Due date', 'Phase', 'Completed at', 'Description'],
          rows.map((r) => [r.title, TaskStatuses.label(r.status), Priorities.label(r.priority), r.assignee, r.dueDate, phases.get(r.phaseId ?? '') ?? '', r.completedAt?.toISOString().slice(0, 10), r.description]),
        ),
      };
    }
    case 'issues': {
      const rows = await db.select().from(t.issues).where(live(t.issues, pid)).orderBy(desc(t.issues.createdAt));
      return {
        filename: 'issues.csv',
        csv: toCsv(
          ['Issue', 'Severity', 'Status', 'Assignee', 'Due date', 'Reported', 'Resolved', 'Description'],
          rows.map((r) => [r.title, IssueSeverities.label(r.severity), IssueStatuses.label(r.status), r.assignee, r.dueDate, r.createdAt.toISOString().slice(0, 10), r.resolvedAt?.toISOString().slice(0, 10), r.description]),
        ),
      };
    }
    case 'logs': {
      const rows = await db.select().from(t.dailyLogs).where(live(t.dailyLogs, pid)).orderBy(desc(t.dailyLogs.date));
      return {
        filename: 'site-diary.csv',
        csv: toCsv(['Date', 'Weather', 'Work done', 'Labour count', 'Issues', 'Notes'], rows.map((r) => [r.date, Weathers.label(r.weather), r.workDone, r.labourCount, r.issues, r.notes])),
      };
    }
    default:
      throw badRequest(`Unknown export "${key}". Available: ${EXPORTABLE.join(', ')}`);
  }
}
