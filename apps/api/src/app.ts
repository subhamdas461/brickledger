import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config';
import type { AppContext } from './context';
import { createDatabase, type Database } from './db/client';
import { TokenService } from './lib/crypto';
import { AppError, unauthorized } from './lib/errors';
import { createMailer, type Mailer } from './lib/mailer';
import { createStorage, type Storage } from './lib/storage';
import { accountRoutes } from './modules/account/routes';
import { authRoutes } from './modules/auth/routes';
import { createBillingProvider, type BillingProvider } from './modules/billing/providers';
import { billingPublicRoutes } from './modules/billing/routes';
import { fileRoutes } from './modules/files/routes';
import { invitePublicRoutes, memberRoutes } from './modules/members/routes';
import { orgRoutes } from './modules/orgs/routes';
import { projectRoutes } from './modules/projects/routes';
import { resourceRoutes } from './modules/resources/routes';
import { syncRoutes } from './modules/sync/routes';

export const VERSION = '1.0.0';

export interface AppOverrides {
  database?: Database;
  storage?: Storage;
  mailer?: Mailer;
  billing?: BillingProvider;
}

export async function createApp(config: Config, overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });

  const database =
    overrides.database ??
    (await createDatabase({ url: config.DATABASE_URL || undefined, pgliteDir: config.PGLITE_DIR, poolMax: config.DB_POOL_MAX }));
  if (config.MIGRATE_ON_START) await database.migrate();

  const ctx: AppContext = {
    config,
    database,
    db: database.db,
    tokens: new TokenService(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_MIN),
    storage: overrides.storage ?? createStorage(config),
    mailer: overrides.mailer ?? createMailer(config, app.log),
    billing: overrides.billing ?? createBillingProvider(config),
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('userId', '');
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const userId = await ctx.tokens.verifyAccess(header.slice(7).trim());
    if (!userId) throw unauthorized('Your session has expired. Please sign in again.');
    req.userId = userId;
  });
  app.addHook('onClose', async () => {
    if (!overrides.database) await database.close();
  });

  // ------------------------------------------------------------ platform plugins
  const https = config.APP_URL.startsWith('https://');
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        ...(https ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: https ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });
  await app.register(cookie);
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

  // ------------------------------------------------------------ errors
  app.setErrorHandler((err: FastifyError & { code?: string }, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    }
    if (err.statusCode === 413 || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'That upload is too large.' } });
    }
    // Postgres errors surfaced by the drivers.
    const pgCode = (err as any).code ?? (err as any).cause?.code;
    if (pgCode === '23505') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'That record already exists.' } });
    if (pgCode === '22P02' || pgCode === '22007' || pgCode === '22008') {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid value in request.' } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  });

  // ------------------------------------------------------------ API
  app.get('/api/health', async () => ({
    status: 'ok',
    version: VERSION,
    db: (await database.ping().catch(() => false)) ? database.driver : 'down',
    storage: ctx.storage.driver,
    billing: ctx.billing.name,
  }));

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(billingPublicRoutes);
      await api.register(invitePublicRoutes);
      await api.register(fileRoutes);
      await api.register(async (priv) => {
        priv.addHook('onRequest', priv.authenticate);
        await priv.register(accountRoutes);
        await priv.register(orgRoutes);
        await priv.register(projectRoutes);
        await priv.register(resourceRoutes);
        await priv.register(syncRoutes);
        await priv.register(memberRoutes);
      });
    },
    { prefix: '/api/v1' },
  );

  // ------------------------------------------------------------ web app (optional single-container deploy)
  const webRoot = resolve(config.WEB_DIST);
  const serveWeb = config.SERVE_WEB && existsSync(resolve(webRoot, 'index.html'));
  if (config.SERVE_WEB && !serveWeb) app.log.warn(`SERVE_WEB is on but ${webRoot}/index.html was not found - build the web app first.`);
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      setHeaders(res, path) {
        const value = /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
        const r = res as unknown as { header?: (k: string, v: string) => void; setHeader?: (k: string, v: string) => void };
        if (typeof r.header === 'function') r.header('Cache-Control', value);
        else r.setHeader?.('Cache-Control', value);
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (serveWeb && req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url.split('?')[0]} not found.` } });
  });

  return app;
}
