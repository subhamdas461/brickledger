// Builds BrickLedger for Vercel with the Build Output API. Vercel deploys `.vercel/output` as-is
// when the build command creates it:
//   static/               the web app (apps/web/dist)
//   functions/api.func/   the API as one Node.js function: the bundled server plus only the
//                         node_modules files it actually uses (traced with @vercel/nft)
//   config.json           routing: /api/* -> the function, then static files, then the SPA
//
// Run by Vercel (see vercel.json). Locally: `node scripts/vercel-build.mjs`.
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

// ------------------------------------------------------------------ published Android app
// The /download page links to this file. If it's missing, a request for it would otherwise be
// answered with something else, so stop here: a failed build keeps the last good deployment live.
const apkManifest = join(root, 'apps/web/public/apk/android.json');
if (existsSync(apkManifest)) {
  const { size, versionName } = JSON.parse(readFileSync(apkManifest, 'utf8'));
  const apk = join(root, 'apps/web/public/apk/brickledger.apk');
  const actual = existsSync(apk) ? statSync(apk).size : null;
  if (actual !== size) {
    throw new Error(
      `apps/web/public/apk/brickledger.apk should be ${size} bytes (Android ${versionName}) but is ${actual === null ? 'missing' : `${actual} bytes`}. ` +
        'Run `npm run release:android` and commit the whole apps/web/public/apk folder.',
    );
  }
}

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

// A CommonJS front door: every Node.js launcher can `require` it, whereas loading the ES-module API
// with require() depends on the Node version. It imports the API, and if loading fails it answers
// with the reason (also logged) instead of a bare FUNCTION_INVOCATION_FAILED.
writeFileSync(
  join(fnDir, 'index.cjs'),
  `'use strict';
let loaded;
module.exports = async function handler(req, res) {
  try {
    loaded ??= import('./${entry}').then((m) => m.default);
    return await (await loaded)(req, res);
  } catch (err) {
    loaded = undefined;
    console.error('[vercel] API failed to load', err);
    if (res.headersSent) return res.end();
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: { code: 'LOAD_FAILED', message: String((err && err.message) || err).slice(0, 500) } }));
  }
};
`,
);

writeFileSync(
  join(fnDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.cjs',
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
        // Android app download (published by `npm run release:android`). Same file name for every
        // release, so keep caches short; the version manifest is always revalidated.
        {
          src: '^/apk/brickledger\\.apk$',
          headers: {
            'content-type': 'application/vnd.android.package-archive',
            'content-disposition': 'attachment; filename="BrickLedger.apk"',
            'cache-control': 'public, max-age=300',
          },
          continue: true,
        },
        { src: '^/apk/android\\.json$', headers: { 'cache-control': 'no-cache' }, continue: true },
        { src: '^/(.*)$', headers: webSecurity, continue: true },
        { handle: 'filesystem' },
        // Missing files must be a real 404, not the SPA's HTML under a file's name.
        { src: '^/(?:apk|assets)/.*$', status: 404 },
        // Client-side routes (/app/projects/...) load the SPA.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log(`\n✓ .vercel/output ready: web app + API function (${fileList.size} traced files)`);
