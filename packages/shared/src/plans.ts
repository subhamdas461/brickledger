/**
 * Subscription catalogue. Prices are list prices shown on the pricing page; the
 * actual charge is defined by the price/plan IDs configured in the billing
 * provider (Stripe / Razorpay) - see apps/api/.env.example.
 */

export type PlanId = 'free' | 'pro' | 'business';
export type BillingInterval = 'month' | 'year';
export type PricingCurrency = 'INR' | 'USD';

export interface PlanLimits {
  /** Max live (non-deleted) projects per workspace. null = unlimited. */
  projects: number | null;
  /** Max people with access across the workspace (incl. pending invites). null = unlimited. */
  members: number | null;
  /** Max total uploaded file storage. */
  storageMb: number;
}

export interface PlanFeatures {
  csvExport: boolean;
  pdfReports: boolean;
  /** Your company name/logo on PDF reports, no BrickLedger footer. */
  branding: boolean;
  prioritySupport: boolean;
}

export interface PlanDef {
  id: PlanId;
  name: string;
  tagline: string;
  price: Record<PricingCurrency, { month: number; year: number }>;
  limits: PlanLimits;
  features: PlanFeatures;
  highlights: string[];
  recommended?: boolean;
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Starter',
    tagline: 'For a single home build',
    price: { INR: { month: 0, year: 0 }, USD: { month: 0, year: 0 } },
    limits: { projects: 1, members: 3, storageMb: 500 },
    features: { csvExport: true, pdfReports: false, branding: false, prioritySupport: false },
    highlights: [
      '1 active project',
      'Up to 3 people',
      'Expenses, budget, materials, labour & diary',
      'Offline Android app',
      'CSV export',
      '500 MB for photos & documents',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For owners & small builders',
    price: { INR: { month: 399, year: 3999 }, USD: { month: 7, year: 70 } },
    limits: { projects: 5, members: 15, storageMb: 10 * 1024 },
    features: { csvExport: true, pdfReports: true, branding: false, prioritySupport: false },
    highlights: [
      'Up to 5 projects',
      'Up to 15 people with roles',
      'Professional PDF reports',
      'Payment, stock & deadline alerts',
      '10 GB for photos & documents',
      'Everything in Starter',
    ],
    recommended: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    tagline: 'For contractors & developers',
    price: { INR: { month: 1499, year: 14999 }, USD: { month: 24, year: 240 } },
    limits: { projects: null, members: null, storageMb: 100 * 1024 },
    features: { csvExport: true, pdfReports: true, branding: true, prioritySupport: true },
    highlights: [
      'Unlimited projects & people',
      'Client viewer access per project',
      'White-label PDF reports with your logo',
      'Priority support',
      '100 GB for photos & documents',
      'Everything in Pro',
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'pro', 'business'];

export const TRIAL_DAYS = 14;
export const TRIAL_PLAN: PlanId = 'pro';

export type PlanStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

/**
 * Resolves the plan a workspace is entitled to right now. Trials and paid plans
 * that lapse fall back to the free plan - data is never deleted, creation of new
 * items beyond the free limits is blocked instead.
 */
export function effectivePlanId(org: {
  plan: string;
  planStatus: string;
  trialEndsAt?: string | Date | null;
  currentPeriodEnd?: string | Date | null;
}, now: Date = new Date()): PlanId {
  const plan = (org.plan in PLANS ? org.plan : 'free') as PlanId;
  if (plan === 'free') return 'free';
  if (org.planStatus === 'trialing') {
    const ends = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
    return ends && ends.getTime() > now.getTime() ? plan : 'free';
  }
  if (org.planStatus === 'active') return plan;
  if (org.planStatus === 'past_due') {
    // Grace period: keep features for 7 days after the period end while payment retries.
    const end = org.currentPeriodEnd ? new Date(org.currentPeriodEnd) : null;
    return end && end.getTime() + 7 * 86_400_000 > now.getTime() ? plan : 'free';
  }
  return 'free';
}
