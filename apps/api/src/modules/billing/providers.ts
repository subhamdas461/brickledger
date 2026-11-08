import type { BillingInterval, PlanId, PlanStatus } from '@brickledger/shared';
import type { Config } from '../../config';
import { hmacHex, safeEqual } from '../../lib/crypto';
import { AppError, badRequest } from '../../lib/errors';

export type ProviderName = 'mock' | 'stripe' | 'razorpay';
type PaidPlan = Exclude<PlanId, 'free'>;

export interface CheckoutParams {
  org: { id: string; name: string; billingCustomerId: string | null };
  user: { email: string; name: string };
  plan: PaidPlan;
  interval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
}

/** Provider event normalised to what the workspace record needs. */
export interface BillingEvent {
  id: string;
  type: string;
  ignored?: boolean;
  orgId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  plan?: PaidPlan | null;
  interval?: BillingInterval | null;
  status?: PlanStatus | null;
  currentPeriodEnd?: Date | null;
}

export interface BillingProvider {
  readonly name: ProviderName;
  createCheckout(params: CheckoutParams): Promise<{ url: string }>;
  /** Self-service portal (Stripe). Providers without one return null. */
  createPortal(org: { billingCustomerId: string | null }, returnUrl: string): Promise<{ url: string } | null>;
  cancel(org: { billingSubscriptionId: string | null }): Promise<void>;
  /** Verifies the signature and normalises the payload. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): BillingEvent;
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

const isPaidPlan = (v: unknown): v is PaidPlan => v === 'pro' || v === 'business';
const isInterval = (v: unknown): v is BillingInterval => v === 'month' || v === 'year';
const fromUnix = (s: unknown) => (typeof s === 'number' && s > 0 ? new Date(s * 1000) : null);

// ---------------------------------------------------------------- mock (development / demos)

export class MockProvider implements BillingProvider {
  readonly name = 'mock' as const;
  async createCheckout(params: CheckoutParams) {
    // The route activates the plan immediately for the mock provider; just send the user back.
    return { url: params.successUrl };
  }
  async createPortal() {
    return null;
  }
  async cancel() {}
  parseWebhook(): BillingEvent {
    throw badRequest('The mock billing provider does not accept webhooks.');
  }
}

// ---------------------------------------------------------------- Stripe (REST, no SDK)

export class StripeProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  constructor(private readonly config: Config) {
    if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required when BILLING_PROVIDER=stripe');
  }

  private priceId(plan: PaidPlan, interval: BillingInterval): string {
    const c = this.config;
    const map: Record<PaidPlan, Record<BillingInterval, string>> = {
      pro: { month: c.STRIPE_PRICE_PRO_MONTH, year: c.STRIPE_PRICE_PRO_YEAR },
      business: { month: c.STRIPE_PRICE_BUSINESS_MONTH, year: c.STRIPE_PRICE_BUSINESS_YEAR },
    };
    const id = map[plan][interval];
    if (!id) throw badRequest(`No Stripe price configured for ${plan}/${interval}.`);
    return id;
  }

  private planForPrice(priceId: string | undefined): { plan: PaidPlan; interval: BillingInterval } | null {
    if (!priceId) return null;
    const c = this.config;
    const table: [string, PaidPlan, BillingInterval][] = [
      [c.STRIPE_PRICE_PRO_MONTH, 'pro', 'month'],
      [c.STRIPE_PRICE_PRO_YEAR, 'pro', 'year'],
      [c.STRIPE_PRICE_BUSINESS_MONTH, 'business', 'month'],
      [c.STRIPE_PRICE_BUSINESS_YEAR, 'business', 'year'],
    ];
    const hit = table.find(([id]) => id && id === priceId);
    return hit ? { plan: hit[1], interval: hit[2] } : null;
  }

  private async call(path: string, form: URLSearchParams): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(502, 'INTERNAL', `Stripe: ${json?.error?.message ?? res.statusText}`);
    return json;
  }

  async createCheckout(p: CheckoutParams) {
    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('line_items[0][price]', this.priceId(p.plan, p.interval));
    form.set('line_items[0][quantity]', '1');
    form.set('success_url', p.successUrl);
    form.set('cancel_url', p.cancelUrl);
    form.set('client_reference_id', p.org.id);
    form.set('allow_promotion_codes', 'true');
    for (const [k, v] of Object.entries({ orgId: p.org.id, plan: p.plan, interval: p.interval })) {
      form.set(`metadata[${k}]`, v);
      form.set(`subscription_data[metadata][${k}]`, v);
    }
    if (p.org.billingCustomerId) form.set('customer', p.org.billingCustomerId);
    else form.set('customer_email', p.user.email);
    const session = await this.call('checkout/sessions', form);
    return { url: session.url as string };
  }

  async createPortal(org: { billingCustomerId: string | null }, returnUrl: string) {
    if (!org.billingCustomerId) return null;
    const form = new URLSearchParams({ customer: org.billingCustomerId, return_url: returnUrl });
    const session = await this.call('billing_portal/sessions', form);
    return { url: session.url as string };
  }

  async cancel(org: { billingSubscriptionId: string | null }) {
    if (!org.billingSubscriptionId) return;
    await this.call(`subscriptions/${org.billingSubscriptionId}`, new URLSearchParams({ cancel_at_period_end: 'true' }));
  }

  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): BillingEvent {
    const secret = this.config.STRIPE_WEBHOOK_SECRET;
    const sig = header(headers, 'stripe-signature');
    if (!secret || !sig) throw badRequest('Missing Stripe signature.');
    const parts = Object.fromEntries(
      sig.split(',').map((kv) => {
        const i = kv.indexOf('=');
        return [kv.slice(0, i), kv.slice(i + 1)];
      }),
    );
    const t = Number(parts.t);
    const signatures = sig
      .split(',')
      .filter((kv) => kv.startsWith('v1='))
      .map((kv) => kv.slice(3));
    const expected = hmacHex(secret, `${parts.t}.${rawBody}`);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !signatures.some((s) => safeEqual(s, expected))) {
      throw badRequest('Invalid Stripe signature.');
    }

    const event = JSON.parse(rawBody);
    const obj = event?.data?.object ?? {};
    const base = { id: String(event.id), type: String(event.type) };
    switch (event.type) {
      case 'checkout.session.completed': {
        const md = obj.metadata ?? {};
        return {
          ...base,
          orgId: md.orgId ?? obj.client_reference_id ?? null,
          customerId: obj.customer ?? null,
          subscriptionId: obj.subscription ?? null,
          plan: isPaidPlan(md.plan) ? md.plan : null,
          interval: isInterval(md.interval) ? md.interval : null,
          status: 'active',
        };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const item = obj.items?.data?.[0];
        const byPrice = this.planForPrice(item?.price?.id);
        const md = obj.metadata ?? {};
        const stripeStatus: string = obj.status;
        let status: PlanStatus | null =
          event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : ['active', 'trialing'].includes(stripeStatus)
              ? 'active'
              : ['past_due', 'unpaid'].includes(stripeStatus)
                ? 'past_due'
                : ['canceled', 'incomplete_expired'].includes(stripeStatus)
                  ? 'canceled'
                  : null;
        if (stripeStatus === 'incomplete') status = null;
        return {
          ...base,
          orgId: md.orgId ?? null,
          customerId: obj.customer ?? null,
          subscriptionId: obj.id ?? null,
          plan: byPrice?.plan ?? (isPaidPlan(md.plan) ? md.plan : null),
          interval: byPrice?.interval ?? (isInterval(md.interval) ? md.interval : null),
          status,
          // Newer API versions moved the period end onto subscription items.
          currentPeriodEnd: fromUnix(obj.current_period_end ?? item?.current_period_end),
        };
      }
      case 'invoice.payment_failed':
        return {
          ...base,
          customerId: obj.customer ?? null,
          subscriptionId: obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null,
          status: 'past_due',
        };
      default:
        return { ...base, ignored: true };
    }
  }
}

// ---------------------------------------------------------------- Razorpay (REST, India: UPI/cards/netbanking)

export class RazorpayProvider implements BillingProvider {
  readonly name = 'razorpay' as const;
  constructor(private readonly config: Config) {
    if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when BILLING_PROVIDER=razorpay');
    }
  }

  private planId(plan: PaidPlan, interval: BillingInterval): string {
    const c = this.config;
    const map: Record<PaidPlan, Record<BillingInterval, string>> = {
      pro: { month: c.RAZORPAY_PLAN_PRO_MONTH, year: c.RAZORPAY_PLAN_PRO_YEAR },
      business: { month: c.RAZORPAY_PLAN_BUSINESS_MONTH, year: c.RAZORPAY_PLAN_BUSINESS_YEAR },
    };
    const id = map[plan][interval];
    if (!id) throw badRequest(`No Razorpay plan configured for ${plan}/${interval}.`);
    return id;
  }

  private async call(path: string, body: unknown): Promise<any> {
    const auth = Buffer.from(`${this.config.RAZORPAY_KEY_ID}:${this.config.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(502, 'INTERNAL', `Razorpay: ${json?.error?.description ?? res.statusText}`);
    return json;
  }

  async createCheckout(p: CheckoutParams) {
    const sub = await this.call('subscriptions', {
      plan_id: this.planId(p.plan, p.interval),
      total_count: p.interval === 'month' ? 120 : 10,
      quantity: 1,
      customer_notify: 1,
      notes: { orgId: p.org.id, plan: p.plan, interval: p.interval },
    });
    // Razorpay hosts the payment page for the subscription at short_url.
    return { url: sub.short_url as string };
  }

  async createPortal() {
    return null;
  }

  async cancel(org: { billingSubscriptionId: string | null }) {
    if (!org.billingSubscriptionId) return;
    await this.call(`subscriptions/${org.billingSubscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
  }

  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): BillingEvent {
    const secret = this.config.RAZORPAY_WEBHOOK_SECRET;
    const sig = header(headers, 'x-razorpay-signature');
    if (!secret || !sig || !safeEqual(hmacHex(secret, rawBody), sig)) throw badRequest('Invalid Razorpay signature.');

    const event = JSON.parse(rawBody);
    const sub = event?.payload?.subscription?.entity ?? {};
    const notes = sub.notes ?? {};
    const id = header(headers, 'x-razorpay-event-id') ?? `${event.event}:${sub.id}:${event.created_at}`;
    const statusByEvent: Record<string, PlanStatus> = {
      'subscription.activated': 'active',
      'subscription.charged': 'active',
      'subscription.resumed': 'active',
      'subscription.pending': 'past_due',
      'subscription.halted': 'past_due',
      'subscription.paused': 'past_due',
      'subscription.cancelled': 'canceled',
      'subscription.completed': 'canceled',
    };
    const status = statusByEvent[event.event as string];
    if (!status) return { id, type: String(event.event), ignored: true };
    return {
      id,
      type: String(event.event),
      orgId: notes.orgId ?? null,
      customerId: sub.customer_id ?? null,
      subscriptionId: sub.id ?? null,
      plan: isPaidPlan(notes.plan) ? notes.plan : null,
      interval: isInterval(notes.interval) ? notes.interval : null,
      status,
      currentPeriodEnd: fromUnix(sub.current_end),
    };
  }
}

export function createBillingProvider(config: Config): BillingProvider {
  switch (config.BILLING_PROVIDER) {
    case 'stripe':
      return new StripeProvider(config);
    case 'razorpay':
      return new RazorpayProvider(config);
    default:
      return new MockProvider();
  }
}
