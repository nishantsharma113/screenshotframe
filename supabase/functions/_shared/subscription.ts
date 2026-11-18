// Turns a Razorpay subscription into profile billing state. Used by the webhook AND by the
// checkout "verify" step, so both paths always agree. The subscription entity (fetched from
// Razorpay or delivered in a signature-checked webhook) is the source of truth — never the client.
import { isInterval, isPaidPlan, PAID_PLANS, INTERVALS, razorpayPlanEnv, type BillingInterval, type PaidPlanId, type PlanId } from './plans.ts';
import type { RazorpaySubscription } from './razorpay.ts';

export type PlanStatus = 'none' | 'active' | 'past_due' | 'halted' | 'cancelled' | 'expired';

export interface BillingProfile {
  id: string;
  plan: PlanId;
  plan_status: PlanStatus;
  plan_renews_at: string | null;
  plan_interval: BillingInterval | null;
  cancel_at_period_end: boolean;
  razorpay_subscription_id: string | null;
  pending_subscription_id: string | null;
  scheduled_change: string | null;
  billing_updated_at: string | null;
}

export type ProfilePatch = Partial<Omit<BillingProfile, 'id'>> & { razorpay_customer_id?: string | null };

export interface InvoiceRow {
  id: string;
  user_id: string;
  subscription_id: string;
  invoice_id: string | null;
  plan: string | null;
  amount: number;
  currency: string;
  status: string;
  receipt_url: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string;
}

/** Storage the billing functions need. index.ts implements it with the service-role client. */
export interface BillingStore {
  profileById(id: string): Promise<BillingProfile | null>;
  /** The profile whose live OR pending subscription is `subscriptionId`. */
  profileBySubscription(subscriptionId: string): Promise<BillingProfile | null>;
  updateProfile(id: string, patch: ProfilePatch): Promise<void>;
  eventSeen(id: string): Promise<boolean>;
  recordEvent(id: string, event: string, payload: unknown): Promise<void>;
  upsertInvoice(row: InvoiceRow): Promise<void>;
}

export type Env = (name: string) => string | undefined;

/** Razorpay plan id for one of our plans (from env), or null if not configured. */
export const razorpayPlanId = (env: Env, plan: PaidPlanId, interval: BillingInterval) => env(razorpayPlanEnv(plan, interval)) || null;

/** Which of our plans a Razorpay plan id is (reverse of the env mapping). */
export function planForRazorpayPlan(env: Env, razorpayPlan: string): { plan: PaidPlanId; interval: BillingInterval } | null {
  for (const plan of PAID_PLANS) {
    for (const interval of INTERVALS) {
      if (razorpayPlan && razorpayPlanId(env, plan, interval) === razorpayPlan) return { plan, interval };
    }
  }
  return null;
}

/** Razorpay subscription status → our plan_status. null = not live yet (checkout not finished). */
export function statusFrom(s: RazorpaySubscription['status']): PlanStatus | null {
  switch (s) {
    case 'active':
      return 'active';
    case 'pending': // a renewal charge failed; Razorpay is retrying
      return 'past_due';
    case 'halted': // all retries failed
    case 'paused':
      return 'halted';
    case 'cancelled':
      return 'cancelled';
    case 'completed':
    case 'expired':
      return 'expired';
    default: // created, authenticated: payment not confirmed yet
      return null;
  }
}

const iso = (unixSeconds: number | null | undefined) => (unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null);

export const userIdFromNotes = (sub: RazorpaySubscription): string | null => {
  const notes = sub.notes;
  return notes && !Array.isArray(notes) && typeof notes.user_id === 'string' ? notes.user_id : null;
};

export type ApplyResult = 'applied' | 'stale' | 'unknown_subscription' | 'not_live' | 'unknown_plan' | 'user_mismatch';

/**
 * Applies a subscription's current state to its owner's profile.
 * `eventAt`: when Razorpay produced this state (webhook created_at); older states are ignored,
 * so retried / out-of-order webhooks can't roll a profile back.
 */
export async function applySubscription(store: BillingStore, env: Env, sub: RazorpaySubscription, eventAt: Date): Promise<ApplyResult> {
  const profile = await store.profileBySubscription(sub.id);
  if (!profile) return 'unknown_subscription';
  const noteUser = userIdFromNotes(sub);
  if (noteUser && noteUser !== profile.id) return 'user_mismatch';
  if (profile.billing_updated_at && new Date(profile.billing_updated_at) > eventAt) return 'stale';

  const status = statusFrom(sub.status);
  const isPending = profile.pending_subscription_id === sub.id && profile.razorpay_subscription_id !== sub.id;
  if (status === null) return 'not_live'; // checkout started but not paid: change nothing
  if (isPending && status !== 'active') return 'not_live'; // a new checkout that never went live

  const mapped = planForRazorpayPlan(env, sub.plan_id);
  if (!mapped) return 'unknown_plan';

  const patch: ProfilePatch = {
    plan: mapped.plan,
    plan_interval: mapped.interval,
    plan_status: status,
    plan_renews_at: iso(sub.current_end) ?? profile.plan_renews_at,
    razorpay_subscription_id: sub.id,
    billing_updated_at: eventAt.toISOString(),
  };
  if (sub.customer_id) patch.razorpay_customer_id = sub.customer_id;
  if (isPending) {
    // The new checkout went live: it becomes THE subscription.
    patch.pending_subscription_id = null;
    patch.cancel_at_period_end = false;
  }
  if (status === 'cancelled' || status === 'expired' || status === 'halted') patch.cancel_at_period_end = false;
  // A scheduled downgrade has happened once the subscription is on that plan.
  if (profile.scheduled_change === `${mapped.plan}:${mapped.interval}`) patch.scheduled_change = null;
  if (status !== 'active' && status !== 'past_due') patch.scheduled_change = null;

  await store.updateProfile(profile.id, patch);
  return 'applied';
}

export const parseChange = (s: string | null): { plan: PaidPlanId; interval: BillingInterval } | null => {
  const [plan, interval] = (s ?? '').split(':');
  return isPaidPlan(plan) && isInterval(interval) ? { plan, interval } : null;
};
