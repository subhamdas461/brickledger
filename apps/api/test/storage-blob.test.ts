import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, UnavailableStorage, VercelBlobStorage } from '../src/lib/storage';
import { loadConfig } from '../src/config';
import { buildTestApp, createProject, multipart, registerUser, type TestApp } from './helpers';

/** Behaves like the SDK's documented contract: private access, null for a missing blob, a web stream. */
const blobs = vi.hoisted(() => new Map<string, { data: Buffer; contentType: string }>());
const calls = vi.hoisted(() => [] as { method: string; pathname: string; options: Record<string, unknown> }[]);

vi.mock('@vercel/blob', () => ({
  put: async (pathname: string, data: Buffer, options: Record<string, unknown>) => {
    calls.push({ method: 'put', pathname, options });
    blobs.set(pathname, { data, contentType: String(options.contentType) });
    return { pathname };
  },
  get: async (pathname: string, options: Record<string, unknown>) => {
    calls.push({ method: 'get', pathname, options });
    const blob = blobs.get(pathname);
    if (!blob) return null;
    return { statusCode: 200, stream: new Blob([new Uint8Array(blob.data)]).stream(), headers: new Headers(), blob: { pathname, size: blob.data.length, contentType: blob.contentType } };
  },
  del: async (pathname: string, options: Record<string, unknown>) => {
    calls.push({ method: 'del', pathname, options });
    blobs.delete(pathname);
  },
}));

const TOKEN = 'vercel_blob_rw_test_token';

describe('Vercel Blob storage', () => {
  beforeEach(() => {
    blobs.clear();
    calls.length = 0;
  });

  it('stores privately under the given key and reads the same bytes back', async () => {
    const storage = new VercelBlobStorage(TOKEN);
    await storage.put('project/file.pdf', Buffer.from('hello'), 'application/pdf');
    expect(calls[0]).toMatchObject({ method: 'put', pathname: 'project/file.pdf', options: { access: 'private', contentType: 'application/pdf', addRandomSuffix: false, allowOverwrite: true, token: TOKEN } });

    const found = await storage.get('project/file.pdf');
    expect(found?.size).toBe(5);
    expect(found?.body).toBeInstanceOf(Readable);
    const chunks: Buffer[] = [];
    for await (const chunk of found!.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('hello');
    expect(calls[1]).toMatchObject({ method: 'get', options: { access: 'private', token: TOKEN } });

    expect(await storage.get('project/missing.pdf')).toBeNull();
    await expect(storage.put('../escape', Buffer.from('x'), 'text/plain')).rejects.toThrow(/Unsafe/);
  });

  it('is chosen by setting, or on Vercel simply by having a token', () => {
    const base = { DATABASE_URL: '', NODE_ENV: 'test' } as const;
    expect(createStorage(loadConfig({ ...base, STORAGE_DRIVER: 'vercel-blob', BLOB_READ_WRITE_TOKEN: TOKEN }))).toBeInstanceOf(VercelBlobStorage);
    expect(() => createStorage(loadConfig({ ...base, STORAGE_DRIVER: 'vercel-blob', BLOB_READ_WRITE_TOKEN: '' }))).toThrow(/BLOB_READ_WRITE_TOKEN/);

    vi.stubEnv('VERCEL', '1');
    try {
      expect(createStorage(loadConfig({ ...base, STORAGE_DRIVER: 'local', BLOB_READ_WRITE_TOKEN: TOKEN }))).toBeInstanceOf(VercelBlobStorage);
      expect(createStorage(loadConfig({ ...base, STORAGE_DRIVER: 'local', BLOB_READ_WRITE_TOKEN: '' }))).toBeInstanceOf(UnavailableStorage);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe('through the API', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await buildTestApp({ STORAGE_DRIVER: 'vercel-blob', BLOB_READ_WRITE_TOKEN: TOKEN });
    });
    afterAll(async () => t.close());

    it('uploads, serves only to members, and deletes the blob with the account', async () => {
      const owner = await registerUser(t.app);
      const project = await createProject(t.app, owner);
      const pdf = Buffer.from('%PDF-1.4 site plan');
      const form = multipart({ name: 'Site plan', category: 'drawing' }, { name: 'plan.pdf', type: 'application/pdf', content: pdf });
      const upload = await t.app.inject({ method: 'POST', url: `/api/v1/projects/${project.id}/files`, headers: { ...owner.headers, ...form.headers }, payload: form.payload });
      expect(upload.statusCode).toBe(201);
      const file = upload.json();
      expect(blobs.size).toBe(1);

      const download = await t.app.inject({ method: 'GET', url: `/api/v1/files/${file.id}/content`, headers: owner.headers });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-type']).toContain('application/pdf');
      expect(download.rawPayload.equals(pdf)).toBe(true);

      const stranger = await registerUser(t.app);
      expect((await t.app.inject({ method: 'GET', url: `/api/v1/files/${file.id}/content`, headers: stranger.headers })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await t.app.inject({ method: 'GET', url: `/api/v1/files/${file.id}/content` })).statusCode).toBe(401);

      const health = await t.app.inject({ method: 'GET', url: '/api/health' });
      expect(health.json().storage).toBe('vercel-blob');

      const del = await t.app.inject({ method: 'DELETE', url: '/api/v1/me', headers: owner.headers, payload: { password: 'password123' } });
      expect(del.statusCode).toBe(200);
      expect(blobs.size).toBe(0);
    });
  });
});
