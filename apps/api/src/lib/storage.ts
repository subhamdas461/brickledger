import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Config } from '../config';
import { AppError } from './errors';

export interface StoredObject {
  body: Readable;
  size?: number;
}

/** Blob storage for uploaded files. Keys look like `<projectId>/<fileId>.<ext>`. */
export interface Storage {
  readonly driver: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9/_.-]+$/;

function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`Unsafe storage key: ${key}`);
}

export class LocalStorage implements Storage {
  readonly driver = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Path escapes storage root');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.path(key);
    try {
      const info = await stat(full);
      return { body: createReadStream(full), size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** S3-compatible storage (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces...). */
export class S3Storage implements Storage {
  readonly driver = 's3';
  private clientPromise: Promise<{ client: any; sdk: any }> | null = null;

  constructor(private readonly config: Config) {
    if (!config.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }

  private load() {
    this.clientPromise ??= import('@aws-sdk/client-s3').then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        region: this.config.S3_REGION,
        endpoint: this.config.S3_ENDPOINT || undefined,
        forcePathStyle: this.config.S3_FORCE_PATH_STYLE,
        credentials: this.config.S3_ACCESS_KEY_ID
          ? { accessKeyId: this.config.S3_ACCESS_KEY_ID, secretAccessKey: this.config.S3_SECRET_ACCESS_KEY }
          : undefined,
      }),
    }));
    return this.clientPromise;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    const { client, sdk } = await this.load();
    await client.send(new sdk.PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, Body: data, ContentType: contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    assertKey(key);
    const { client, sdk } = await this.load();
    try {
      const out = await client.send(new sdk.GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
      return { body: out.Body as Readable, size: out.ContentLength };
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    const { client, sdk } = await this.load();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
  }
}

/**
 * Vercel Blob, in a store created as Private: files are never publicly reachable, only through this
 * API's permission checks. The token is passed explicitly because it works on any host, whereas the
 * SDK's default (OIDC) depends on how a function was deployed.
 */
export class VercelBlobStorage implements Storage {
  readonly driver = 'vercel-blob';
  private sdk: Promise<typeof import('@vercel/blob')> | null = null;

  constructor(private readonly token: string) {
    if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required when STORAGE_DRIVER=vercel-blob');
  }

  private load() {
    this.sdk ??= import('@vercel/blob');
    return this.sdk;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    const { put } = await this.load();
    // Re-sending a file keeps its key, so uploads stay idempotent.
    await put(key, data, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: true, token: this.token });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertKey(key);
    const { get } = await this.load();
    const result = await get(key, { access: 'private', token: this.token });
    if (!result) return null;
    return { body: Readable.fromWeb(result.stream as WebReadableStream<Uint8Array>), size: result.blob.size ?? undefined };
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    const { del } = await this.load();
    await del(key, { token: this.token });
  }
}

/**
 * Serverless hosts (Vercel) have a read-only, throwaway disk: refuse uploads with a clear message
 * rather than failing on write or keeping files that vanish on the next cold start.
 */
export class UnavailableStorage implements Storage {
  readonly driver = 'not-configured';

  async put(): Promise<void> {
    throw new AppError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'Photo and document uploads aren’t set up on this server yet. The owner needs to connect a Vercel Blob store, or S3 or Cloudflare R2 storage.',
    );
  }

  async get(): Promise<StoredObject | null> {
    return null;
  }

  async delete(): Promise<void> {}
}

export function createStorage(config: Config): Storage {
  if (config.STORAGE_DRIVER === 's3') return new S3Storage(config);
  if (config.STORAGE_DRIVER === 'vercel-blob') return new VercelBlobStorage(config.BLOB_READ_WRITE_TOKEN);
  // On Vercel, connecting a Blob store with a read-write token is all it takes.
  if (process.env.VERCEL) return config.BLOB_READ_WRITE_TOKEN ? new VercelBlobStorage(config.BLOB_READ_WRITE_TOKEN) : new UnavailableStorage();
  return new LocalStorage(config.UPLOAD_DIR);
}
