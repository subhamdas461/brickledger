import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthResponse } from '@brickledger/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { expect } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase, type Database } from '../src/db/client';

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  close(): Promise<void>;
}

export async function buildTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    DATABASE_URL: '',
    SMTP_URL: '',
    BILLING_PROVIDER: 'mock',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'bl-uploads-')),
    AUTH_RATE_LIMIT_PER_MIN: '1000',
    APP_URL: 'http://app.test',
    ...overrides,
  });
  const database = await createDatabase({ pgliteDir: 'memory://' });
  const app = await createApp(config, { database });
  await app.ready();
  return {
    app,
    database,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

let counter = 0;

export interface TestUser extends AuthResponse {
  headers: { authorization: string };
}

export async function registerUser(app: FastifyInstance, name = 'Test User', extra: Record<string, unknown> = {}): Promise<TestUser> {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.com`;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name, email, password: 'password123', ...extra } });
  expect(res.statusCode, res.body).toBe(201);
  const body = res.json() as AuthResponse;
  return { ...body, headers: { authorization: `Bearer ${body.accessToken}` } };
}

/** inject() wrapper that asserts the status code and returns parsed JSON. */
export async function call<T = any>(app: FastifyInstance, opts: InjectOptions & { expect?: number }): Promise<T> {
  const { expect: status = 200, ...rest } = opts;
  const res = await app.inject(rest);
  expect(res.statusCode, `${rest.method} ${rest.url}: ${res.body}`).toBe(status);
  return (res.headers['content-type']?.toString().includes('application/json') ? res.json() : res.body) as T;
}

export async function createProject(app: FastifyInstance, user: TestUser, payload: Record<string, unknown> = {}) {
  return call(app, {
    method: 'POST',
    url: '/api/v1/projects',
    headers: user.headers,
    payload: { name: 'My House', totalBudget: 1_000_000, startDate: '2026-01-01', targetEndDate: '2026-12-31', ...payload },
    expect: 201,
  });
}

/** Invites `invitee` to a project with a role and accepts the invitation. */
export async function addMember(app: FastifyInstance, manager: TestUser, projectId: string, invitee: TestUser, role: string) {
  const { inviteUrl } = await call(app, {
    method: 'POST',
    url: `/api/v1/projects/${projectId}/invites`,
    headers: manager.headers,
    payload: { email: invitee.user.email, role },
    expect: 201,
  });
  const token = String(inviteUrl).split('/invite/')[1];
  await call(app, { method: 'POST', url: `/api/v1/invites/${token}/accept`, headers: invitee.headers });
}

export function multipart(fields: Record<string, string>, file: { name: string; type: string; content: Buffer }) {
  const boundary = `----bl${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(file.content, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
