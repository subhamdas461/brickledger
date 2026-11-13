import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { files as filesTable } from '../src/db/schema';
import { RazorpayProvider, StripeProvider } from '../src/modules/billing/providers';
import { applyBillingEvent } from '../src/modules/billing/service';
import { addMember, buildTestApp, call, createProject, multipart, registerUser, type TestApp, type TestUser } from './helpers';

let t: TestApp;
let owner: TestUser;

beforeAll(async () => {
  t = await buildTestApp();
  owner = await registerUser(t.app, 'Owner');
});
afterAll(async () => t.close());

describe('billing', () => {
  it('lists plans publicly', async () => {
    const plans = await call(t.app, { method: 'GET', url: '/api/v1/billing/plans' });
    expect(plans.plans.map((p: any) => p.id)).toEqual(['free', 'pro', 'business']);
    expect(plans.trialDays).toBe(14);
  });

  it('upgrades instantly with the mock provider and cancels back to free', async () => {
    const orgId = owner.orgs[0]!.id;
    const res = await call(t.app, { method: 'POST', url: `/api/v1/orgs/${orgId}/billing/checkout`, headers: owner.headers, payload: { plan: 'business', interval: 'year' } });
    expect(res.url).toContain('checkout=success');
    const org = await call(t.app, { method: 'GET', url: `/api/v1/orgs/${orgId}`, headers: owner.headers });
    expect(org).toMatchObject({ plan: 'business', effectivePlan: 'business', planStatus: 'active', planInterval: 'year' });
    expect(org.limits.projects).toBeNull();
    const canceled = await call(t.app, { method: 'POST', url: `/api/v1/orgs/${orgId}/billing/cancel`, headers: owner.headers });
    expect(canceled.effectivePlan).toBe('free');
  });

  it('verifies Stripe webhook signatures and applies events idempotently', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_PRO_MONTH: 'price_pro_m',
    });
    const stripe = new StripeProvider(config);
    const orgId = owner.orgs[0]!.id;
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { orgId }, items: { data: [{ price: { id: 'price_pro_m' }, current_period_end: 2_000_000_000 }] } } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex');
    const event = stripe.parseWebhook(body, { 'stripe-signature': `t=${ts},v1=${sig}` });
    expect(event).toMatchObject({ orgId, plan: 'pro', interval: 'month', status: 'active', subscriptionId: 'sub_1' });
    expect(() => stripe.parseWebhook(body, { 'stripe-signature': `t=${ts},v1=deadbeef` })).toThrow();

    expect(await applyBillingEvent(t.database.db, 'stripe', event)).toBe('applied');
    expect(await applyBillingEvent(t.database.db, 'stripe', event)).toBe('duplicate');
    const org = await call(t.app, { method: 'GET', url: `/api/v1/orgs/${orgId}`, headers: owner.headers });
    expect(org).toMatchObject({ effectivePlan: 'pro', hasSubscription: true, billingProvider: 'stripe' });
  });

  it('verifies Razorpay webhook signatures', () => {
    const config = loadConfig({ NODE_ENV: 'test', RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret', RAZORPAY_WEBHOOK_SECRET: 'rzp_whsec' });
    const rzp = new RazorpayProvider(config);
    const body = JSON.stringify({
      event: 'subscription.charged',
      created_at: 1,
      payload: { subscription: { entity: { id: 'sub_R1', customer_id: 'cust_1', current_end: 2_000_000_000, notes: { orgId: 'o1', plan: 'business', interval: 'month' } } } },
    });
    const sig = createHmac('sha256', 'rzp_whsec').update(body).digest('hex');
    expect(rzp.parseWebhook(body, { 'x-razorpay-signature': sig })).toMatchObject({ orgId: 'o1', plan: 'business', status: 'active' });
    expect(() => rzp.parseWebhook(body, { 'x-razorpay-signature': 'bad' })).toThrow();
  });
});

describe('files', () => {
  // 1x1 transparent PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

  it('uploads, serves via signed URL or bearer token, and deletes', async () => {
    const project = await createProject(t.app, owner, { useTemplates: false });
    const form = multipart({ name: 'Plinth photo', entityType: 'log' }, { name: 'plinth.png', type: 'image/png', content: png });
    const file = await call(t.app, { method: 'POST', url: `/api/v1/projects/${project.id}/files`, headers: { ...owner.headers, ...form.headers }, payload: form.payload, expect: 201 });
    expect(file).toMatchObject({ name: 'Plinth photo', category: 'photo', mimeType: 'image/png', sizeBytes: png.length });
    expect(file.storageKey).toBeUndefined();

    const signed = await t.app.inject({ method: 'GET', url: file.url });
    expect(signed.statusCode).toBe(200);
    expect(signed.rawPayload.equals(png)).toBe(true);
    const bearer = await t.app.inject({ method: 'GET', url: `/api/v1/files/${file.id}/content`, headers: owner.headers });
    expect(bearer.statusCode).toBe(200);
    const anon = await t.app.inject({ method: 'GET', url: `/api/v1/files/${file.id}/content` });
    expect(anon.statusCode).toBe(401);
    const tampered = await t.app.inject({ method: 'GET', url: file.url.replace(/sig=[^&]+/, 'sig=abc') });
    expect(tampered.statusCode).toBe(401);

    await call(t.app, { method: 'DELETE', url: `/api/v1/projects/${project.id}/files/${file.id}`, headers: owner.headers });
    expect((await t.app.inject({ method: 'GET', url: file.url })).statusCode).toBe(404);
  });

  it('replaces a file’s content, keeping its details, and only for the right people', async () => {
    const manager = await registerUser(t.app, 'Manager'); // fresh trial: the shared manager is on the free plan by now
    const project = await createProject(t.app, manager, { useTemplates: false, name: 'Replace test' });
    const url = (path: string) => `/api/v1/projects/${project.id}${path}`;
    const upload = async (user: TestUser, name: string) => {
      const form = multipart({ name, entityType: 'expense', category: 'receipt', notes: 'GST bill' }, { name: 'bill.png', type: 'image/png', content: png });
      return call(t.app, { method: 'POST', url: url('/files'), headers: { ...user.headers, ...form.headers }, payload: form.payload, expect: 201 });
    };
    const replace = (user: TestUser, fileId: string, file: { name: string; type: string; content: Buffer }) => {
      const form = multipart({}, file);
      return t.app.inject({ method: 'PUT', url: url(`/files/${fileId}/content`), headers: { ...user.headers, ...form.headers }, payload: form.payload });
    };
    const stored = async (fileId: string) => (await t.database.db.select().from(filesTable).where(eq(filesTable.id, fileId)))[0]!;

    const bill = await upload(manager, 'Cement bill');
    const before = await stored(bill.id);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const res = await replace(manager, bill.id, { name: 'scan.pdf', type: 'application/pdf', content: pdf });
    expect(res.statusCode).toBe(200);
    const replaced = res.json();
    expect(replaced).toMatchObject({ id: bill.id, name: 'Cement bill', category: 'receipt', notes: 'GST bill', entityType: 'expense', fileName: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length });
    expect(replaced.storageKey).toBeUndefined();
    expect(replaced.url).not.toBe(bill.url); // caches can't serve the old bill
    const served = await t.app.inject({ method: 'GET', url: replaced.url });
    expect(served.rawPayload.equals(pdf)).toBe(true);

    const after = await stored(bill.id);
    expect(after.storageKey).not.toBe(before.storageKey);
    expect(await t.app.ctx.storage.get(before.storageKey)).toBeNull(); // old copy removed
    expect(Number(after.serverSeq)).toBeGreaterThan(Number(before.serverSeq)); // phones pick it up on sync

    const contributor = await registerUser(t.app, 'Site Engineer');
    const viewer = await registerUser(t.app, 'Client');
    await addMember(t.app, manager, project.id, contributor, 'contributor');
    await addMember(t.app, manager, project.id, viewer, 'viewer');
    const photo = { name: 'retake.png', type: 'image/png', content: png };
    expect((await replace(contributor, bill.id, photo)).statusCode).toBe(403);
    expect((await replace(viewer, bill.id, photo)).statusCode).toBe(403);
    const own = await upload(contributor, 'Sand bill');
    expect((await replace(contributor, own.id, photo)).statusCode).toBe(200);

    // A rejected upload leaves the bill as it was.
    expect((await replace(manager, bill.id, { name: 'x.html', type: 'text/html', content: Buffer.from('<b>') })).statusCode).toBe(400);
    expect((await stored(bill.id)).storageKey).toBe(after.storageKey);
    expect((await replace(manager, '00000000-0000-4000-8000-000000000000', photo)).statusCode).toBe(404);

    const activity = await call(t.app, { method: 'GET', url: url('/activity'), headers: manager.headers });
    expect(JSON.stringify(activity)).toContain('Replaced file \\"Cement bill\\"');
  });

  it('rejects unsafe file types', async () => {
    const project = await createProject(t.app, owner, { useTemplates: false, name: 'Another' }).catch(async () => {
      const list = await call(t.app, { method: 'GET', url: '/api/v1/projects', headers: owner.headers });
      return list[0];
    });
    const form = multipart({}, { name: 'evil.html', type: 'text/html', content: Buffer.from('<script>alert(1)</script>') });
    const res = await t.app.inject({ method: 'POST', url: `/api/v1/projects/${project.id}/files`, headers: { ...owner.headers, ...form.headers }, payload: form.payload });
    expect(res.statusCode).toBe(400);
  });
});
