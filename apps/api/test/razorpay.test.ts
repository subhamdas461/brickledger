import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { organizations } from '../src/db/schema';
import { ensureRazorpayPlans, razorpayPlanSpecs } from '../src/modules/billing/razorpay-plans';
import { buildTestApp, call, registerUser, type TestApp, type TestUser } from './helpers';

const WEBHOOK_SECRET = 'whsec_test';
const realFetch = globalThis.fetch;

describe('Razorpay plans', () => {
  function fakeApi(existing: any[] = []) {
    const created: any[] = [];
    const request = vi.fn(async (method: string, path: string, body?: any) => {
      if (method === 'GET') return { items: [...existing, ...created] };
      const plan = { id: `plan_${created.length + 1}`, ...body };
      created.push(plan);
      return plan;
    });
    return { request, created };
  }

  it('matches the pricing page, in paise', () => {
    expect(razorpayPlanSpecs().map((s) => [s.envName, s.amountPaise])).toEqual([
      ['RAZORPAY_PLAN_PRO_MONTH', 39_900],
      ['RAZORPAY_PLAN_PRO_YEAR', 399_900],
      ['RAZORPAY_PLAN_BUSINESS_MONTH', 149_900],
      ['RAZORPAY_PLAN_BUSINESS_YEAR', 1_499_900],
    ]);
  });

  it('creates the four plans in Razorpay’s format', async () => {
    const { request, created } = fakeApi();
    const results = await ensureRazorpayPlans(request);
    expect(results.every((r) => r.created)).toBe(true);
    expect(created[0]).toMatchObject({ period: 'monthly', interval: 1, item: { name: 'BrickLedger Pro (monthly)', amount: 39_900, currency: 'INR' }, notes: { app: 'brickledger', plan: 'pro', interval: 'month' } });
    expect(created[3]).toMatchObject({ period: 'yearly', interval: 1, item: { amount: 1_499_900 } });
  });

  it('reuses plans on a second run, but not ones with an old price or from elsewhere', async () => {
    const first = fakeApi();
    await ensureRazorpayPlans(first.request);
    const second = fakeApi(first.created);
    expect((await ensureRazorpayPlans(second.request)).some((r) => r.created)).toBe(false);
    expect(second.created).toHaveLength(0);

    const stale = first.created.map((p, i) => (i === 0 ? { ...p, item: { ...p.item, amount: 100 } } : p));
    stale[1] = { ...stale[1], notes: {} };
    const third = fakeApi(stale);
    const results = await ensureRazorpayPlans(third.request);
    expect(results.filter((r) => r.created).map((r) => r.spec.envName)).toEqual(['RAZORPAY_PLAN_PRO_MONTH', 'RAZORPAY_PLAN_PRO_YEAR']);
  });

  it('reads every page of existing plans', async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, notes: [] })), []];
    const request = vi.fn(async (method: string, path: string) => (method === 'GET' ? { items: pages.shift() ?? [] } : { id: path }));
    await ensureRazorpayPlans(request);
    expect(request.mock.calls.filter(([m]) => m === 'GET').map(([, p]) => p)).toEqual(['plans?count=100&skip=0', 'plans?count=100&skip=100']);
  });
});

describe('Razorpay payments', () => {
  let t: TestApp;
  let owner: TestUser;
  let orgId: string;
  /** Calls the app made to Razorpay. */
  let sent: { url: string; body: any }[];
  let failCancel: boolean;
  let eventNo = 0;

  beforeAll(async () => {
    t = await buildTestApp({
      BILLING_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RAZORPAY_PLAN_PRO_MONTH: 'plan_pro_m',
      RAZORPAY_PLAN_PRO_YEAR: 'plan_pro_y',
      RAZORPAY_PLAN_BUSINESS_MONTH: 'plan_biz_m',
      RAZORPAY_PLAN_BUSINESS_YEAR: 'plan_biz_y',
    });
  });
  afterAll(async () => t.close());

  beforeEach(async () => {
    sent = [];
    failCancel = false;
    owner = await registerUser(t.app);
    orgId = owner.orgs[0]!.id;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.razorpay.com/')) return realFetch(input, init);
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      if (url.endsWith('/cancel') && failCancel) return new Response(JSON.stringify({ error: { description: 'Gateway timed out' } }), { status: 500 });
      return new Response(JSON.stringify({ id: 'sub_new', short_url: 'https://rzp.io/i/test123', status: 'created' }), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function webhook(event: string, sub: { id: string; plan: string; interval: string; currentEnd?: number }, headers: Record<string, string> = {}) {
    const payload = JSON.stringify({
      entity: 'event',
      event,
      created_at: 1_790_000_000 + ++eventNo,
      payload: { subscription: { entity: { id: sub.id, customer_id: 'cust_1', status: 'active', current_end: sub.currentEnd ?? 2_000_000_000, notes: { orgId, plan: sub.plan, interval: sub.interval } } } },
    });
    return t.app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex'), ...headers },
      payload,
    });
  }
  /** Subscription ids are unique in real life, and the tests share a database. */
  const sid = (name: string) => `${name}_${orgId.slice(0, 8)}`;
  const org = async () => (await t.database.db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0]!;

  it('starts checkout with the right plan and returns Razorpay’s payment page', async () => {
    const res = await call(t.app, { method: 'POST', url: `/api/v1/orgs/${orgId}/billing/checkout`, headers: owner.headers, payload: { plan: 'business', interval: 'year' } });
    expect(res.url).toBe('https://rzp.io/i/test123');
    expect(sent[0]!.url).toBe('https://api.razorpay.com/v1/subscriptions');
    expect(sent[0]!.body).toMatchObject({ plan_id: 'plan_biz_y', total_count: 10, notes: { orgId, plan: 'business', interval: 'year' } });
  });

  it('activates the paid plan from the webhook and ends the trial', async () => {
    expect((await org()).planStatus).toBe('trialing');
    expect((await webhook('subscription.activated', { id: sid('sub_1'), plan: 'pro', interval: 'month' })).statusCode).toBe(200);
    expect(await org()).toMatchObject({ plan: 'pro', planInterval: 'month', planStatus: 'active', billingProvider: 'razorpay', billingSubscriptionId: sid('sub_1'), billingCustomerId: 'cust_1', trialEndsAt: null });
    await webhook('subscription.charged', { id: sid('sub_1'), plan: 'pro', interval: 'month', currentEnd: 2_100_000_000 });
    expect((await org()).currentPeriodEnd?.getTime()).toBe(2_100_000_000_000);
    expect(sent).toHaveLength(0);
  });

  it('rejects a forged webhook, and applies a redelivered one only once', async () => {
    const forged = await t.app.inject({ method: 'POST', url: '/api/v1/billing/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'bad' }, payload: JSON.stringify({ event: 'subscription.activated' }) });
    expect(forged.statusCode).toBe(400);
    expect((await org()).planStatus).toBe('trialing');

    await webhook('subscription.activated', { id: sid('sub_1'), plan: 'pro', interval: 'month' }, { 'x-razorpay-event-id': `evt_${orgId}` });
    await t.database.db.update(organizations).set({ plan: 'free' }).where(eq(organizations.id, orgId));
    expect((await webhook('subscription.activated', { id: sid('sub_1'), plan: 'pro', interval: 'month' }, { 'x-razorpay-event-id': `evt_${orgId}` })).statusCode).toBe(200);
    expect((await org()).plan).toBe('free');
  });

  it('never bills twice: paying for a new plan ends the old subscription', async () => {
    await webhook('subscription.activated', { id: sid('sub_pro'), plan: 'pro', interval: 'month' });
    await webhook('subscription.activated', { id: sid('sub_biz'), plan: 'business', interval: 'year' });

    expect(sent).toEqual([{ url: `https://api.razorpay.com/v1/subscriptions/${sid('sub_pro')}/cancel`, body: { cancel_at_cycle_end: 0 } }]);
    expect(await org()).toMatchObject({ plan: 'business', planInterval: 'year', planStatus: 'active', billingSubscriptionId: sid('sub_biz') });

    // The old subscription's own later events must not undo the upgrade.
    await webhook('subscription.cancelled', { id: sid('sub_pro'), plan: 'pro', interval: 'month' });
    await webhook('subscription.charged', { id: sid('sub_pro'), plan: 'pro', interval: 'month' });
    expect(await org()).toMatchObject({ plan: 'business', planStatus: 'active', billingSubscriptionId: sid('sub_biz') });
    expect(sent).toHaveLength(1);
  });

  it('asks Razorpay to retry if the old subscription couldn’t be ended', async () => {
    await webhook('subscription.activated', { id: sid('sub_pro'), plan: 'pro', interval: 'month' });
    failCancel = true;
    const failed = await webhook('subscription.activated', { id: sid('sub_biz'), plan: 'business', interval: 'month' }, { 'x-razorpay-event-id': `retry_${orgId}` });
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect((await org()).billingSubscriptionId).toBe(sid('sub_pro'));

    failCancel = false;
    const retried = await webhook('subscription.activated', { id: sid('sub_biz'), plan: 'business', interval: 'month' }, { 'x-razorpay-event-id': `retry_${orgId}` });
    expect(retried.statusCode).toBe(200);
    expect(await org()).toMatchObject({ plan: 'business', billingSubscriptionId: sid('sub_biz') });
  });

  it('handles failed payments and cancellation', async () => {
    await webhook('subscription.activated', { id: sid('sub_1'), plan: 'pro', interval: 'month' });
    await webhook('subscription.pending', { id: sid('sub_1'), plan: 'pro', interval: 'month' });
    expect((await org()).planStatus).toBe('past_due');
    await webhook('subscription.charged', { id: sid('sub_1'), plan: 'pro', interval: 'month' });
    expect((await org()).planStatus).toBe('active');

    await call(t.app, { method: 'POST', url: `/api/v1/orgs/${orgId}/billing/cancel`, headers: owner.headers, payload: {} });
    expect(sent.at(-1)).toEqual({ url: `https://api.razorpay.com/v1/subscriptions/${sid('sub_1')}/cancel`, body: { cancel_at_cycle_end: 1 } });
    expect((await org()).planStatus).toBe('active'); // keeps the paid period
    await webhook('subscription.cancelled', { id: sid('sub_1'), plan: 'pro', interval: 'month' });
    expect((await org()).planStatus).toBe('canceled');
  });

  it('says when it’s in test mode', async () => {
    const plans = await call(t.app, { method: 'GET', url: '/api/v1/billing/plans' });
    expect(plans).toMatchObject({ provider: 'razorpay', testMode: true, currency: 'INR' });
  });
});
