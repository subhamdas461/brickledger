/**
 * Vercel entry point. The same Fastify app as `index.ts`, created once per function instance and
 * handed Node requests directly (no `listen`). `scripts/vercel-build.mjs` packages this file as the
 * `/api` function and routes every `/api/*` request to it; the web app is served as static files.
 *
 * Differences from a long-running server, all overridable with environment variables:
 * - DATABASE_URL is required (the function's disk is read-only, so embedded PGlite can't work).
 * - Migrations run during the Vercel build, not on cold start (MIGRATE_ON_START=false).
 * - Uploads are capped at 4 MB, because Vercel rejects request bodies over 4.5 MB.
 * - APP_URL / CORS_ORIGINS default to the project's production domain.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { loadConfig } from './config';

/** Startup problems the site owner can fix in the Vercel settings; shown as-is. */
class SetupError extends Error {}

function siteUrl(): string | undefined {
  if (process.env.APP_URL) return process.env.APP_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

async function start(): Promise<FastifyInstance> {
  if (!process.env.DATABASE_URL) {
    throw new SetupError(
      'DATABASE_URL is not set. Add a PostgreSQL connection string (e.g. from Neon) in Vercel → Settings → Environment Variables, then redeploy.',
    );
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new SetupError('JWT_SECRET is not set. Add a random value of at least 32 characters in Vercel → Settings → Environment Variables, then redeploy.');
  }
  const site = siteUrl();
  const env = process.env;
  const config = loadConfig({
    NODE_ENV: env.NODE_ENV ?? 'production',
    TRUST_PROXY: env.TRUST_PROXY ?? 'true',
    MIGRATE_ON_START: env.MIGRATE_ON_START ?? 'false',
    MAX_UPLOAD_MB: env.MAX_UPLOAD_MB ?? '4',
    DB_POOL_MAX: env.DB_POOL_MAX ?? '3',
    APP_URL: site,
    CORS_ORIGINS: env.CORS_ORIGINS ?? site,
    SERVE_WEB: 'false',
  });
  const app = await createApp(config);
  await app.ready();
  return app;
}

let instance: Promise<FastifyInstance> | undefined;

/**
 * The route may hand the function `/api?__path=v1/...` instead of the original URL; put the
 * original path back so Fastify routes it normally.
 */
function restoreUrl(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.searchParams.get('__path');
  if (path === null) return;
  url.searchParams.delete('__path');
  const query = url.searchParams.toString();
  req.url = `/api/${path.replace(/^\/+/, '')}${query ? `?${query}` : ''}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    instance ??= start();
    const app = await instance;
    restoreUrl(req);
    app.server.emit('request', req, res);
  } catch (err) {
    instance = undefined; // try again on the next request (e.g. once the database is reachable)
    console.error('[vercel] API failed to start', err);
    const message =
      err instanceof SetupError || (err instanceof Error && err.message.startsWith('Invalid configuration'))
        ? err.message
        : 'The server could not start. Check the function logs in the Vercel dashboard.';
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: { code: 'SETUP_REQUIRED', message } }));
  }
}
