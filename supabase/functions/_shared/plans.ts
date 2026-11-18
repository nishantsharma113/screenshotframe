// ONE source of truth for plans: names, features, limits and what's not built yet.
// Imported by the web app (pricing page, UI gates, Billing page) through the `@shared` alias and by
// the Edge Functions (checkout, webhook). The database limit in 0007_billing.sql must match
// `limits.projects` below — supabase/functions/billing/billing_test.ts fails if they drift.
//
// Prices are NOT here: they come from the Razorpay plans themselves (see the `billing` function,
// action "plans"), so what the pricing page shows is exactly what checkout charges.

export type PlanId = 'basic' | 'standard' | 'extended';
export type PaidPlanId = Exclude<PlanId, 'basic'>;
export type BillingInterval = 'monthly' | 'yearly';

/** Paid features the app gates. Keys are used in code; labels on the pricing page. */
export type Feature = 'angle3d' | 'localization' | 'customFonts' | 'userTemplates' | 'autoTranslate';

export interface PlanConfig {
  id: PlanId;
  name: string;
  blurb: string;
  /** null = unlimited */
  limits: { projects: number | null };
  features: Feature[];
  /** Pricing-page bullet points, in order. `soon` = not built yet: shown as "Coming soon", never sold. */
  bullets: { text: string; soon?: boolean }[];
  popular?: boolean;
}

export const PLAN_ORDER: PlanId[] = ['basic', 'standard', 'extended'];
export const PAID_PLANS: PaidPlanId[] = ['standard', 'extended'];
export const INTERVALS: BillingInterval[] = ['monthly', 'yearly'];

const PAID_FEATURES: Feature[] = ['angle3d', 'localization', 'customFonts', 'userTemplates', 'autoTranslate'];

export const PLANS: Record<PlanId, PlanConfig> = {
  basic: {
    id: 'basic',
    name: 'Basic',
    blurb: 'Everything you need for one app.',
    limits: { projects: 3 },
    features: [],
    bullets: [
      { text: 'Up to 3 cloud projects' },
      { text: 'All devices, portrait and landscape' },
      { text: 'Templates, backgrounds and free positioning' },
      { text: 'Export every store size, plus the Play feature graphic' },
    ],
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    blurb: 'For developers shipping often.',
    limits: { projects: null },
    features: PAID_FEATURES,
    popular: true,
    bullets: [
      { text: 'Everything in Basic' },
      { text: 'Unlimited projects' },
      { text: '3D device angles' },
      { text: 'Languages and auto-translate (50 a day)' },
      { text: 'Custom font upload' },
      { text: 'Saved templates' },
    ],
  },
  extended: {
    id: 'extended',
    name: 'Extended',
    blurb: 'For agencies and teams.',
    limits: { projects: null },
    features: PAID_FEATURES,
    bullets: [
      { text: 'Everything in Standard' },
      { text: 'Priority support' },
      { text: 'API access', soon: true },
      { text: 'Client work license', soon: true },
    ],
  },
};

/** Which plans include a feature (derived, so it can't disagree with PLANS). */
export const plansWith = (feature: Feature): PlanId[] => PLAN_ORDER.filter((p) => PLANS[p].features.includes(feature));

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (PLAN_ORDER as string[]).includes(v);
export const isPaidPlan = (v: unknown): v is PaidPlanId => typeof v === 'string' && (PAID_PLANS as string[]).includes(v);
export const isInterval = (v: unknown): v is BillingInterval => v === 'monthly' || v === 'yearly';

/** Higher index = more expensive. Used to decide upgrade (now) vs downgrade (at period end). */
export const planRank = (p: PlanId) => PLAN_ORDER.indexOf(p);

/** Env var holding the Razorpay plan id for a plan + interval, e.g. RAZORPAY_PLAN_STANDARD_MONTHLY. */
export const razorpayPlanEnv = (plan: PaidPlanId, interval: BillingInterval) =>
  `RAZORPAY_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`;
