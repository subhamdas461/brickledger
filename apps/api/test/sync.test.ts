import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, buildTestApp, call, createProject, registerUser, type TestApp, type TestUser } from './helpers';

let t: TestApp;
let owner: TestUser;
let projectId: string;
const url = () => `/api/v1/projects/${projectId}/sync`;

beforeAll(async () => {
  t = await buildTestApp();
  owner = await registerUser(t.app, 'Owner');
  projectId = (await createProject(t.app, owner, { useTemplates: false })).id;
});
afterAll(async () => t.close());

describe('offline sync', () => {
  it('pushes client-created records idempotently and pulls them back', async () => {
    const vendorId = randomUUID();
    const expenseId = randomUUID();
    const mutations = [
      // Out of dependency order on purpose: the server sorts vendors before expenses.
      { entity: 'expenses', op: 'upsert', id: expenseId, data: { date: '2026-02-01', title: 'Sand 2 loads', amount: 18000, vendorId } },
      { entity: 'vendors', op: 'upsert', id: vendorId, data: { name: 'Shree Sand', type: 'supplier', syncState: 1, localRev: 3 } },
    ];
    const first = await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations } });
    expect(first.results.map((r: any) => r.status)).toEqual(['ok', 'ok']);
    // Replaying the same batch is harmless.
    const replay = await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations } });
    expect(replay.results.every((r: any) => r.status === 'ok')).toBe(true);

    const pull = await call(t.app, { method: 'GET', url: `${url()}?since=0`, headers: owner.headers });
    expect(pull.changes.vendors).toHaveLength(1);
    expect(pull.changes.expenses[0]).toMatchObject({ id: expenseId, amount: 18000, vendorId });
    expect(pull.project.id).toBe(projectId);
    expect(pull.hasMore).toBe(false);

    const expenses = await call(t.app, { method: 'GET', url: `/api/v1/projects/${projectId}/expenses`, headers: owner.headers });
    expect(expenses.total).toBe(1);
  });

  it('propagates deletes as tombstones and pages by cursor', async () => {
    const base = await call(t.app, { method: 'GET', url: `${url()}?since=0`, headers: owner.headers });
    const id = randomUUID();
    await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations: [{ entity: 'tasks', op: 'upsert', id, data: { title: 'Cure slab' } }] } });
    await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations: [{ entity: 'tasks', op: 'delete', id }] } });
    const delta = await call(t.app, { method: 'GET', url: `${url()}?since=${base.cursor}`, headers: owner.headers });
    expect(delta.changes.tasks).toHaveLength(1);
    expect(delta.changes.tasks[0].deletedAt).toBeTruthy();
    expect(delta.cursor).toBeGreaterThan(base.cursor);

    // Paging: limit 1 returns one change at a time with hasMore.
    const p1 = await call(t.app, { method: 'GET', url: `${url()}?since=0&limit=1`, headers: owner.headers });
    expect(p1.hasMore).toBe(true);
    const p2 = await call(t.app, { method: 'GET', url: `${url()}?since=${p1.cursor}&limit=1`, headers: owner.headers });
    expect(p2.cursor).toBeGreaterThan(p1.cursor);
  });

  it('accepts a delete sent the way the Android app sends it (data: null) alongside other changes', async () => {
    const keep = randomUUID();
    const gone = randomUUID();
    await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations: [{ entity: 'tasks', op: 'upsert', id: gone, data: { title: 'Order tiles' } }] } });
    const res = await call(t.app, {
      method: 'POST',
      url: url(),
      headers: owner.headers,
      payload: { mutations: [{ entity: 'tasks', op: 'delete', id: gone, data: null }, { entity: 'tasks', op: 'upsert', id: keep, data: { title: 'Fix grills' } }] },
    });
    expect(res.results.map((r: any) => r.status)).toEqual(['ok', 'ok']);
    const tasks = await call(t.app, { method: 'GET', url: `/api/v1/projects/${projectId}/tasks`, headers: owner.headers });
    expect(tasks.items.map((x: any) => x.id)).toContain(keep);
    expect(tasks.items.map((x: any) => x.id)).not.toContain(gone);
  });

  it('merges attendance for the same worker and day from two devices', async () => {
    const workerId = randomUUID();
    await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations: [{ entity: 'workers', op: 'upsert', id: workerId, data: { name: 'Lakshmi', dailyWage: 650 } }] } });
    const a = randomUUID();
    const b = randomUUID();
    await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations: [{ entity: 'attendance', op: 'upsert', id: a, data: { workerId, date: '2026-02-03', status: 'present' } }] } });
    const res = await call(t.app, { method: 'POST', url: url(), headers: owner.headers, payload: { mutations: [{ entity: 'attendance', op: 'upsert', id: b, data: { workerId, date: '2026-02-03', status: 'half' } }] } });
    expect(res.results[0]).toMatchObject({ status: 'ok', canonicalId: a });
    const list = await call(t.app, { method: 'GET', url: `/api/v1/projects/${projectId}/attendance?date=2026-02-03`, headers: owner.headers });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: a, status: 'half' });
  });

  it('reports permanent errors as non-retryable and blocks viewers', async () => {
    const res = await call(t.app, {
      method: 'POST',
      url: url(),
      headers: owner.headers,
      payload: {
        mutations: [
          { entity: 'expenses', op: 'upsert', id: randomUUID(), data: { title: 'No amount', date: '2026-02-01' } },
          { entity: 'spaceships', op: 'upsert', id: randomUUID(), data: {} },
        ],
      },
    });
    expect(res.results.map((r: any) => [r.status, r.retryable])).toEqual([
      ['error', false],
      ['error', false],
    ]);

    const viewer = await registerUser(t.app, 'Viewer');
    await addMember(t.app, owner, projectId, viewer, 'viewer');
    const denied = await t.app.inject({ method: 'POST', url: url(), headers: viewer.headers, payload: { mutations: [] } });
    expect(denied.statusCode).toBe(403);
    // ...but viewers can pull.
    await call(t.app, { method: 'GET', url: `${url()}?since=0`, headers: viewer.headers });
  });
});
