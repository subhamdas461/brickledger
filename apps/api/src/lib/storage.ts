import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
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
 * Serverless hosts (Vercel) have a read-only, throwaway disk: refuse uploads with a clear message
 * rather than failing on write or keeping files that vanish on the next cold start.
 */
export class UnavailableStorage implements Storage {
  readonly driver = 'not-configured';

  async put(): Promise<void> {
    throw new AppError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'Photo and document uploads aren’t set up on this server yet. The owner needs to connect S3 or Cloudflare R2 storage (STORAGE_DRIVER=s3).',
    );
  }

  async get(): Promise<StoredObject | null> {
    return null;
  }

  async delete(): Promise<void> {}
}

export function createStorage(config: Config): Storage {
  if (config.STORAGE_DRIVER === 's3') return new S3Storage(config);
  if (process.env.VERCEL) return new UnavailableStorage();
  return new LocalStorage(config.UPLOAD_DIR);
}
