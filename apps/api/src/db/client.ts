import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
/** Driver-agnostic Drizzle handle (node-postgres in production, PGlite locally/tests). */
export type DB = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
/** A DB handle or an open transaction - helpers accept either. */
export type Executor = DB | Tx;

export interface Database {
  db: DB;
  driver: 'pg' | 'pglite';
  migrate(): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

function migrationsFolder(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(process.cwd(), 'drizzle'),
    fileURLToPath(new URL('../drizzle', import.meta.url)),
    fileURLToPath(new URL('../../drizzle', import.meta.url)),
  ].filter(Boolean) as string[];
  const found = candidates.find((dir) => existsSync(resolve(dir, 'meta', '_journal.json')));
  if (!found) throw new Error(`Migrations folder not found. Looked in:\n${candidates.join('\n')}`);
  return found;
}

export async function createDatabase(opts: { url?: string; pgliteDir?: string; poolMax?: number }): Promise<Database> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: opts.poolMax ?? 10 });
    const db = drizzlePg(pool, { schema });
    return {
      db: db as unknown as DB,
      driver: 'pg',
      migrate: () => migratePg(db, { migrationsFolder: migrationsFolder() }),
      ping: async () => {
        await pool.query('select 1');
        return true;
      },
      close: () => pool.end(),
    };
  }

  const dir = opts.pgliteDir ?? 'memory://';
  if (dir !== 'memory://' && !dir.startsWith('idb://')) mkdirSync(dir, { recursive: true });
  const client = dir === 'memory://' ? new PGlite() : new PGlite(dir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  return {
    db: db as unknown as DB,
    driver: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder: migrationsFolder() }),
    ping: async () => {
      await client.query('select 1');
      return true;
    },
    close: () => client.close(),
  };
}

/** Rows from a raw `db.execute(sql...)` call, for both drivers. */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
