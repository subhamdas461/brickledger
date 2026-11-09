/**
 * Creates the Razorpay plans for your prices and writes every setting the app needs to a git-ignored
 * file, ready to import into Vercel. Safe to run again: existing plans and the webhook secret are kept.
 *
 *   npm run razorpay:setup            test keys (rzp_test_...), writes .env.razorpay-test
 *   npm run razorpay:setup -- --live  live keys (rzp_live_...), writes .env.razorpay-live
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ensureRazorpayPlans, type RazorpayRequest } from '../modules/billing/razorpay-plans';

const live = process.argv.includes('--live');
const mode = live ? 'live' : 'test';
const root = new URL('../../../../', import.meta.url);
const settingsFile = new URL(`.env.razorpay-${mode}`, root);
const settingsPath = fileURLToPath(settingsFile);

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

// Keep what an earlier run saved; the site address only labels the webhook URL below.
for (const file of [settingsFile, new URL('.env.vercel', root)]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function ask(question: string, current: string | undefined): Promise<string> {
  if (current) return current;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

console.log(`Razorpay ${mode} mode setup. Find your keys at Razorpay Dashboard > Account & Settings > API Keys.\n`);
const keyId = await ask('Key ID: ', process.env.RAZORPAY_KEY_ID);
const keySecret = await ask('Key Secret: ', process.env.RAZORPAY_KEY_SECRET);
if (!keyId || !keySecret) fail('Both the Key ID and the Key Secret are needed.');
if (!keyId.startsWith(`rzp_${mode}_`)) {
  fail(live ? 'That isn’t a live key: live keys start with rzp_live_.' : 'That isn’t a test key: test keys start with rzp_test_. This command only uses live keys with --live.');
}

const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
const request: RazorpayRequest = async (method, path, body) => {
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.status === 401) fail('Razorpay rejected these keys. Check the Key ID and Key Secret, and that the dashboard is in the matching mode.');
  if (!res.ok) fail(`Razorpay said: ${json?.error?.description ?? res.statusText}\nIf this mentions Subscriptions, open Subscriptions in the dashboard to switch it on, then run this again.`);
  return json;
};

const plans = await ensureRazorpayPlans(request);
console.log('\nPlans:');
for (const { spec, id, created } of plans) {
  console.log(`  ${created ? 'created ' : 'existing'}  ${spec.name.padEnd(36)} Rs ${String(spec.amountPaise / 100).padStart(6)}  ${id}`);
}

const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || randomBytes(24).toString('base64url');
writeFileSync(
  settingsFile,
  [
    `# Razorpay ${mode} mode settings for BrickLedger, from: npm run razorpay:setup. Git-ignored: keep it private.`,
    'BILLING_PROVIDER=razorpay',
    'PRICING_CURRENCY=INR',
    `RAZORPAY_KEY_ID=${keyId}`,
    `RAZORPAY_KEY_SECRET=${keySecret}`,
    `RAZORPAY_WEBHOOK_SECRET=${webhookSecret}`,
    ...plans.map(({ spec, id }) => `${spec.envName}=${id}`),
    '',
  ].join('\n'),
  { mode: 0o600 },
);

const site = (process.env.APP_URL || 'https://YOUR-SITE').replace(/\/+$/, '');
console.log(`
Settings saved to ${settingsPath}

Next:
1. Razorpay Dashboard (in ${mode === 'test' ? 'Test' : 'Live'} mode) > Account & Settings > Webhooks > Add New Webhook
     URL:     ${site}/api/v1/billing/webhooks/razorpay
     Secret:  the RAZORPAY_WEBHOOK_SECRET value in that file
     Events:  subscription.activated, subscription.charged, subscription.pending, subscription.halted,
              subscription.cancelled, subscription.completed, subscription.paused, subscription.resumed
2. Vercel > Settings > Environment Variables > Import .env, pick that file, choose Production.
3. Redeploy. Your site's plan page now opens Razorpay.`);
