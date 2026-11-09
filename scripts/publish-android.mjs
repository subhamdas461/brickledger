// Builds the Android release APK and publishes it on the website's /download page.
//
//   npm run release:android                         next patch version: 1.0.0 -> 1.0.1 -> 1.0.2
//   npm run release:android -- --minor              1.0.3 -> 1.1.0
//   npm run release:android -- --major              1.1.0 -> 2.0.0
//   npm run release:android -- --notes "Fixed..."   shown in the app's update prompt and on /download
//   npm run release:android -- --no-bump            rebuild the current version (phones won't be prompted)
//
// Writes into apps/web/public/apk/ (served at /apk/... by Vercel or the Docker image):
//   brickledger.apk   the signed release build
//   android.json      version, size and checksum, read by the /download page
//   qr.svg            QR code for <site>/download, so desktop visitors can scan it to their phone
// and raises the version in apps/android/gradle.properties. Commit and push both to deploy: installed
// apps read android.json, see the higher versionCode and offer the update.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'apps/android');
const outDir = join(root, 'apps/web/public/apk');
const args = process.argv.slice(2);
const allowDebug = args.includes('--allow-debug-signing');
const noteIndex = args.indexOf('--notes');
const notes = noteIndex >= 0 ? args[noteIndex + 1]?.trim() || undefined : undefined;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------ checks
const props = readFileSync(join(android, 'gradle.properties'), 'utf8');
const site = props.match(/^brickledger\.productionUrl=(.+)$/m)?.[1]?.trim().replace(/\/+$/, '');
if (!site) fail('Set brickledger.productionUrl in apps/android/gradle.properties (your live site, e.g. https://your-project.vercel.app).');

if (!existsSync(join(android, 'keystore.properties')) && !allowDebug) {
  fail(
    'No release signing key (apps/android/keystore.properties + release.jks).\n' +
      '  Updates only install over an app signed with the same key, so publish with a real key.\n' +
      '  See README "Android release" - or pass --allow-debug-signing for a throwaway test build.',
  );
}

const minSdk = Number(readFileSync(join(android, 'app/build.gradle.kts'), 'utf8').match(/minSdk\s*=\s*(\d+)/)?.[1]);

// ------------------------------------------------------------------ next version
const currentCode = Number(props.match(/^brickledger\.versionCode=(\d+)/m)?.[1]);
const currentName = props.match(/^brickledger\.versionName=(.+)$/m)?.[1]?.trim();
if (!currentCode || !currentName) fail('Could not read brickledger.versionCode/versionName from apps/android/gradle.properties.');

function nextName(name) {
  const [major = 0, minor = 0, patch = 0] = name.split('.').map(Number);
  if (args.includes('--major')) return `${major + 1}.0.0`;
  if (args.includes('--minor')) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
const previous = existsSync(join(outDir, 'android.json')) ? JSON.parse(readFileSync(join(outDir, 'android.json'), 'utf8')) : null;
const bump = !args.includes('--no-bump');
const versionName = bump ? nextName(currentName) : currentName;
// Android only updates to a higher versionCode, so never reuse or go below a published one.
const versionCode = bump ? Math.max(currentCode, previous?.versionCode ?? 0) + 1 : currentCode;
if (!bump && previous?.versionCode === versionCode) {
  console.warn(`\n! Rebuilding ${versionName} without a new version: phones that already have it won't be offered this build.`);
}

// ------------------------------------------------------------------ build
console.log(`\n› Building BrickLedger ${versionName} (${versionCode}) for ${site}`);
const gradlew = join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const gradleArgs = ['assembleRelease', '--console=plain', '-q', `-Pbrickledger.versionCode=${versionCode}`, `-Pbrickledger.versionName=${versionName}`];
execFileSync(process.platform === 'win32' ? `"${gradlew}"` : gradlew, gradleArgs, {
  cwd: android,
  stdio: 'inherit',
  shell: process.platform === 'win32', // .bat files need a shell on Windows
});

const apk = join(android, 'app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) fail(`Build finished but ${apk} is missing.`);

// ------------------------------------------------------------------ publish
mkdirSync(outDir, { recursive: true });
copyFileSync(apk, join(outDir, 'brickledger.apk'));
const bytes = readFileSync(apk);
const manifest = {
  versionName,
  versionCode,
  size: statSync(apk).size,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  minAndroid: { 24: '7.0', 26: '8.0', 28: '9', 29: '10', 30: '11' }[minSdk] ?? `API ${minSdk}`,
  url: '/apk/brickledger.apk',
  publishedAt: new Date().toISOString(),
  ...(notes ? { notes } : {}),
};
writeFileSync(join(outDir, 'android.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(outDir, 'qr.svg'), await QRCode.toString(`${site}/download`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1c1917', light: '#ffffff' } }));

// The build succeeded: record the new version.
writeFileSync(
  join(android, 'gradle.properties'),
  props.replace(/^brickledger\.versionCode=.*$/m, `brickledger.versionCode=${versionCode}`).replace(/^brickledger\.versionName=.*$/m, `brickledger.versionName=${versionName}`),
);

console.log(`\n✓ Published BrickLedger ${versionName} (build ${versionCode}, ${(manifest.size / 1024 / 1024).toFixed(1)} MB) to apps/web/public/apk/`);
console.log('  Commit and push to put it on the website and offer it to installed apps:');
console.log(`    git add apps/web/public/apk apps/android/gradle.properties && git commit -m "Android ${versionName}" && git push`);
console.log(`  Download page: ${site}/download`);
