import { z } from 'zod';

// Load apps/api/.env when present (Node >= 20.12 has a built-in loader).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env file - rely on the real environment */
}

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool,

  /** Public URL of the web app - used in emails and payment redirects. */
  APP_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),

  /** postgres://user:pass@host:5432/db. When empty, an embedded PGlite database is used. */
  DATABASE_URL: z.string().default(''),
  PGLITE_DIR: z.string().default('./.data/pglite'),
  DB_POOL_MAX: z.coerce.number().int().default(10),
  MIGRATE_ON_START: z
    .enum(['true', 'false', '1', '0', ''])
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').default(DEV_SECRET),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(60),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(15),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool,

  MAIL_FROM: z.string().default('BrickLedger <no-reply@brickledger.app>'),
  /** smtp(s)://user:pass@host:port. When empty, emails are written to the log. */
  SMTP_URL: z.string().default(''),

  BILLING_PROVIDER: z.enum(['mock', 'stripe', 'razorpay']).default('mock'),
  PRICING_CURRENCY: z.enum(['INR', 'USD']).default('INR'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_PRO_MONTH: z.string().default(''),
  STRIPE_PRICE_PRO_YEAR: z.string().default(''),
  STRIPE_PRICE_BUSINESS_MONTH: z.string().default(''),
  STRIPE_PRICE_BUSINESS_YEAR: z.string().default(''),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  RAZORPAY_PLAN_PRO_MONTH: z.string().default(''),
  RAZORPAY_PLAN_PRO_YEAR: z.string().default(''),
  RAZORPAY_PLAN_BUSINESS_MONTH: z.string().default(''),
  RAZORPAY_PLAN_BUSINESS_YEAR: z.string().default(''),

  /** Serve the built web app (apps/web/dist) from this server - single-container deploys. */
  SERVE_WEB: bool,
  WEB_DIST: z.string().default('../web/dist'),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(20),
  /** Timezone that decides when a "day" starts in the admin panel's stats. */
  STATS_TIMEZONE: z.string().default('Asia/Kolkata'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(overrides: Partial<Record<keyof Config, unknown>> = {}): Config {
  const merged: Record<string, unknown> = { ...process.env };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) merged[k] = String(v);
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    if (config.JWT_SECRET === DEV_SECRET) throw new Error('Set a strong JWT_SECRET in production.');
    if (!config.DATABASE_URL) {
      // Allowed (e.g. single-node trials) but worth flagging loudly.
      console.warn('[config] DATABASE_URL is empty - using embedded PGlite. Use PostgreSQL for production workloads.');
    }
  }
  return config;
}
