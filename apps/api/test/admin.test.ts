import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsCounters, users } from '../src/db/schema';
import { normalizePage, referrerHost } from '../src/modules/tracking/routes';
import { buildTestApp, call, createProject, registerUser, type TestApp, type TestUser } from './helpers';

let t: TestApp;
let admin: TestUser;

beforeAll(async () => {
  t = await buildTestApp();
  admin = await registerUser(t.app, 'Site Owner');
  await t.database.db.update(users).set({ isSuperAdmin: true }).where(eq(users.id, admin.user.id));
});
afterAll(async () => t.close());

const adminGet = (url: string) => call(t.app, { method: 'GET', url: `/api/v1/admin${url}`, headers: admin.headers });
const adminDo = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload: Record<string, unknown> = {}, expect = 200) =>
  call(t.app, { method, url: `/api/v1/admin${url}`, headers: admin.headers, payload, expect });

describe('admin access', () => {
  it('is invisible to everyone except super admins', async () => {
    const user = await registerUser(t.app);
    for (const url of ['/overview', '/users', '/audit', '/system']) {
      expect((await t.app.inject({ method: 'GET', url: `/api/v1/admin${url}` })).statusCode).toBe(401);
      expect((await t.app.inject({ method: 'GET', url: `/api/v1/admin${url}`, headers: user.headers })).statusCode).toBe(404);
    }
    const ban = await t.app.inject({ method: 'POST', url: `/api/v1/admin/users/${admin.user.id}/ban`, headers: user.headers, payload: { reason: 'taking over' } });
    expect(ban.statusCode).toBe(404);
  });

  it('tells only a super admin that they are one', async () => {
    const user = await registerUser(t.app);
    const me = await call(t.app, { method: 'GET', url: '/api/v1/me', headers: admin.headers });
    expect(me.user.isSuperAdmin).toBe(true);
    const other = await call(t.app, { method: 'GET', url: '/api/v1/me', headers: user.headers });
    expect(other.user.isSuperAdmin).toBeUndefined();
  });

  it('never returns password hashes', async () => {
    const list = await adminGet('/users?limit=100');
    expect(JSON.stringify(list)).not.toMatch(/password|scrypt/i);
    const detail = await adminGet(`/users/${admin.user.id}`);
    expect(JSON.stringify(detail)).not.toMatch(/passwordHash|scrypt/i);
  });
});

describe('managing accounts', () => {
  it('searches accounts by name or email', async () => {
    await registerUser(t.app, 'Findable Farida');
    const found = await adminGet('/users?q=findable');
    expect(found.total).toBe(1);
    expect(found.items[0].name).toBe('Findable Farida');
    const wildcard = await adminGet('/users?q=%25');
    expect(wildcard.total).toBe(0); // a literal %, not "match everything"
  });

  it('banning blocks sign-in, refresh and an access token already issued, and unbanning restores them', async () => {
    const user = await registerUser(t.app, 'Banned Bob');
    const email = user.user.email;
    const me = () => t.app.inject({ method: 'GET', url: '/api/v1/me', headers: user.headers });
    expect((await me()).statusCode).toBe(200);

    expect((await t.app.inject({ method: 'POST', url: `/api/v1/admin/users/${user.user.id}/ban`, headers: admin.headers, payload: {} })).statusCode).toBe(400); // reason required
    await adminDo('POST', `/users/${user.user.id}/ban`, { reason: 'Spam accounts' });

    expect((await me()).statusCode).toBe(401);
    const login = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'password123' } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('ACCOUNT_SUSPENDED');
    const wrong = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'wrong-password' } });
    expect(wrong.statusCode).toBe(401); // the ban isn't revealed without the password
    const refresh = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(refresh.statusCode).toBe(401);

    const detail = await adminGet(`/users/${user.user.id}`);
    expect(detail.banReason).toBe('Spam accounts');
    expect(detail.sessions).toHaveLength(0);

    await adminDo('POST', `/users/${user.user.id}/unban`);
    const again = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'password123' } });
    expect(again.statusCode).toBe(200);
  });

  it('won’t let an admin ban or delete themselves or another super admin', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/v1/admin/users/${admin.user.id}/ban`, headers: admin.headers, payload: { reason: 'oops' } });
    expect(res.statusCode).toBe(400);
    const second = await registerUser(t.app, 'Second Admin');
    await t.database.db.update(users).set({ isSuperAdmin: true }).where(eq(users.id, second.user.id));
    const del = await t.app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${second.user.id}`, headers: admin.headers, payload: { confirmEmail: second.user.email } });
    expect(del.statusCode).toBe(400);
    await t.database.db.update(users).set({ isSuperAdmin: false }).where(eq(users.id, second.user.id));
  });

  it('deletes an account with its workspace and data, only after the email is typed', async () => {
    const user = await registerUser(t.app, 'Leaving Lata');
    const project = await createProject(t.app, user);
    const wrong = await t.app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${user.user.id}`, headers: admin.headers, payload: { confirmEmail: 'nope@example.com' } });
    expect(wrong.statusCode).toBe(400);
    await adminDo('DELETE', `/users/${user.user.id}`, { confirmEmail: user.user.email });
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: user.headers })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/admin/users/${user.user.id}`, headers: admin.headers })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}`, headers: admin.headers })).statusCode).toBeGreaterThanOrEqual(400);
    const log = await adminGet('/audit?q=user.delete');
    expect(log.items[0].targetLabel).toBe(user.user.email); // the record outlives the account
  });

  it('creates a working one-time password reset link', async () => {
    const user = await registerUser(t.app, 'Forgetful Faiz');
    const { url } = await adminDo('POST', `/users/${user.user.id}/reset-link`);
    const token = new URL(url).searchParams.get('token');
    const reset = await t.app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'brand-new-pass-1' } });
    expect(reset.statusCode).toBe(200);
    const login = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.user.email, password: 'brand-new-pass-1' } });
    expect(login.statusCode).toBe(200);
  });

  it('signs an account out everywhere', async () => {
    const user = await registerUser(t.app);
    const res = await adminDo('POST', `/users/${user.user.id}/sign-out`);
    expect(res.sessions).toBe(1);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } })).statusCode).toBe(401);
  });

  it('exports accounts as CSV and records that it did', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/admin/users/export.csv', headers: admin.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain(admin.user.email);
    const log = await adminGet('/audit?q=users.export');
    expect(log.total).toBeGreaterThan(0);
  });
});

describe('workspaces', () => {
  it('gives a plan and extends a trial', async () => {
    const user = await registerUser(t.app, 'Comped Chitra');
    const { items } = await adminGet(`/workspaces?q=${encodeURIComponent(user.user.email)}`);
    expect(items).toHaveLength(1);
    const id = items[0].id;

    await adminDo('PATCH', `/workspaces/${id}/plan`, { plan: 'business' });
    const after = await adminGet(`/workspaces?q=${encodeURIComponent(user.user.email)}`);
    expect(after.items[0]).toMatchObject({ plan: 'business', planStatus: 'active' });

    await adminDo('PATCH', `/workspaces/${id}/plan`, { plan: 'free' });
    const { trialEndsAt } = await adminDo('POST', `/workspaces/${id}/extend-trial`, { days: 10 });
    expect(new Date(trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    const trial = await adminGet(`/workspaces?q=${encodeURIComponent(user.user.email)}`);
    expect(trial.items[0]).toMatchObject({ plan: 'pro', planStatus: 'trialing' });
  });
});

describe('stats and tracking', () => {
  const browser = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36', 'x-vercel-ip-country': 'IN' };
  const track = (payload: Record<string, unknown>, headers: Record<string, string> = browser) => t.app.inject({ method: 'POST', url: '/api/v1/public/track', headers, payload });

  it('keeps ids and tokens out of the page names', () => {
    expect(normalizePage('/')).toBe('/');
    expect(normalizePage('/pricing?utm=x#a')).toBe('/pricing');
    expect(normalizePage('/invite/secret-token')).toBe('/invite/:token');
    expect(normalizePage('/app/p/0d9f6e0a-1111-2222-3333-444455556666/expenses')).toBe('/app/p/:id/expenses');
    expect(normalizePage('/app/p/0d9f6e0a-1111-2222-3333-444455556666/made-up')).toBe('/other');
    expect(normalizePage('/reset-password?token=abc')).toBe('/reset-password');
    expect(normalizePage('/whatever/spam')).toBe('/other');
    expect(normalizePage('/admin/users')).toBeNull();
  });

  it('classifies referrers', () => {
    expect(referrerHost(null, ['app.test'])).toBe('Direct');
    expect(referrerHost('https://www.google.com/search?q=x', ['app.test'])).toBe('google.com');
    expect(referrerHost('https://app.test/pricing', ['app.test'])).toBeNull();
  });

  it('counts page views, once-a-day visitors and engagement, and ignores bots and the admin panel', async () => {
    const before = await adminGet('/overview');
    expect((await track({ type: 'view', path: '/', referrer: 'https://www.google.com/' })).statusCode).toBe(204);
    await track({ type: 'view', path: '/pricing', referrer: 'https://app.test/' });
    await track({ type: 'engaged', seconds: 40 });
    await track({ type: 'view', path: '/admin/users' });
    await track({ type: 'view', path: '/' }, { 'user-agent': 'Googlebot/2.1' });
    const after = await adminGet('/overview');
    expect(after.web.viewsToday - before.web.viewsToday).toBe(2);
    expect(after.web.visitorsToday - before.web.visitorsToday).toBe(1);

    const engagement = await adminGet('/engagement?days=7');
    expect(engagement.referrers).toContainEqual({ name: 'google.com', value: 1 });
    expect(engagement.countries).toContainEqual({ name: 'IN', value: 1 });
    expect(engagement.devices).toContainEqual({ name: 'Mobile', value: 1 });
    expect(engagement.pages.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['/', '/pricing']));
    expect(engagement.avgSeconds).toBe(40);
  });

  it('stores no identifying data in the counters', async () => {
    const rows = await t.database.db.select().from(analyticsCounters);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain('Mozilla');
  });

  it('counts APK downloads and still redirects to the file', async () => {
    const before = await adminGet('/app-stats');
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/public/download/android?source=web&v=1.0.2', headers: browser });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/apk/brickledger.apk');
    await t.app.inject({ method: 'GET', url: '/api/v1/public/download/android?source=update&v=1.0.2', headers: browser });
    const head = await t.app.inject({ method: 'HEAD', url: '/api/v1/public/download/android?source=web', headers: browser });
    expect(head.statusCode).toBe(302);
    const junk = await t.app.inject({ method: 'GET', url: '/api/v1/public/download/android?source=<script>&v=<script>', headers: browser });
    expect(junk.statusCode).toBe(302);

    const after = await adminGet('/app-stats');
    expect(after.downloads - before.downloads).toBe(3); // HEAD not counted
    expect(after.uniqueDownloads - before.uniqueDownloads).toBe(1);
    expect(after.sources).toContainEqual({ name: 'update', value: 1 });
    expect(after.downloadVersions).toContainEqual({ name: '1.0.2', value: 2 });
    expect(JSON.stringify(after)).not.toContain('script');
  });

  it('tracks app installs by a hashed id, without duplicates', async () => {
    const installId = '4f1c2d3e-0000-4000-8000-1234567890ab';
    const ping = (versionName: string, versionCode: number) => t.app.inject({ method: 'POST', url: '/api/v1/public/app-ping', headers: browser, payload: { installId, versionName, versionCode } });
    expect((await ping('1.0.2', 3)).statusCode).toBe(204);
    expect((await ping('1.0.3', 4)).statusCode).toBe(204);
    const stats = await adminGet('/app-stats');
    expect(stats.devices.total).toBe(1);
    expect(stats.activeVersions).toEqual([{ name: '1.0.3', value: 1 }]);
    expect(JSON.stringify(await t.database.db.select().from(users))).not.toContain(installId);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/public/app-ping', headers: browser, payload: { installId: 'not-a-uuid', versionName: 'x', versionCode: 1 } })).statusCode).toBe(400);
  });

  it('summarises the whole system', async () => {
    const o = await adminGet('/overview');
    expect(o.users.total).toBeGreaterThan(3);
    expect(o.users.active7d).toBeGreaterThan(0);
    expect(o.series.signups).toHaveLength(30);
    expect(o.series.signups.at(-1).value).toBeGreaterThan(0);
    expect(o.workspaces.total).toBeGreaterThan(0);
    const s = await adminGet('/system');
    expect(s.database.up).toBe(true);
    expect(s.checks.map((c: { key: string }) => c.key)).toEqual(expect.arrayContaining(['database', 'storage', 'email', 'billing']));
  });
});
