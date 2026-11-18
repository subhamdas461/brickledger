import { createHash } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessions } from '../src/db/schema';
import { buildTestApp, call, registerUser, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => t.close());

describe('auth', () => {
  it('registers a user with a trial workspace', async () => {
    const user = await registerUser(t.app, 'Asha Rao', { company: 'Rao Builders' });
    expect(user.accessToken).toBeTruthy();
    expect(user.refreshToken).toBeTruthy();
    expect(user.orgs).toHaveLength(1);
    expect(user.orgs[0]).toMatchObject({ name: 'Rao Builders', role: 'owner', plan: 'pro', planStatus: 'trialing' });
  });

  it('accepts the Android sign-up payload, which sends empty optional fields as null', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Phone User', email: 'phone-user@example.com', password: 'password123', company: null, inviteToken: null },
    });
    expect(res.json().error).toBeUndefined();
    expect(res.statusCode).toBe(201);
    expect(res.json().accessToken).toBeTruthy();
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const user = await registerUser(t.app);
    const dup = await t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'X', email: user.user.email, password: 'password123' } });
    expect(dup.statusCode).toBe(409);
    const weak = await t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'X', email: 'weak@example.com', password: '123' } });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in, reads /me and rejects bad credentials', async () => {
    const user = await registerUser(t.app);
    const bad = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.user.email, password: 'wrong-password' } });
    expect(bad.statusCode).toBe(401);
    const ok = await call(t.app, { method: 'POST', url: '/api/v1/auth/login', payload: { email: user.user.email.toUpperCase(), password: 'password123' } });
    const me = await call(t.app, { method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${ok.accessToken}` } });
    expect(me.user.email).toBe(user.user.email);
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(anon.statusCode).toBe(401);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const user = await registerUser(t.app);
    const r1 = await call(t.app, { method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(r1.refreshToken).not.toBe(user.refreshToken);
    const r2 = await call(t.app, { method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: r1.refreshToken } });

    // Push the original token's rotation outside the grace window, then replay it.
    await t.database.db.execute(sql`update sessions set revoked_at = now() - interval '5 minutes' where revoked_at is not null`);
    const replay = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(replay.statusCode).toBe(401);
    // The whole token family is now revoked.
    const after = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: r2.refreshToken } });
    expect(after.statusCode).toBe(401);
  });

  it('keeps people signed in with no time limit', async () => {
    const user = await registerUser(t.app);
    const login = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.user.email, password: 'password123' } });
    const cookie = String(login.headers['set-cookie']);
    expect(Number(/Max-Age=(\d+)/.exec(cookie)?.[1])).toBe(400 * 86_400); // the longest browsers allow; renewed on every refresh
    const [row] = await t.database.db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.userId, user.user.id)).orderBy(desc(sessions.createdAt)).limit(1);
    expect(row!.expiresAt.getUTCFullYear()).toBe(9999);

    // A session nobody has used for years still refreshes.
    await t.database.db.execute(sql`update sessions set created_at = now() - interval '3 years' where user_id = ${user.user.id}`);
    const refreshed = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(refreshed.statusCode).toBe(200);
  });

  it('recovers when a refresh reply never reached the phone, without weakening theft detection', async () => {
    const user = await registerUser(t.app);
    const age = (token: string) => t.database.db.execute(sql`update sessions set revoked_at = now() - interval '10 minutes' where token_hash = ${createHash('sha256').update(token).digest('hex')}`);
    // The phone refreshes, the server rotates, but the reply is lost: the phone still holds the old token.
    const lost = await call(t.app, { method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } });
    await age(user.refreshToken);
    const retried = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(retried.statusCode).toBe(200);
    // Lost twice in a row: still fine.
    await age(user.refreshToken);
    const again = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(again.statusCode).toBe(200);
    const latest = await call(t.app, { method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: again.json().refreshToken } });

    // The replacement that never arrived is dead, and showing up with it is treated as theft: everything is signed out.
    await age(lost.refreshToken);
    const stolen = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: lost.refreshToken } });
    expect(stolen.statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: latest.refreshToken } })).statusCode).toBe(401);
  });

  it('supports the refresh cookie used by the web app', async () => {
    const user = await registerUser(t.app);
    const login = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.user.email, password: 'password123' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    expect(cookie).toMatch(/^bl_rt=/);
    const refreshed = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } });
    expect(refreshed.statusCode).toBe(200);
  });

  it('resets a forgotten password via the emailed link', async () => {
    const user = await registerUser(t.app);
    await call(t.app, { method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: user.user.email } });
    const mail = t.app.ctx.mailer.outbox!.at(-1)!;
    expect(mail.to).toBe(user.user.email);
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(mail.text)![1]!);
    await call(t.app, { method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'new-password-1' } });
    // Old refresh tokens are revoked, the new password works, the token is single-use.
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: user.refreshToken } })).statusCode).toBe(401);
    await call(t.app, { method: 'POST', url: '/api/v1/auth/login', payload: { email: user.user.email, password: 'new-password-1' } });
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'another-pass-2' } })).statusCode).toBe(400);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await call(t.app, { method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'nobody@example.com' } });
    expect(res).toEqual({ ok: true });
  });

  it('deletes the account and owned workspaces', async () => {
    const user = await registerUser(t.app);
    await call(t.app, { method: 'DELETE', url: '/api/v1/me', headers: user.headers, payload: { password: 'password123' } });
    const login = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.user.email, password: 'password123' } });
    expect(login.statusCode).toBe(401);
  });
});
