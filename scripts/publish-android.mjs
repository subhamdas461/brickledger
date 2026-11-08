// Builds the Android release APK and publishes it on the website's /download page.
//
//   npm run release:android
//
// Writes into apps/web/public/apk/ (served at /apk/... by Vercel or the Docker image):
//   brickledger.apk   the signed release build
//   android.json      version, size and checksum, read by the /download page
//   qr.svg            QR code for <site>/download, so desktop visitors can scan it to their phone
// Then commit and push apps/web/public/apk to deploy it.
//
// Before each new release, raise versionCode (and versionName) in apps/android/app/build.gradle.kts:
// Android only installs an update over the existing app when versionCode is higher.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'apps/android');
const outDir = join(root, 'apps/web/public/apk');
const allowDebug = process.argv.includes('--allow-debug-signing');

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

const gradleFile = readFileSync(join(android, 'app/build.gradle.kts'), 'utf8');
const versionCode = Number(gradleFile.match(/versionCode\s*=\s*(\d+)/)?.[1]);
const versionName = gradleFile.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
const minSdk = Number(gradleFile.match(/minSdk\s*=\s*(\d+)/)?.[1]);
if (!versionCode || !versionName) fail('Could not read versionCode/versionName from apps/android/app/build.gradle.kts.');

const previous = existsSync(join(outDir, 'android.json')) ? JSON.parse(readFileSync(join(outDir, 'android.json'), 'utf8')) : null;
if (previous && previous.versionCode >= versionCode) {
  console.warn(
    `\n! The published app is already versionCode ${previous.versionCode}. Phones that have it won't update to this build\n` +
      '  unless you raise versionCode in apps/android/app/build.gradle.kts first.',
  );
}

// ------------------------------------------------------------------ build
console.log(`\n› Building BrickLedger ${versionName} (${versionCode}) for ${site}`);
const gradlew = join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
execFileSync(process.platform === 'win32' ? `"${gradlew}"` : gradlew, ['assembleRelease', '--console=plain', '-q'], {
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
};
writeFileSync(join(outDir, 'android.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(outDir, 'qr.svg'), await QRCode.toString(`${site}/download`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1c1917', light: '#ffffff' } }));

console.log(`\n✓ Published BrickLedger ${versionName} (${(manifest.size / 1024 / 1024).toFixed(1)} MB) to apps/web/public/apk/`);
console.log('  Commit and push apps/web/public/apk to put it on the website:');
console.log(`    git add apps/web/public/apk && git commit -m "Android ${versionName}" && git push`);
console.log(`  Download page: ${site}/download`);
