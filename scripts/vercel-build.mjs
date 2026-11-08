// Builds BrickLedger for Vercel with the Build Output API. Vercel deploys `.vercel/output` as-is
// when the build command creates it:
//   static/               the web app (apps/web/dist)
//   functions/api.func/   the API as one Node.js function: the bundled server plus only the
//                         node_modules files it actually uses (traced with @vercel/nft)
//   config.json           routing: /api/* -> the function, then static files, then the SPA
//
// Run by Vercel (see vercel.json). Locally: `node scripts/vercel-build.mjs`.
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel', 'output');
const fnDir = join(out, 'functions', 'api.func');
const entry = 'apps/api/dist/vercel.js';
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const flag = (name) => /^(1|true|yes)$/i.test(process.env[name] ?? '');

// ------------------------------------------------------------------ build
console.log('\n› Building the web app');
run('npm run build --workspace @brickledger/web');
console.log('\n› Building the API');
run('npm run build --workspace @brickledger/api');

// ------------------------------------------------------------------ database migrations
// Production deploys only by default: preview builds may point at the same database.
const migrate = process.env.MIGRATE_ON_BUILD ? flag('MIGRATE_ON_BUILD') : process.env.VERCEL_ENV === 'production';
if (!process.env.DATABASE_URL) {
  console.warn('\n! DATABASE_URL is not set: skipping migrations. The API will show a setup message until it is set.');
} else if (migrate) {
  console.log('\n› Applying database migrations');
  // Runtime-only checks (e.g. JWT_SECRET) don't apply to a one-off migration.
  run('node apps/api/dist/migrate.js', { NODE_ENV: 'development' });
} else {
  console.log('\n› Skipping migrations (not a production deploy; set MIGRATE_ON_BUILD=true to run them here)');
}

// ------------------------------------------------------------------ package .vercel/output
console.log('\n› Packaging .vercel/output');
rmSync(out, { recursive: true, force: true });
mkdirSync(fnDir, { recursive: true });
cpSync(join(root, 'apps/web/dist'), join(out, 'static'), { recursive: true });

const { fileList, warnings } = await nodeFileTrace([join(root, entry)], { base: root });
// Optional pg add-ons that are never loaded on Node.js.
const ignorable = /Failed to resolve dependency "(pg-native|cloudflare:sockets)"/;
for (const w of warnings) if (!ignorable.test(String(w.message))) console.warn(`  trace: ${w.message}`);

// Read at runtime through paths the tracer can't follow.
const require = createRequire(join(root, 'apps/api/package.json'));
const pdfkitData = relative(root, join(dirname(require.resolve('pdfkit')), 'data')); // Helvetica & co. metrics
const extras = ['apps/api/package.json', 'apps/api/drizzle', 'apps/api/assets/fonts', pdfkitData];

function copyInto(rel) {
  const src = join(root, rel);
  const dest = join(fnDir, rel);
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  const info = lstatSync(src);
  if (info.isSymbolicLink()) symlinkSync(readlinkSync(src), dest);
  else if (info.isDirectory()) cpSync(src, dest, { recursive: true });
  else copyFileSync(src, dest);
}
for (const rel of fileList) copyInto(rel);
for (const rel of extras) copyInto(rel);

writeFileSync(
  join(fnDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: entry,
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: Number(process.env.API_MAX_DURATION || 30),
      // Put the function next to the database, e.g. FUNCTION_REGION=bom1 (Mumbai) for a Neon ap-south-1 database.
      ...(process.env.FUNCTION_REGION ? { regions: process.env.FUNCTION_REGION.split(',').map((r) => r.trim()) } : {}),
    },
    null,
    2,
  ),
);

// Same headers the API's Helmet setup gives the web app in the single-server (Docker) deploy.
const webSecurity = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'SAMEORIGIN',
  'cross-origin-opener-policy': 'same-origin',
};

writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // API first. The original path also travels as __path, in case the rewrite replaces req.url.
        { src: '^/api(?:/(.*))?$', dest: '/api?__path=$1' },
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/(.*)$', headers: webSecurity, continue: true },
        { handle: 'filesystem' },
        // Client-side routes (/app/projects/...) load the SPA.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log(`\n✓ .vercel/output ready: web app + API function (${fileList.size} traced files)`);
