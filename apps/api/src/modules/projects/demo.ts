import { addDaysIso, daysBetween } from '@brickledger/shared';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import * as t from '../../db/schema';
import { utcToday } from '../../lib/util';
import { logActivity } from '../activity';
import { seedProjectTemplates } from './templates';

/** Rough INR -> currency factors so the sample project looks plausible in any currency. */
const SCALE: Record<string, number> = {
  INR: 1, USD: 1 / 85, EUR: 1 / 95, GBP: 1 / 110, AED: 1 / 23, SAR: 1 / 22.5, QAR: 1 / 23, AUD: 1 / 55, CAD: 1 / 62,
  NZD: 1 / 50, SGD: 1 / 64, MYR: 1 / 19, NPR: 1.6, LKR: 3.5, BDT: 1.4, PKR: 3.3, ZAR: 1 / 4.7, NGN: 18, KES: 1.5, PHP: 1 / 1.5,
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a realistic, fully populated sample project (~5 months into a 12-month
 * G+1 villa build) so new users and sales demos can explore every screen.
 */
export async function createDemoProject(db: DB, opts: { orgId: string; userId: string; currency: string }): Promise<string> {
  const scale = SCALE[opts.currency] ?? 1 / 80;
  const amt = (inr: number) => {
    const v = inr * scale;
    return v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
  };
  const rate = (inr: number) => Math.round(inr * scale * 100) / 100;
  const rnd = mulberry32(20240611);
  const pick = <T,>(items: T[]) => items[Math.floor(rnd() * items.length)]!;

  const today = utcToday();
  const start = addDaysIso(today, -150);
  const end = addDaysIso(today, 215);
  const day = (offset: number) => addDaysIso(start, offset);
  const budget = amt(5_000_000);
  const by = { createdBy: opts.userId, updatedBy: opts.userId };

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(t.projects)
      .values({
        orgId: opts.orgId,
        name: 'Sample: G+1 Villa, Whitefield',
        description: '3BHK duplex with terrace garden. Explore this sample to see how BrickLedger tracks a real build - delete it anytime.',
        address: 'Plot 42, Green Meadows Layout',
        city: 'Bengaluru',
        status: 'in_progress',
        currency: opts.currency,
        totalBudget: budget,
        plotArea: 1200,
        builtUpArea: 2400,
        areaUnit: 'sqft',
        floors: 2,
        startDate: start,
        targetEndDate: end,
        isDemo: true,
        createdBy: opts.userId,
      })
      .returning();
    const pid = project!.id;
    const base = { ...by, projectId: pid };
    await tx.insert(t.projectMembers).values({ projectId: pid, userId: opts.userId, role: 'manager', addedBy: opts.userId });

    const seeded = await seedProjectTemplates(tx, { projectId: pid, userId: opts.userId, budget, startDate: start, targetEndDate: end });
    const cat = (name: string) => seeded.categories.find((c) => c.name.startsWith(name))!.id;
    const mat = (name: string) => seeded.materials.find((m) => m.name.startsWith(name))!;

    // Phase progress consistent with the timeline.
    for (const ph of seeded.phases) {
      if (!ph.plannedStart || !ph.plannedEnd) continue;
      let status = 'not_started';
      let progress = 0;
      if (ph.plannedEnd < today) {
        status = 'completed';
        progress = 100;
      } else if (ph.plannedStart <= today) {
        status = 'in_progress';
        const span = Math.max(1, daysBetween(ph.plannedStart, ph.plannedEnd));
        progress = Math.min(90, Math.max(10, Math.round((daysBetween(ph.plannedStart, today) / span) * 100)));
      }
      await tx
        .update(t.phases)
        .set({
          status,
          progress,
          actualStart: status === 'not_started' ? null : ph.plannedStart,
          actualEnd: status === 'completed' ? ph.plannedEnd : null,
        })
        .where(eq(t.phases.id, ph.id));
    }
    const phaseAt = (offset: number) => {
      const d = day(offset);
      return seeded.phases.find((p) => p.plannedStart && p.plannedEnd && p.plannedStart <= d && d <= p.plannedEnd)?.id ?? null;
    };

    // Material targets & alert thresholds.
    const minStock: Record<string, [number, number]> = {
      Cement: [50, 1300],
      TMT: [500, 9500],
      Sand: [200, 3500],
      Aggregate: [100, 2400],
      Bricks: [1500, 30000],
    };
    for (const [prefix, [min, estimate]] of Object.entries(minStock)) {
      await tx.update(t.materials).set({ minStock: min, estimatedQty: estimate }).where(eq(t.materials.id, mat(prefix).id));
    }

    const vendorRows = await tx
      .insert(t.vendors)
      .values([
        { ...base, name: 'Sri Balaji Cement Traders', type: 'supplier', contactPerson: 'Venkatesh', phone: '+91 98450 11223', taxId: '29ABCDE1234F1Z5' },
        { ...base, name: 'Kaveri Steel & TMT', type: 'supplier', contactPerson: 'Imran', phone: '+91 98860 44556' },
        { ...base, name: 'Shree Sand & Aggregates', type: 'supplier', phone: '+91 99000 77889' },
        { ...base, name: 'Ramesh Kumar (Mason gang)', type: 'labour_contractor', phone: '+91 97411 22334', contractAmount: amt(650_000), notes: 'Labour contract for masonry & plastering, paid in running bills.' },
        { ...base, name: 'AquaFlow Plumbing Works', type: 'contractor', phone: '+91 96320 55667', contractAmount: amt(210_000) },
        { ...base, name: 'BrightSpark Electricals', type: 'contractor', phone: '+91 95910 88990', contractAmount: amt(240_000) },
        { ...base, name: 'Design Studio Arc', type: 'consultant', contactPerson: 'Ar. Meera Rao', email: 'studio@example.com', contractAmount: amt(180_000) },
      ])
      .returning();
    const vendor = (prefix: string) => vendorRows.find((v) => v.name.startsWith(prefix))!.id;

    const workerRows = await tx
      .insert(t.workers)
      .values([
        { ...base, name: 'Ravi Shankar', trade: 'mason', dailyWage: amt(1100), vendorId: vendor('Ramesh'), phone: '+91 90080 11111' },
        { ...base, name: 'Manjunath', trade: 'mason', dailyWage: amt(1050), vendorId: vendor('Ramesh') },
        { ...base, name: 'Lakshmi', trade: 'helper', dailyWage: amt(650), vendorId: vendor('Ramesh') },
        { ...base, name: 'Suresh', trade: 'helper', dailyWage: amt(650), vendorId: vendor('Ramesh') },
        { ...base, name: 'Ganesh', trade: 'bar_bender', dailyWage: amt(950) },
        { ...base, name: 'Prakash', trade: 'carpenter', dailyWage: amt(1000) },
        { ...base, name: 'Shivu', trade: 'helper', dailyWage: amt(600) },
        { ...base, name: 'Anil', trade: 'supervisor', dailyWage: amt(1200), active: true },
      ])
      .returning();

    // Attendance for the last 24 days (Sundays off).
    const attendanceRows: (typeof t.attendance.$inferInsert)[] = [];
    for (let back = 24; back >= 0; back--) {
      const d = addDaysIso(today, -back);
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue;
      for (const w of workerRows) {
        const r = rnd();
        const status = r < 0.82 ? 'present' : r < 0.92 ? 'half' : 'absent';
        const overtimeHours = status === 'present' && rnd() < 0.15 ? 2 : 0;
        attendanceRows.push({ ...base, workerId: w.id, date: d, status, overtimeHours });
      }
    }
    await tx.insert(t.attendance).values(attendanceRows);

    // Expenses + stock.
    type ExpenseInsert = typeof t.expenses.$inferInsert;
    const expenseRows: ExpenseInsert[] = [];
    const movementRows: (typeof t.movements.$inferInsert)[] = [];
    const add = (e: Omit<ExpenseInsert, 'projectId'>) => {
      const id = crypto.randomUUID();
      expenseRows.push({ ...base, ...e, id, phaseId: e.phaseId ?? phaseAt(daysBetween(start, e.date as string)) });
      return id;
    };

    add({ date: day(2), title: 'Architect fee - concept & approvals drawings', amount: amt(60_000), categoryId: cat('Design'), vendorId: vendor('Design'), paymentMode: 'bank_transfer', reference: 'INV-DSA-101' });
    add({ date: day(5), title: 'Plan sanction & BBMP approval fees', amount: amt(85_000), categoryId: cat('Permits'), paymentMode: 'bank_transfer', reference: 'CHALLAN 55821' });
    add({ date: day(6), title: 'Soil test report', amount: amt(12_000), categoryId: cat('Design'), paymentMode: 'upi' });
    add({ date: day(10), title: 'Bhoomi pooja & site cleaning', amount: amt(18_500), categoryId: cat('Miscellaneous'), paymentMode: 'cash', paidBy: 'Self' });
    add({ date: day(12), title: 'JCB excavation - 26 hours', amount: amt(41_600), categoryId: cat('Excavation'), paymentMode: 'cash', quantity: 26, unit: 'hours', rate: rate(1600) });
    add({ date: day(40), title: 'Architect fee - structural drawings', amount: amt(60_000), categoryId: cat('Design'), vendorId: vendor('Design'), paymentMode: 'bank_transfer', reference: 'INV-DSA-117' });
    add({ date: day(28), title: 'Anti-termite treatment', amount: amt(14_000), categoryId: cat('Excavation'), paymentMode: 'upi' });
    add({ date: day(45), title: 'Water tanker supply (month)', amount: amt(9_600), categoryId: cat('Miscellaneous'), paymentMode: 'cash' });
    add({ date: day(75), title: 'Water tanker supply (month)', amount: amt(10_400), categoryId: cat('Miscellaneous'), paymentMode: 'cash' });
    add({ date: day(105), title: 'Water tanker supply (month)', amount: amt(11_200), categoryId: cat('Miscellaneous'), paymentMode: 'cash' });
    add({ date: day(60), title: 'Shuttering material rent', amount: amt(48_000), categoryId: cat('RCC'), paymentMode: 'upi' });
    add({ date: day(95), title: 'Ready-mix concrete M25 - ground floor slab', amount: amt(171_500), categoryId: cat('RCC'), paymentMode: 'bank_transfer', quantity: 28, unit: 'cum', rate: rate(6125) });
    add({ date: day(132), title: 'Ready-mix concrete M25 - first floor slab', amount: amt(163_800), categoryId: cat('RCC'), paymentMode: 'bank_transfer', quantity: 26, unit: 'cum', rate: rate(6300) });

    // Contractor running bills.
    add({ date: day(50), title: 'Mason contract - running bill 1', amount: amt(120_000), categoryId: cat('Labour'), vendorId: vendor('Ramesh'), paymentMode: 'bank_transfer', reference: 'RB-1' });
    add({ date: day(90), title: 'Mason contract - running bill 2', amount: amt(135_000), categoryId: cat('Labour'), vendorId: vendor('Ramesh'), paymentMode: 'bank_transfer', reference: 'RB-2' });
    add({ date: day(130), title: 'Mason contract - running bill 3', amount: amt(110_000), categoryId: cat('Labour'), vendorId: vendor('Ramesh'), paymentMode: 'bank_transfer', reference: 'RB-3' });
    add({ date: day(118), title: 'Electrical conduits & boxes - rough-in advance', amount: amt(60_000), categoryId: cat('Electrical'), vendorId: vendor('BrightSpark'), paymentMode: 'upi' });
    add({ date: day(122), title: 'Plumbing rough-in advance', amount: amt(55_000), categoryId: cat('Plumbing'), vendorId: vendor('AquaFlow'), paymentMode: 'upi' });

    // Bills not yet paid: one overdue, one due this week, one later.
    add({ date: day(138), title: 'Concealed plumbing - CPVC pipes & fittings', amount: amt(38_500), categoryId: cat('Plumbing'), vendorId: vendor('AquaFlow'), status: 'due', dueDate: addDaysIso(today, -3), paymentMode: 'bank_transfer', reference: 'AQF-2291' });
    add({ date: day(144), title: 'Wiring - FR cables (first lot)', amount: amt(46_000), categoryId: cat('Electrical'), vendorId: vendor('BrightSpark'), status: 'due', dueDate: addDaysIso(today, 4), paymentMode: 'bank_transfer', reference: 'BSE-0912' });
    add({ date: day(146), title: 'Architect fee - interior drawings', amount: amt(60_000), categoryId: cat('Design'), vendorId: vendor('Design'), status: 'due', dueDate: addDaysIso(today, 20), paymentMode: 'bank_transfer' });

    // Material purchases (expense + stock in) and consumption (stock out).
    const purchases: [string, string, number, number, string, number][] = [
      // material prefix, vendor prefix, quantity, INR rate, category prefix, day offset
      ['Cement', 'Sri Balaji', 250, 410, 'Excavation', 22],
      ['TMT', 'Kaveri', 2500, 68, 'RCC', 25],
      ['Sand', 'Shree', 900, 55, 'Excavation', 24],
      ['Aggregate', 'Shree', 900, 48, 'Excavation', 24],
      ['Cement', 'Sri Balaji', 350, 415, 'RCC', 58],
      ['TMT', 'Kaveri', 3500, 69, 'RCC', 62],
      ['Bricks', 'Shree', 12000, 9, 'Masonry', 70],
      ['Sand', 'Shree', 1000, 56, 'Masonry', 72],
      ['Aggregate', 'Shree', 1000, 49, 'Excavation', 88],
      ['Cement', 'Sri Balaji', 300, 420, 'Masonry', 100],
      ['Bricks', 'Shree', 13000, 9.2, 'Masonry', 108],
      ['TMT', 'Kaveri', 2000, 70, 'RCC', 115],
      ['Cement', 'Sri Balaji', 250, 420, 'Masonry', 135],
      ['Sand', 'Shree', 700, 57, 'Masonry', 140],
    ];
    for (const [m, v, qty, inrRate, c, offset] of purchases) {
      const material = mat(m);
      const unitRate = rate(inrRate);
      const expenseId = add({
        date: day(offset),
        title: `${material.name} - ${qty.toLocaleString('en-IN')} ${material.unit}`,
        amount: Math.round(qty * unitRate),
        categoryId: cat(c),
        vendorId: vendor(v),
        paymentMode: pick(['bank_transfer', 'upi', 'cheque']),
        quantity: qty,
        unit: material.unit,
        rate: unitRate,
        reference: `BILL-${1000 + offset}`,
      });
      movementRows.push({ ...base, materialId: material.id, type: 'in', quantity: qty, rate: unitRate, date: day(offset), vendorId: vendor(v), expenseId });
    }
    const usage: [string, number, number][] = [
      ['Cement', 220, 40], ['TMT', 2300, 45], ['Sand', 800, 46], ['Aggregate', 850, 47],
      ['Cement', 330, 80], ['TMT', 3300, 85], ['Sand', 900, 86], ['Aggregate', 900, 96],
      ['Bricks', 11000, 98], ['Cement', 300, 120], ['Bricks', 12000, 125], ['TMT', 1800, 133], ['Sand', 600, 136], ['Cement', 260, 145],
    ];
    for (const [m, qty, offset] of usage) {
      movementRows.push({ ...base, materialId: mat(m).id, type: 'out', quantity: qty, date: day(offset), phaseId: phaseAt(offset) });
    }

    // Weekly wage settlements for directly hired workers.
    for (let week = 0; week < 4; week++) {
      for (const w of workerRows.filter((x) => !x.vendorId)) {
        add({
          date: addDaysIso(today, -(week * 7 + 1)),
          title: `Weekly wages - ${w.name}`,
          amount: Math.round(w.dailyWage * 5.5),
          categoryId: cat('Labour'),
          workerId: w.id,
          paymentMode: pick(['cash', 'upi']),
          paidBy: 'Site supervisor',
        });
      }
    }

    await tx.insert(t.expenses).values(expenseRows);
    await tx.insert(t.movements).values(movementRows);

    await tx.insert(t.funds).values([
      { ...base, date: day(0), source: 'savings', description: 'Own savings - FD closure', amount: amt(1_500_000), reference: 'FD 0042' },
      { ...base, date: day(42), source: 'home_loan', description: 'SBI home loan - tranche 1', amount: amt(1_000_000), reference: 'HL-77821' },
      { ...base, date: day(84), source: 'family', description: 'From parents', amount: amt(200_000) },
      { ...base, date: day(110), source: 'home_loan', description: 'SBI home loan - tranche 2', amount: amt(800_000), reference: 'HL-77821' },
    ]);

    await tx.insert(t.tasks).values([
      { ...base, title: 'Finalise tiles for living & dining', priority: 'high', status: 'in_progress', assignee: 'Self', dueDate: addDaysIso(today, 6) },
      { ...base, title: 'Book RMC for staircase headroom slab', priority: 'urgent', status: 'todo', assignee: 'Anil', dueDate: addDaysIso(today, 2) },
      { ...base, title: 'Get 3 quotes for UPVC windows', priority: 'medium', status: 'todo', assignee: 'Self', dueDate: addDaysIso(today, -2) },
      { ...base, title: 'Curing - first floor slab (14 days)', priority: 'high', status: 'in_progress', assignee: 'Ravi', dueDate: addDaysIso(today, 5) },
      { ...base, title: 'Electrical point layout walkthrough', priority: 'medium', status: 'todo', assignee: 'BrightSpark', dueDate: addDaysIso(today, 9) },
      { ...base, title: 'Apply for temporary power connection', priority: 'low', status: 'done', assignee: 'Self', dueDate: day(20), completedAt: new Date(`${day(18)}T10:00:00Z`) },
      { ...base, title: 'Termite treatment certificate', priority: 'low', status: 'done', dueDate: day(30), completedAt: new Date(`${day(29)}T10:00:00Z`) },
      { ...base, title: 'Sump & septic tank waterproofing', priority: 'medium', status: 'blocked', assignee: 'AquaFlow', dueDate: addDaysIso(today, -6), description: 'Waiting for waterproofing chemical delivery.' },
    ]);

    const weathers = ['sunny', 'sunny', 'cloudy', 'rainy', 'hot'];
    const works = [
      'Brickwork for first floor external walls - east side',
      'Column casting for terrace staircase headroom',
      'Curing of first floor slab, de-shuttering ground floor',
      'Conduit laying in first floor walls',
      'Plastering inside ground floor bedrooms',
      'Lintel shuttering & reinforcement at first floor',
      'Brickwork - first floor bedroom partitions',
      'Material received: cement & sand. Unloading and stacking',
      'Sump waterproofing prep, site cleaning',
      'Concealed plumbing lines for ground floor bathrooms',
    ];
    await tx.insert(t.dailyLogs).values(
      works.map((w, i) => ({
        ...base,
        date: addDaysIso(today, -i),
        weather: pick(weathers),
        workDone: w,
        labourCount: 6 + Math.floor(rnd() * 5),
        issues: i === 3 ? 'Shortage of 12mm bars - ordered from Kaveri Steel.' : i === 6 ? 'Rain stopped work for 2 hours in the afternoon.' : null,
      })),
    );

    await tx.insert(t.issues).values([
      { ...base, title: 'Honeycombing in first-floor column C4', description: 'Visible voids after de-shuttering. Engineer to inspect and suggest grouting.', severity: 'high', status: 'open', assignee: 'Ramesh Kumar', dueDate: addDaysIso(today, 3) },
      { ...base, title: 'Wrong window frame size delivered for bedroom 2', severity: 'medium', status: 'in_progress', assignee: 'Self' },
      { ...base, title: 'Water seepage near sump', severity: 'medium', status: 'resolved', resolvedAt: new Date(`${addDaysIso(today, -12)}T10:00:00Z`) },
    ]);

    await logActivity(tx, { projectId: pid, userId: opts.userId, action: 'create', entityType: 'projects', entityId: pid, summary: 'Created the sample project' });
    return pid;
  });
}
