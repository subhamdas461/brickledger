import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orgMembers } from '../src/db/schema';
import { addMember, buildTestApp, call, createProject, registerUser, type TestApp, type TestUser } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => t.close());

const feed = (user: TestUser, query = '') => call(t.app, { method: 'GET', url: `/api/v1/notifications${query}`, headers: user.headers });
const unread = async (user: TestUser) => (await call(t.app, { method: 'GET', url: '/api/v1/notifications/count', headers: user.headers })).unread as number;
const addExpense = (user: TestUser, projectId: string, title: string, amount = 1000) =>
  call(t.app, { method: 'POST', url: `/api/v1/projects/${projectId}/expenses`, headers: user.headers, payload: { date: '2026-11-10', title, amount }, expect: 201 });

describe('notifications', () => {
  it('tells every other member about a change, but not the person who made it', async () => {
    const owner = await registerUser(t.app, 'Owner Om');
    const engineer = await registerUser(t.app, 'Engineer Esha');
    const client = await registerUser(t.app, 'Client Kiran');
    const project = await createProject(t.app, owner, { useTemplates: false, name: 'Notify House' });
    await addMember(t.app, owner, project.id, engineer, 'contributor');
    await addMember(t.app, owner, project.id, client, 'viewer');
    const before = { owner: await unread(owner), engineer: await unread(engineer), client: await unread(client) };

    await addExpense(engineer, project.id, 'Cement 50 bags', 21_000);

    expect(await unread(owner)).toBe(before.owner + 1);
    expect(await unread(client)).toBe(before.client + 1);
    expect(await unread(engineer)).toBe(before.engineer); // not told about their own change
    const [latest] = (await feed(owner)).items;
    expect(latest).toMatchObject({ projectId: project.id, projectName: 'Notify House', action: 'create', entityType: 'expenses', unread: true, user: { name: 'Engineer Esha' } });
    expect(latest.summary).toContain('Cement 50 bags');

    // Marking read clears the count; the next change counts again.
    expect((await call(t.app, { method: 'POST', url: '/api/v1/notifications/read', headers: owner.headers, payload: {} })).unread).toBe(0);
    expect((await feed(owner)).items[0].unread).toBe(false);
    await addExpense(engineer, project.id, 'Sand 2 loads');
    expect(await unread(owner)).toBe(1);

    // A phone asks only for what it hasn't shown yet.
    const newer = await feed(owner, `?after=${latest.id}`);
    expect(newer.items.map((i: any) => i.summary)).toEqual([expect.stringContaining('Sand 2 loads')]);
  });

  it('includes changes synced from phones, files and team changes', async () => {
    const owner = await registerUser(t.app, 'Owner');
    const engineer = await registerUser(t.app, 'Engineer');
    const project = await createProject(t.app, owner, { useTemplates: false, name: 'Sync House' });
    await addMember(t.app, owner, project.id, engineer, 'contributor');
    await call(t.app, { method: 'POST', url: '/api/v1/notifications/read', headers: owner.headers, payload: {} });

    await call(t.app, {
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sync`,
      headers: engineer.headers,
      payload: { mutations: [{ entity: 'tasks', op: 'upsert', id: randomUUID(), data: { title: 'Cure the slab' } }] },
    });
    const items = (await feed(owner)).items;
    expect(items[0]).toMatchObject({ entityType: 'tasks', unread: true });
  });

  it('does not replay history to someone who joins later, and stops after they leave', async () => {
    const owner = await registerUser(t.app, 'Owner');
    const project = await createProject(t.app, owner, { useTemplates: false, name: 'History House' });
    const helper = await registerUser(t.app, 'Helper');
    await addMember(t.app, owner, project.id, helper, 'contributor');
    await addExpense(helper, project.id, 'Before the newcomer');

    const newcomer = await registerUser(t.app, 'Newcomer');
    await addMember(t.app, owner, project.id, newcomer, 'viewer');
    const seen = (await feed(newcomer)).items.map((i: any) => i.summary).join(' | ');
    expect(seen).not.toContain('Before the newcomer');
    await addExpense(helper, project.id, 'After the newcomer');
    expect((await feed(newcomer)).items[0].summary).toContain('After the newcomer');

    await call(t.app, { method: 'DELETE', url: `/api/v1/projects/${project.id}/members/${newcomer.user.id}`, headers: owner.headers });
    await addExpense(helper, project.id, 'After they left');
    expect(JSON.stringify(await feed(newcomer))).not.toContain('After they left');
  });

  it('covers workspace admins, who see every project, and skips deleted projects', async () => {
    const owner = await registerUser(t.app, 'Owner');
    const admin = await registerUser(t.app, 'Admin');
    const project = await createProject(t.app, owner, { useTemplates: false, name: 'Admin House' });
    await t.database.db.insert(orgMembers).values({ orgId: project.orgId, userId: admin.user.id, role: 'admin', createdAt: new Date(Date.now() - 60_000) });

    await addExpense(owner, project.id, 'Steel 2 tonnes');
    expect((await feed(admin)).items[0]).toMatchObject({ projectId: project.id });

    await call(t.app, { method: 'DELETE', url: `/api/v1/projects/${project.id}`, headers: owner.headers });
    expect((await feed(admin)).items.some((i: any) => i.projectId === project.id)).toBe(false);
  });

  it('pages back through older notifications and never moves the read marker backwards', async () => {
    const owner = await registerUser(t.app, 'Owner');
    const engineer = await registerUser(t.app, 'Engineer');
    const project = await createProject(t.app, owner, { useTemplates: false, name: 'Paging House' });
    await addMember(t.app, owner, project.id, engineer, 'contributor');
    for (let i = 1; i <= 5; i++) await addExpense(engineer, project.id, `Bill ${i}`);

    const page1 = await feed(owner, '?limit=2');
    expect(page1.items).toHaveLength(2);
    const page2 = await feed(owner, `?limit=2&before=${page1.items[1].id}`);
    expect(page2.items[0].id).toBeLessThan(page1.items[1].id);

    await call(t.app, { method: 'POST', url: '/api/v1/notifications/read', headers: owner.headers, payload: {} });
    const res = await call(t.app, { method: 'POST', url: '/api/v1/notifications/read', headers: owner.headers, payload: { upTo: 1 } });
    expect(res.unread).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/notifications' })).statusCode).toBe(401);
  });
});
