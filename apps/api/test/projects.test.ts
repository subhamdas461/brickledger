import { DEFAULT_CATEGORIES, DEFAULT_MATERIALS, DEFAULT_PHASES } from '@brickledger/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { organizations } from '../src/db/schema';
import { addMember, buildTestApp, call, createProject, registerUser, type TestApp, type TestUser } from './helpers';

let t: TestApp;
let owner: TestUser;
let projectId: string;
const api = (path: string) => `/api/v1/projects/${projectId}${path}`;

beforeAll(async () => {
  t = await buildTestApp();
  owner = await registerUser(t.app, 'Owner');
  projectId = (await createProject(t.app, owner)).id;
});
afterAll(async () => t.close());

describe('projects', () => {
  it('seeds budget categories, phases and materials from templates', async () => {
    const cats = await call(t.app, { method: 'GET', url: api('/categories'), headers: owner.headers });
    const phases = await call(t.app, { method: 'GET', url: api('/phases'), headers: owner.headers });
    const materials = await call(t.app, { method: 'GET', url: api('/materials'), headers: owner.headers });
    expect(cats.items).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(phases.items).toHaveLength(DEFAULT_PHASES.length);
    expect(materials.items).toHaveLength(DEFAULT_MATERIALS.length);
    const planned = cats.items.reduce((s: number, c: any) => s + c.plannedAmount, 0);
    expect(planned).toBe(1_000_000);
    expect(phases.items[0].plannedStart).toBe('2026-01-01');
    expect(phases.items.at(-1).plannedEnd).toBe('2026-12-31');
  });

  it('records expenses and reflects them in the list, dashboard and project stats', async () => {
    const cats = await call(t.app, { method: 'GET', url: api('/categories'), headers: owner.headers });
    const rcc = cats.items.find((c: any) => c.name === 'RCC structure');
    const vendor = await call(t.app, { method: 'POST', url: api('/vendors'), headers: owner.headers, payload: { name: 'Kaveri Steel', type: 'supplier', contractAmount: 300000 }, expect: 201 });
    await call(t.app, {
      method: 'POST',
      url: api('/expenses'),
      headers: owner.headers,
      payload: { date: '2026-03-02', title: 'TMT bars 2 ton', amount: 140000, categoryId: rcc.id, vendorId: vendor.id, paymentMode: 'bank_transfer', quantity: 2000, unit: 'kg', rate: 70 },
      expect: 201,
    });
    await call(t.app, {
      method: 'POST',
      url: api('/expenses'),
      headers: owner.headers,
      payload: { date: '2026-03-05', title: 'Steel balance bill', amount: 60000, categoryId: rcc.id, vendorId: vendor.id, status: 'due', dueDate: '2026-03-01' },
      expect: 201,
    });

    const list = await call(t.app, { method: 'GET', url: api('/expenses?q=steel'), headers: owner.headers });
    expect(list.total).toBe(1);
    const all = await call(t.app, { method: 'GET', url: api(`/expenses?vendorId=${vendor.id}`), headers: owner.headers });
    expect(all.sum).toBe(200000);

    const dash = await call(t.app, { method: 'GET', url: api('/dashboard?today=2026-03-10'), headers: owner.headers });
    expect(dash.totals).toMatchObject({ budget: 1_000_000, spent: 140000, due: 60000, overdue: 60000, committed: 200000, remaining: 800000 });
    expect(dash.categories.find((c: any) => c.name === 'RCC structure')).toMatchObject({ spent: 140000, due: 60000 });
    expect(dash.alerts.some((a: any) => a.kind === 'overdue_payment')).toBe(true);
    expect(dash.recentExpenses[0].vendorName).toBe('Kaveri Steel');

    const report = await call(t.app, { method: 'GET', url: api('/report?today=2026-03-10'), headers: owner.headers });
    expect(report.vendors[0]).toMatchObject({ name: 'Kaveri Steel', paid: 140000, due: 60000, balance: 160000 });

    const projects = await call(t.app, { method: 'GET', url: '/api/v1/projects', headers: owner.headers });
    expect(projects[0].stats).toMatchObject({ spent: 140000, due: 60000 });
  });

  it('updates and soft-deletes entries with an activity trail', async () => {
    const created = await call(t.app, { method: 'POST', url: api('/tasks'), headers: owner.headers, payload: { title: 'Order tiles' }, expect: 201 });
    const done = await call(t.app, { method: 'PATCH', url: api(`/tasks/${created.id}`), headers: owner.headers, payload: { status: 'done' } });
    expect(done.completedAt).toBeTruthy();
    expect(done.priority).toBe('medium'); // untouched by a partial update
    await call(t.app, { method: 'DELETE', url: api(`/tasks/${created.id}`), headers: owner.headers });
    const missing = await t.app.inject({ method: 'GET', url: api(`/tasks/${created.id}`), headers: owner.headers });
    expect(missing.statusCode).toBe(404);
    const activity = await call(t.app, { method: 'GET', url: api('/activity'), headers: owner.headers });
    expect(activity.map((a: any) => a.action).slice(0, 3)).toEqual(['delete', 'update', 'create']);
  });

  it('tracks stock and labour', async () => {
    const materials = await call(t.app, { method: 'GET', url: api('/materials'), headers: owner.headers });
    const cement = materials.items.find((m: any) => m.name.startsWith('Cement'));
    await call(t.app, { method: 'PATCH', url: api(`/materials/${cement.id}`), headers: owner.headers, payload: { minStock: 50 } });
    await call(t.app, { method: 'POST', url: api('/movements'), headers: owner.headers, payload: { materialId: cement.id, type: 'in', quantity: 100, rate: 400, date: '2026-03-01' }, expect: 201 });
    await call(t.app, { method: 'POST', url: api('/movements'), headers: owner.headers, payload: { materialId: cement.id, type: 'out', quantity: 70, date: '2026-03-03' }, expect: 201 });

    const worker = await call(t.app, { method: 'POST', url: api('/workers'), headers: owner.headers, payload: { name: 'Ravi', trade: 'mason', dailyWage: 1000 }, expect: 201 });
    await call(t.app, {
      method: 'POST',
      url: api('/attendance/bulk'),
      headers: owner.headers,
      payload: { date: '2026-03-03', entries: [{ workerId: worker.id, status: 'present', overtimeHours: 2 }] },
    });
    // Re-marking the same day updates instead of duplicating.
    await call(t.app, { method: 'POST', url: api('/attendance/bulk'), headers: owner.headers, payload: { date: '2026-03-03', entries: [{ workerId: worker.id, status: 'half' }] } });
    await call(t.app, { method: 'POST', url: api('/attendance'), headers: owner.headers, payload: { workerId: worker.id, date: '2026-03-04', status: 'present' }, expect: 201 });
    await call(t.app, { method: 'POST', url: api('/expenses'), headers: owner.headers, payload: { date: '2026-03-05', title: 'Wages', amount: 800, workerId: worker.id }, expect: 201 });

    const report = await call(t.app, { method: 'GET', url: api('/report'), headers: owner.headers });
    const stock = report.materials.find((m: any) => m.id === cement.id);
    expect(stock).toMatchObject({ received: 100, used: 70, stock: 30, value: 40000, avgRate: 400 });
    const labour = report.labour.find((l: any) => l.workerId === worker.id);
    expect(labour).toMatchObject({ presentDays: 1, halfDays: 1, earned: 1500, paid: 800, balance: 700 });

    const dash = await call(t.app, { method: 'GET', url: api('/dashboard?today=2026-03-04'), headers: owner.headers });
    expect(dash.alerts.some((a: any) => a.kind === 'low_stock')).toBe(true);
    expect(dash.counts.presentToday).toBe(1);
  });

  it('validates input', async () => {
    const res = await t.app.inject({ method: 'POST', url: api('/expenses'), headers: owner.headers, payload: { title: '', amount: -5, date: 'yesterday' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    const bogus = await t.app.inject({ method: 'GET', url: '/api/v1/projects/not-a-uuid', headers: owner.headers });
    expect(bogus.statusCode).toBe(404);
  });

  it('exports CSV and PDF reports', async () => {
    const csv = await t.app.inject({ method: 'GET', url: api('/export/expenses.csv'), headers: owner.headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('TMT bars 2 ton');
    const pdf = await t.app.inject({ method: 'GET', url: api('/report.pdf'), headers: owner.headers });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('creates a sample project that does not count toward plan limits', async () => {
    const user = await registerUser(t.app, 'Demo User');
    const demo = await call(t.app, { method: 'POST', url: '/api/v1/projects/demo', headers: user.headers, payload: {}, expect: 201 });
    const dash = await call(t.app, { method: 'GET', url: `/api/v1/projects/${demo.id}/dashboard`, headers: user.headers });
    expect(dash.totals.spent).toBeGreaterThan(0);
    expect(dash.totals.fundsReceived).toBeGreaterThan(dash.totals.spent);
    expect(dash.phases.some((p: any) => p.status === 'completed')).toBe(true);
    // A second call returns the same sample instead of creating another.
    const again = await call(t.app, { method: 'POST', url: '/api/v1/projects/demo', headers: user.headers, payload: {} });
    expect(again.id).toBe(demo.id);
  });
});

describe('roles & permissions', () => {
  it('enforces viewer / contributor / manager rights', async () => {
    const viewer = await registerUser(t.app, 'Viewer');
    const contributor = await registerUser(t.app, 'Site Engineer');
    await addMember(t.app, owner, projectId, viewer, 'viewer');
    await addMember(t.app, owner, projectId, contributor, 'contributor');

    const members = await call(t.app, { method: 'GET', url: api('/members'), headers: owner.headers });
    expect(members.members.map((m: any) => m.role).sort()).toEqual(['contributor', 'manager', 'viewer']);

    // Viewer: read-only.
    await call(t.app, { method: 'GET', url: api('/expenses'), headers: viewer.headers });
    const denied = await t.app.inject({ method: 'POST', url: api('/expenses'), headers: viewer.headers, payload: { date: '2026-03-01', title: 'x', amount: 10 } });
    expect(denied.statusCode).toBe(403);

    // Contributor: can add, can delete own, cannot delete others' or edit the budget.
    const mine = await call(t.app, { method: 'POST', url: api('/expenses'), headers: contributor.headers, payload: { date: '2026-03-01', title: 'Nails', amount: 450 }, expect: 201 });
    const others = await call(t.app, { method: 'GET', url: api('/expenses?q=TMT'), headers: contributor.headers });
    expect((await t.app.inject({ method: 'DELETE', url: api(`/expenses/${others.items[0].id}`), headers: contributor.headers })).statusCode).toBe(403);
    await call(t.app, { method: 'DELETE', url: api(`/expenses/${mine.id}`), headers: contributor.headers });
    const cats = await call(t.app, { method: 'GET', url: api('/categories'), headers: contributor.headers });
    expect((await t.app.inject({ method: 'PATCH', url: api(`/categories/${cats.items[0].id}`), headers: contributor.headers, payload: { plannedAmount: 1 } })).statusCode).toBe(403);

    // Outsiders can't even see the project.
    const stranger = await registerUser(t.app, 'Stranger');
    expect((await t.app.inject({ method: 'GET', url: api(''), headers: stranger.headers })).statusCode).toBe(404);
  });

  it('enforces plan limits once a trial lapses', async () => {
    const user = await registerUser(t.app, 'Free User');
    await createProject(t.app, user);
    await t.database.db.update(organizations).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(organizations.id, user.orgs[0]!.id));
    const second = await t.app.inject({ method: 'POST', url: '/api/v1/projects', headers: user.headers, payload: { name: 'Second house' } });
    expect(second.statusCode).toBe(402);
    expect(second.json().error.code).toBe('PLAN_LIMIT');
    const projects = await call(t.app, { method: 'GET', url: '/api/v1/projects', headers: user.headers });
    const pdf = await t.app.inject({ method: 'GET', url: `/api/v1/projects/${projects[0].id}/report.pdf`, headers: user.headers });
    expect(pdf.statusCode).toBe(402);
  });
});
