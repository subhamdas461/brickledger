import { createVerify, generateKeyPairSync, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { orgMembers, pushDevices } from '../src/db/schema';
import { addMember, buildTestApp, call, createProject, registerUser, type TestApp, type TestUser } from './helpers';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  type: 'service_account',
  project_id: 'brickledger-test',
  client_email: 'push@brickledger-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
};
const realFetch = globalThis.fetch;

let t: TestApp;
let sent: { token: string; data: Record<string, string>; android: any }[];
let tokenCalls: string[];
const goneTokens = new Set<string>();

beforeAll(async () => {
  t = await buildTestApp({ FIREBASE_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(serviceAccount)).toString('base64') });
});
afterAll(async () => t.close());
beforeEach(() => {
  sent = [];
  tokenCalls = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCalls.push(new URLSearchParams(String(init?.body)).get('assertion')!);
      return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
    }
    if (url === 'https://fcm.googleapis.com/v1/projects/brickledger-test/messages:send') {
      expect((init?.headers as any).Authorization).toBe('Bearer ya29.test');
      const { message } = JSON.parse(String(init?.body));
      if (goneTokens.has(message.token)) return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
      sent.push(message);
      return new Response(JSON.stringify({ name: 'projects/x/messages/1' }), { status: 200 });
    }
    return realFetch(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

const phone = (user: TestUser, token = `tok-${randomUUID()}-${randomUUID()}`) =>
  call(t.app, { method: 'POST', url: '/api/v1/devices', headers: user.headers, payload: { token, platform: 'android' } }).then(() => token);
const addExpense = (user: TestUser, projectId: string, title: string) =>
  t.app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/expenses`, headers: user.headers, payload: { date: '2026-11-20', title, amount: 21_000 } });

async function team() {
  const owner = await registerUser(t.app, 'Owner Om');
  const engineer = await registerUser(t.app, 'Engineer Esha');
  const outsider = await registerUser(t.app, 'Not On It');
  const project = await createProject(t.app, owner, { useTemplates: false, name: 'Push House' });
  await addMember(t.app, owner, project.id, engineer, 'contributor');
  return { owner, engineer, outsider, project };
}

describe('instant phone notifications', () => {
  it('pushes a change to the other members’ phones right away, signed with the service account', async () => {
    const { owner, engineer, outsider, project } = await team();
    const ownerPhone = await phone(owner);
    const engineerPhone = await phone(engineer);
    await phone(outsider);
    const admin = await registerUser(t.app, 'Workspace Admin');
    await t.database.db.insert(orgMembers).values({ orgId: project.orgId, userId: admin.user.id, role: 'admin', createdAt: new Date(Date.now() - 60_000) });
    const adminPhone = await phone(admin);
    sent = [];

    expect((await addExpense(engineer, project.id, 'Cement 50 bags')).statusCode).toBe(201);

    expect(sent.map((m) => m.token).sort()).toEqual([ownerPhone, adminPhone].sort()); // not the engineer's own, not outsiders
    expect(sent.find((m) => m.token === engineerPhone)).toBeUndefined();
    const toOwner = sent.find((m) => m.token === ownerPhone)!;
    expect(toOwner.android).toMatchObject({ priority: 'HIGH' });
    expect(toOwner.data).toMatchObject({ type: 'activity', to: owner.user.id, projectId: project.id, projectName: 'Push House', entityType: 'expenses' });
    expect(toOwner.data.text).toBe('Engineer Esha added ₹21,000 · Cement 50 bags');
    expect(Number(toOwner.data.id)).toBeGreaterThan(0);

    // Google accepts the sign-in only if it is a valid RS256 token from the service account.
    const [header, claims, signature] = tokenCalls[0]!.split('.');
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature!, 'base64url')).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });
  });

  it('sends one message for a batch of changes, reuses its Google sign-in, and sends nothing for a failed request', async () => {
    const { owner, engineer, project } = await team();
    await phone(owner);
    sent = [];
    const mutations = ['Order sand', 'Cure slab', 'Fix grills'].map((title) => ({ entity: 'tasks', op: 'upsert', id: randomUUID(), data: { title } }));
    await call(t.app, { method: 'POST', url: `/api/v1/projects/${project.id}/sync`, headers: engineer.headers, payload: { mutations } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({ text: 'Engineer Esha made 3 changes', entityType: 'tasks' });

    await addExpense(engineer, project.id, 'Bricks');
    expect(sent).toHaveLength(2);
    expect(tokenCalls.length).toBeLessThanOrEqual(1); // signed in once, then cached

    const bad = await t.app.inject({ method: 'POST', url: `/api/v1/projects/${project.id}/expenses`, headers: engineer.headers, payload: { title: 'No amount' } });
    expect(bad.statusCode).toBe(400);
    expect(sent).toHaveLength(2);
  });

  it('forgets phones Google says are gone, and moves a token to whoever signs in on that phone', async () => {
    const { owner, engineer, project } = await team();
    const oldPhone = await phone(owner);
    goneTokens.add(oldPhone);
    await addExpense(engineer, project.id, 'Steel');
    expect(await t.database.db.select().from(pushDevices).where(eq(pushDevices.token, oldPhone))).toHaveLength(0);

    // The same phone, now signed in by the engineer: the owner no longer gets pushes on it.
    const shared = await phone(owner);
    await phone(engineer, shared);
    const [row] = await t.database.db.select().from(pushDevices).where(eq(pushDevices.token, shared));
    expect(row!.userId).toBe(engineer.user.id);

    // Removing only works for your own phone.
    await call(t.app, { method: 'POST', url: '/api/v1/devices/remove', headers: owner.headers, payload: { token: shared } });
    expect(await t.database.db.select().from(pushDevices).where(eq(pushDevices.token, shared))).toHaveLength(1);
    await call(t.app, { method: 'POST', url: '/api/v1/devices/remove', headers: engineer.headers, payload: { token: shared } });
    expect(await t.database.db.select().from(pushDevices).where(eq(pushDevices.token, shared))).toHaveLength(0);
  });

  it('stays off without a service account, and says so', async () => {
    const plain = await buildTestApp();
    try {
      const health = await plain.app.inject({ method: 'GET', url: '/api/health' });
      expect(health.json().push).toBe('not-configured');
      const owner = await registerUser(plain.app, 'Owner');
      const engineer = await registerUser(plain.app, 'Engineer');
      const project = await createProject(plain.app, owner, { useTemplates: false });
      await addMember(plain.app, owner, project.id, engineer, 'contributor');
      await call(plain.app, { method: 'POST', url: '/api/v1/devices', headers: owner.headers, payload: { token: `tok-${randomUUID()}-x` } });
      sent = [];
      await plain.app.inject({ method: 'POST', url: `/api/v1/projects/${project.id}/expenses`, headers: engineer.headers, payload: { date: '2026-11-20', title: 'Sand', amount: 500 } });
      expect(sent).toHaveLength(0);
      expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json().push).toBe('connected');
    } finally {
      await plain.close();
    }
  });
});
