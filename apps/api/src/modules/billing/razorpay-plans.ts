import { PLANS, type BillingInterval, type PlanId } from '@brickledger/shared';

type PaidPlan = Exclude<PlanId, 'free'>;

export interface RazorpayPlanSpec {
  /** The setting that holds this plan's Razorpay id. */
  envName: string;
  plan: PaidPlan;
  interval: BillingInterval;
  /** Razorpay amounts are in paise. */
  amountPaise: number;
  name: string;
}

/** The four Razorpay plans, priced from the same catalogue as the pricing page. */
export function razorpayPlanSpecs(): RazorpayPlanSpec[] {
  const plans: PaidPlan[] = ['pro', 'business'];
  const intervals: BillingInterval[] = ['month', 'year'];
  return plans.flatMap((plan) =>
    intervals.map((interval) => ({
      envName: `RAZORPAY_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`,
      plan,
      interval,
      amountPaise: PLANS[plan].price.INR[interval] * 100,
      name: `BrickLedger ${PLANS[plan].name} (${interval === 'month' ? 'monthly' : 'yearly'})`,
    })),
  );
}

export type RazorpayRequest = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<any>;

/**
 * Finds or creates each plan, so running this twice doesn't pile up duplicates. A plan is only
 * reused if its price still matches: changing a price in plans.ts creates a new Razorpay plan
 * rather than changing what existing subscribers pay.
 */
export async function ensureRazorpayPlans(request: RazorpayRequest) {
  const existing: any[] = [];
  for (let skip = 0; ; skip += 100) {
    const page = await request('GET', `plans?count=100&skip=${skip}`);
    existing.push(...page.items);
    if (page.items.length < 100) break;
  }

  const results: { spec: RazorpayPlanSpec; id: string; created: boolean }[] = [];
  for (const spec of razorpayPlanSpecs()) {
    const match = existing.find(
      (p) => p.notes?.app === 'brickledger' && p.notes?.plan === spec.plan && p.notes?.interval === spec.interval && p.item?.amount === spec.amountPaise && p.item?.currency === 'INR',
    );
    if (match) {
      results.push({ spec, id: match.id, created: false });
      continue;
    }
    const created = await request('POST', 'plans', {
      period: spec.interval === 'month' ? 'monthly' : 'yearly',
      interval: 1,
      item: { name: spec.name, amount: spec.amountPaise, currency: 'INR' },
      notes: { app: 'brickledger', plan: spec.plan, interval: spec.interval },
    });
    results.push({ spec, id: created.id, created: true });
  }
  return results;
}
