import {
  addDaysIso,
  daysBetween,
  formatDate,
  formatMoney,
  formatNumber,
  wageFor,
  type Alert,
  type CategoryBreakdown,
  type Dashboard,
  type LabourSummary,
  type MaterialStock,
  type MonthlyPoint,
  type ProjectReport,
  type ProjectTotals,
  type VendorBalance,
} from '@brickledger/shared';
import { and, asc, desc, eq, getTableColumns, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import * as t from '../../db/schema';
import { toProjectDetail, type ProjectAccess } from '../projects/access';

const num = (expr: SQL) => sql<number>`coalesce(${expr}, 0)`.mapWith(Number);
const cnt = (expr: SQL) => sql<number>`${expr}`.mapWith(Number);

function live(table: any, projectId: string) {
  return and(eq(table.projectId, projectId), isNull(table.deletedAt));
}

async function expenseTotals(db: Executor, pid: string, today: string) {
  const e = t.expenses;
  const soon = addDaysIso(today, 7);
  const [row] = await db
    .select({
      spent: num(sql`sum(${e.amount}) filter (where ${e.status} = 'paid')`),
      due: num(sql`sum(${e.amount}) filter (where ${e.status} = 'due')`),
      overdue: num(sql`sum(${e.amount}) filter (where ${e.status} = 'due' and ${e.dueDate} < ${today}::date)`),
      overdueCount: cnt(sql`count(*) filter (where ${e.status} = 'due' and ${e.dueDate} < ${today}::date)`),
      dueSoon: num(sql`sum(${e.amount}) filter (where ${e.status} = 'due' and ${e.dueDate} >= ${today}::date and ${e.dueDate} <= ${soon}::date)`),
      dueSoonCount: cnt(sql`count(*) filter (where ${e.status} = 'due' and ${e.dueDate} >= ${today}::date and ${e.dueDate} <= ${soon}::date)`),
      labourPaid: num(sql`sum(${e.amount}) filter (where ${e.status} = 'paid' and ${e.workerId} is not null)`),
    })
    .from(e)
    .where(live(e, pid));
  return row!;
}

export async function categoryBreakdown(db: Executor, pid: string): Promise<CategoryBreakdown[]> {
  const c = t.categories;
  const e = t.expenses;
  const cats = await db
    .select({ id: c.id, name: c.name, icon: c.icon, planned: c.plannedAmount })
    .from(c)
    .where(live(c, pid))
    .orderBy(asc(c.sortOrder), asc(c.createdAt));
  const sums = await db
    .select({
      categoryId: e.categoryId,
      spent: num(sql`sum(${e.amount}) filter (where ${e.status} = 'paid')`),
      due: num(sql`sum(${e.amount}) filter (where ${e.status} = 'due')`),
    })
    .from(e)
    .where(live(e, pid))
    .groupBy(e.categoryId);
  const byCat = new Map(sums.map((s) => [s.categoryId, s]));
  const known = new Set(cats.map((k) => k.id));
  const rows: CategoryBreakdown[] = cats.map((k) => ({
    id: k.id,
    name: k.name,
    icon: k.icon,
    planned: k.planned,
    spent: byCat.get(k.id)?.spent ?? 0,
    due: byCat.get(k.id)?.due ?? 0,
  }));
  const orphan = sums.filter((s) => !s.categoryId || !known.has(s.categoryId));
  if (orphan.length) {
    rows.push({
      id: null,
      name: 'Uncategorised',
      icon: null,
      planned: 0,
      spent: orphan.reduce((a, s) => a + s.spent, 0),
      due: orphan.reduce((a, s) => a + s.due, 0),
    });
  }
  return rows;
}

export async function monthlySpend(db: Executor, pid: string, startDate: string | null, today: string): Promise<MonthlyPoint[]> {
  const e = t.expenses;
  const rows = await db
    .select({ month: sql<string>`to_char(${e.date}, 'YYYY-MM')`, amount: num(sql`sum(${e.amount})`) })
    .from(e)
    .where(and(live(e, pid), eq(e.status, 'paid')))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const map = new Map(rows.map((r) => [r.month, r.amount]));
  const candidates = [rows[0]?.month, startDate?.slice(0, 7)].filter(Boolean) as string[];
  const endMonth = [today.slice(0, 7), rows[rows.length - 1]?.month ?? ''].sort().pop()!;
  let start = candidates.sort()[0] ?? endMonth;
  // Show at most the last 24 months, and at least the last 6.
  const monthsBack = (ym: string, n: number) => {
    const [y, m] = ym.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 - n, 1));
    return d.toISOString().slice(0, 7);
  };
  if (start < monthsBack(endMonth, 23)) start = monthsBack(endMonth, 23);
  if (start > monthsBack(endMonth, 5)) start = monthsBack(endMonth, 5);
  const out: MonthlyPoint[] = [];
  let cur = start;
  for (let i = 0; i < 24 && cur <= endMonth; i++) {
    out.push({ month: cur, amount: map.get(cur) ?? 0 });
    const [y, m] = cur.split('-').map(Number) as [number, number];
    cur = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }
  return out;
}

export async function vendorBalances(db: Executor, pid: string): Promise<VendorBalance[]> {
  const v = t.vendors;
  const e = t.expenses;
  const rows = await db
    .select({
      id: v.id,
      name: v.name,
      type: v.type,
      phone: v.phone,
      contractAmount: v.contractAmount,
      paid: num(sql`sum(${e.amount}) filter (where ${e.status} = 'paid')`),
      due: num(sql`sum(${e.amount}) filter (where ${e.status} = 'due')`),
    })
    .from(v)
    .leftJoin(e, and(eq(e.vendorId, v.id), eq(e.projectId, v.projectId), isNull(e.deletedAt)))
    .where(live(v, pid))
    .groupBy(v.id);
  return rows
    .map((r) => ({ ...r, balance: r.contractAmount != null ? r.contractAmount - r.paid : null }))
    .sort((a, b) => b.paid + b.due - (a.paid + a.due) || a.name.localeCompare(b.name));
}

export async function materialStock(db: Executor, pid: string): Promise<MaterialStock[]> {
  const m = t.materials;
  const mv = t.movements;
  const rows = await db
    .select({
      id: m.id,
      name: m.name,
      unit: m.unit,
      category: m.category,
      minStock: m.minStock,
      estimatedQty: m.estimatedQty,
      received: num(sql`sum(${mv.quantity}) filter (where ${mv.type} = 'in')`),
      used: num(sql`sum(${mv.quantity}) filter (where ${mv.type} = 'out')`),
      value: num(sql`sum(${mv.quantity} * ${mv.rate}) filter (where ${mv.type} = 'in' and ${mv.rate} is not null)`),
      ratedQty: num(sql`sum(${mv.quantity}) filter (where ${mv.type} = 'in' and ${mv.rate} is not null)`),
    })
    .from(m)
    .leftJoin(mv, and(eq(mv.materialId, m.id), eq(mv.projectId, m.projectId), isNull(mv.deletedAt)))
    .where(live(m, pid))
    .groupBy(m.id)
    .orderBy(asc(m.name));
  return rows.map(({ ratedQty, ...r }) => ({
    ...r,
    stock: Math.round((r.received - r.used) * 1000) / 1000,
    value: Math.round(r.value * 100) / 100,
    avgRate: ratedQty > 0 ? Math.round((r.value / ratedQty) * 100) / 100 : null,
  }));
}

export async function labourSummary(db: Executor, pid: string): Promise<LabourSummary[]> {
  const w = t.workers;
  const a = t.attendance;
  const e = t.expenses;
  const rows = await db
    .select({
      workerId: w.id,
      name: w.name,
      trade: w.trade,
      dailyWage: w.dailyWage,
      active: w.active,
      presentDays: cnt(sql`count(${a.id}) filter (where ${a.status} = 'present')`),
      halfDays: cnt(sql`count(${a.id}) filter (where ${a.status} = 'half')`),
      overtimeHours: num(sql`sum(${a.overtimeHours})`),
    })
    .from(w)
    .leftJoin(a, and(eq(a.workerId, w.id), eq(a.projectId, w.projectId), isNull(a.deletedAt)))
    .where(live(w, pid))
    .groupBy(w.id)
    .orderBy(desc(w.active), asc(w.name));
  const paidRows = await db
    .select({ workerId: e.workerId, paid: num(sql`sum(${e.amount})`) })
    .from(e)
    .where(and(live(e, pid), eq(e.status, 'paid'), sql`${e.workerId} is not null`))
    .groupBy(e.workerId);
  const paid = new Map(paidRows.map((p) => [p.workerId, p.paid]));
  return rows.map((r) => {
    const earned =
      wageFor('present', 0, r.dailyWage) * r.presentDays + wageFor('half', 0, r.dailyWage) * r.halfDays + wageFor('absent', r.overtimeHours, r.dailyWage);
    const p = paid.get(r.workerId) ?? 0;
    return { ...r, earned: Math.round(earned * 100) / 100, paid: p, balance: Math.round((earned - p) * 100) / 100 };
  });
}

async function phaseList(db: Executor, pid: string) {
  const p = t.phases;
  return db
    .select({ id: p.id, name: p.name, status: p.status, progress: p.progress, plannedStart: p.plannedStart, plannedEnd: p.plannedEnd })
    .from(p)
    .where(live(p, pid))
    .orderBy(asc(p.sortOrder), asc(p.createdAt));
}

async function fundsBySource(db: Executor, pid: string) {
  const f = t.funds;
  const rows = await db.select({ source: f.source, amount: num(sql`sum(${f.amount})`) }).from(f).where(live(f, pid)).groupBy(f.source);
  return rows.sort((a, b) => b.amount - a.amount);
}

async function paymentModes(db: Executor, pid: string) {
  const e = t.expenses;
  const rows = await db
    .select({ mode: e.paymentMode, amount: num(sql`sum(${e.amount})`) })
    .from(e)
    .where(and(live(e, pid), eq(e.status, 'paid')))
    .groupBy(e.paymentMode);
  return rows.sort((a, b) => b.amount - a.amount);
}

function buildTotals(
  access: ProjectAccess,
  today: string,
  ex: Awaited<ReturnType<typeof expenseTotals>>,
  categories: CategoryBreakdown[],
  funds: number,
  labour: LabourSummary[],
  materials: MaterialStock[],
  phases: { progress: number }[],
): ProjectTotals {
  const p = access.project;
  const budget = p.totalBudget > 0 ? p.totalBudget : categories.reduce((s, c) => s + c.planned, 0);
  const committed = ex.spent + ex.due;
  const progress = phases.length ? Math.round(phases.reduce((s, ph) => s + ph.progress, 0) / phases.length) : 0;
  return {
    budget,
    spent: ex.spent,
    due: ex.due,
    overdue: ex.overdue,
    committed,
    remaining: budget - committed,
    fundsReceived: funds,
    cashInHand: funds - ex.spent,
    labourEarned: Math.round(labour.reduce((s, l) => s + l.earned, 0)),
    labourPaid: ex.labourPaid,
    materialsValue: Math.round(materials.reduce((s, m) => s + m.value, 0)),
    costPerArea: p.builtUpArea && p.builtUpArea > 0 ? Math.round(committed / p.builtUpArea) : null,
    progress,
    daysElapsed: p.startDate ? Math.max(0, daysBetween(p.startDate, today)) : null,
    daysTotal: p.startDate && p.targetEndDate ? Math.max(0, daysBetween(p.startDate, p.targetEndDate)) : null,
  };
}

const SEVERITY_RANK: Record<Alert['severity'], number> = { critical: 0, serious: 1, warning: 2, info: 3 };

export async function computeDashboard(db: Executor, access: ProjectAccess, today: string): Promise<Dashboard> {
  const pid = access.project.id;
  const cur = access.project.currency;
  const money = (n: number) => formatMoney(n, cur);

  const [ex, categories, monthly, phases, funds, labour, materials] = await Promise.all([
    expenseTotals(db, pid, today),
    categoryBreakdown(db, pid),
    monthlySpend(db, pid, access.project.startDate, today),
    phaseList(db, pid),
    fundsBySource(db, pid),
    labourSummary(db, pid),
    materialStock(db, pid),
  ]);
  const totals = buildTotals(access, today, ex, categories, funds.reduce((s, f) => s + f.amount, 0), labour, materials, phases);

  const e = t.expenses;
  const recentExpenses = await db
    .select({ ...getTableColumns(e), categoryName: t.categories.name, vendorName: t.vendors.name })
    .from(e)
    .leftJoin(t.categories, eq(t.categories.id, e.categoryId))
    .leftJoin(t.vendors, eq(t.vendors.id, e.vendorId))
    .where(live(e, pid))
    .orderBy(desc(e.date), desc(e.createdAt))
    .limit(6);

  const tk = t.tasks;
  const [taskCounts] = await db
    .select({
      open: cnt(sql`count(*) filter (where ${tk.status} <> 'done')`),
      overdue: cnt(sql`count(*) filter (where ${tk.status} <> 'done' and ${tk.dueDate} < ${today}::date)`),
    })
    .from(tk)
    .where(live(tk, pid));
  const overdueTasks = await db
    .select({ id: tk.id, title: tk.title, dueDate: tk.dueDate })
    .from(tk)
    .where(and(live(tk, pid), sql`${tk.status} <> 'done' and ${tk.dueDate} < ${today}::date`))
    .orderBy(asc(tk.dueDate))
    .limit(3);

  const is = t.issues;
  const [issueCounts] = await db
    .select({
      open: cnt(sql`count(*) filter (where ${is.status} <> 'resolved')`),
      critical: cnt(sql`count(*) filter (where ${is.status} <> 'resolved' and ${is.severity} = 'critical')`),
    })
    .from(is)
    .where(live(is, pid));

  const [presentToday] = await db
    .select({ n: cnt(sql`count(*)`) })
    .from(t.attendance)
    .where(and(live(t.attendance, pid), eq(t.attendance.date, today), sql`${t.attendance.status} in ('present', 'half')`));
  const [vendorCount] = await db.select({ n: cnt(sql`count(*)`) }).from(t.vendors).where(live(t.vendors, pid));

  const f = t.files;
  const expiring = await db
    .select({ id: f.id, name: f.name, expiresOn: f.expiresOn })
    .from(f)
    .where(and(live(f, pid), sql`${f.expiresOn} between ${today}::date and ${addDaysIso(today, 30)}::date`))
    .orderBy(asc(f.expiresOn))
    .limit(3);

  // ------------------------------------------------------------ alerts
  const alerts: Alert[] = [];
  if (totals.budget > 0 && totals.committed > totals.budget) {
    alerts.push({
      kind: 'over_budget',
      severity: 'critical',
      title: `Over budget by ${money(totals.committed - totals.budget)}`,
      detail: `Committed ${money(totals.committed)} against a budget of ${money(totals.budget)}.`,
    });
  }
  if (ex.overdueCount > 0) {
    alerts.push({
      kind: 'overdue_payment',
      severity: 'critical',
      title: `${ex.overdueCount} overdue payment${ex.overdueCount === 1 ? '' : 's'} · ${money(ex.overdue)}`,
      detail: 'Bills past their due date.',
      entityType: 'expenses',
    });
  }
  if (issueCounts && issueCounts.critical > 0) {
    alerts.push({ kind: 'critical_issue', severity: 'critical', title: `${issueCounts.critical} critical issue${issueCounts.critical === 1 ? '' : 's'} open`, entityType: 'issues' });
  }
  for (const c of categories) {
    if (c.planned > 0 && c.spent + c.due > c.planned * 1.0001) {
      alerts.push({
        kind: 'category_over_budget',
        severity: 'serious',
        title: `${c.name} at ${Math.round(((c.spent + c.due) / c.planned) * 100)}% of plan`,
        detail: `${money(c.spent + c.due)} committed of ${money(c.planned)} planned.`,
        entityType: 'categories',
        entityId: c.id ?? undefined,
      });
    }
  }
  for (const task of overdueTasks) {
    alerts.push({ kind: 'overdue_task', severity: 'serious', title: `Overdue: ${task.title}`, detail: `Was due ${formatDate(task.dueDate)}.`, entityType: 'tasks', entityId: task.id });
  }
  if (ex.dueSoonCount > 0) {
    alerts.push({
      kind: 'payment_due_soon',
      severity: 'warning',
      title: `${ex.dueSoonCount} payment${ex.dueSoonCount === 1 ? '' : 's'} due this week · ${money(ex.dueSoon)}`,
      entityType: 'expenses',
    });
  }
  const lowStock = materials.filter((m) => m.minStock != null && m.minStock > 0 && m.stock < m.minStock);
  for (const m of lowStock.slice(0, 4)) {
    alerts.push({
      kind: 'low_stock',
      severity: 'warning',
      title: `Low stock: ${m.name}`,
      detail: `${formatNumber(m.stock)} ${m.unit} left (minimum ${formatNumber(m.minStock ?? 0)}).`,
      entityType: 'materials',
      entityId: m.id,
    });
  }
  for (const doc of expiring) {
    alerts.push({ kind: 'document_expiring', severity: 'warning', title: `${doc.name} expires ${formatDate(doc.expiresOn)}`, entityType: 'files', entityId: doc.id });
  }
  alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    project: toProjectDetail(access),
    totals,
    categories,
    monthly,
    phases,
    recentExpenses: recentExpenses as unknown as Dashboard['recentExpenses'],
    alerts: alerts.slice(0, 12),
    counts: {
      openTasks: taskCounts?.open ?? 0,
      overdueTasks: taskCounts?.overdue ?? 0,
      openIssues: issueCounts?.open ?? 0,
      criticalIssues: issueCounts?.critical ?? 0,
      activeWorkers: labour.filter((l) => l.active).length,
      presentToday: presentToday?.n ?? 0,
      lowStock: lowStock.length,
      vendors: vendorCount?.n ?? 0,
    },
  };
}

export async function computeReport(db: Executor, access: ProjectAccess, today: string): Promise<ProjectReport> {
  const pid = access.project.id;
  const [ex, categories, monthly, phases, funds, labour, materials, vendors, modes] = await Promise.all([
    expenseTotals(db, pid, today),
    categoryBreakdown(db, pid),
    monthlySpend(db, pid, access.project.startDate, today),
    phaseList(db, pid),
    fundsBySource(db, pid),
    labourSummary(db, pid),
    materialStock(db, pid),
    vendorBalances(db, pid),
    paymentModes(db, pid),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    project: toProjectDetail(access),
    totals: buildTotals(access, today, ex, categories, funds.reduce((s, f) => s + f.amount, 0), labour, materials, phases),
    categories,
    monthly,
    vendors,
    materials,
    labour,
    paymentModes: modes,
    funds,
  };
}
