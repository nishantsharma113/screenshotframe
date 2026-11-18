// `billing` Edge Function: prices, checkout, post-checkout verification, plan change and cancel.
// All plan/billing writes happen here or in billing-webhook — the browser can only ask.
import {
  INTERVALS,
  PAID_PLANS,
  PLANS,
  isInterval,
  isPaidPlan,
  planRank,
  type BillingInterval,
  type PaidPlanId,
} from '../_shared/plans.ts';
import { RazorpayError, verifyCheckoutSignature, type Razorpay } from '../_shared/razorpay.ts';
import { applySubscription, razorpayPlanId, type BillingStore, type Env } from '../_shared/subscription.ts';

export interface BillingDeps {
  store: BillingStore;
  env: Env;
  razorpay: Pick<Razorpay, 'getPlan' | 'createSubscription' | 'getSubscription' | 'updateSubscription' | 'cancelAtPeriodEnd'> | null;
  /** Verifies the caller's JWT with Supabase Auth; null if missing/invalid. */
  userFrom(authHeader: string | null): Promise<{ id: string; email?: string } | null>;
  now?: () => Date;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => json(status, { error });

/** Subscriptions renew until cancelled; Razorpay needs a finite count (10 years). */
const TOTAL_COUNT: Record<BillingInterval, number> = { monthly: 120, yearly: 10 };

let priceCache: { at: number; body: unknown } | null = null;
export const _resetPriceCache = () => (priceCache = null);

export async function handleBilling(req: Request, deps: BillingDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'Use POST.');
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON with an "action".');
  }
  const rz = deps.razorpay;
  const keyId = deps.env('RAZORPAY_KEY_ID') ?? '';

  // ── Public: prices straight from the Razorpay plans (what checkout will charge) ──
  if (body.action === 'plans') {
    if (!rz) return json(200, { configured: false });
    if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return json(200, priceCache.body);
    const prices: Record<string, Record<string, { amount: number; currency: string } | null>> = {};
    for (const plan of PAID_PLANS) {
      prices[plan] = {};
      for (const interval of INTERVALS) {
        const id = razorpayPlanId(deps.env, plan, interval);
        const p = id ? await rz.getPlan(id).catch(() => null) : null;
        prices[plan][interval] = p ? { amount: p.item.amount, currency: p.item.currency } : null;
      }
    }
    const out = { configured: true, prices };
    priceCache = { at: Date.now(), body: out };
    return json(200, out);
  }

  // ── Everything else needs a signed-in user ──
  const user = await deps.userFrom(req.headers.get('Authorization'));
  if (!user) return fail(401, 'Sign in to manage billing.');
  if (!rz) return fail(503, 'Billing isn’t set up yet (Razorpay keys are missing).');
  const profile = await deps.store.profileById(user.id);
  if (!profile) return fail(404, 'Profile not found.');
  const now = deps.now?.() ?? new Date();
  const live = profile.razorpay_subscription_id && ['active', 'past_due'].includes(profile.plan_status) ? profile.razorpay_subscription_id : null;

  try {
    switch (body.action) {
      case 'checkout': {
        const { plan, interval } = body;
        if (!isPaidPlan(plan) || !isInterval(interval)) return fail(400, 'Choose Standard or Extended, monthly or yearly.');
        if (live && !profile.cancel_at_period_end) {
          return fail(409, 'You already have a subscription. Use “Change plan” instead.');
        }
        const planId = razorpayPlanId(deps.env, plan, interval);
        if (!planId) return fail(503, `The ${PLANS[plan].name} ${interval} plan isn’t set up in Razorpay yet.`);
        const sub = await rz.createSubscription({
          plan_id: planId,
          total_count: TOTAL_COUNT[interval],
          customer_notify: 1,
          notes: { user_id: user.id, plan, interval },
        });
        // Kept separate until paid: abandoning checkout leaves current access untouched.
        await deps.store.updateProfile(user.id, { pending_subscription_id: sub.id });
        return json(200, { subscriptionId: sub.id, keyId, plan, interval, email: user.email ?? null });
      }

      case 'verify': {
        const paymentId = String(body.razorpay_payment_id ?? '');
        const subId = String(body.razorpay_subscription_id ?? '');
        const sig = String(body.razorpay_signature ?? '');
        if (subId !== profile.pending_subscription_id && subId !== profile.razorpay_subscription_id) {
          return fail(400, 'That payment is not for your account.');
        }
        if (!(await verifyCheckoutSignature(paymentId, subId, sig, deps.env('RAZORPAY_KEY_SECRET') ?? ''))) {
          return fail(400, 'Payment signature could not be verified.');
        }
        // Trust Razorpay's own record of the subscription, not the browser.
        const sub = await rz.getSubscription(subId);
        const result = await applySubscription(deps.store, deps.env, sub, now);
        return json(200, { ok: true, status: sub.status, result });
      }

      case 'change': {
        const { plan, interval } = body;
        if (!isPaidPlan(plan) || !isInterval(interval)) return fail(400, 'Choose Standard or Extended, monthly or yearly.');
        if (!live || profile.plan_status !== 'active') return fail(409, 'There’s no active subscription to change. Choose a plan to subscribe.');
        if (profile.cancel_at_period_end) return fail(409, 'This subscription is set to cancel. Subscribe again after it ends, or contact support.');
        if (profile.plan === plan && profile.plan_interval === interval) return fail(400, 'You’re already on that plan.');
        const planId = razorpayPlanId(deps.env, plan, interval);
        if (!planId) return fail(503, `The ${PLANS[plan].name} ${interval} plan isn’t set up in Razorpay yet.`);
        const upgrade = isUpgrade(profile.plan as PaidPlanId, profile.plan_interval ?? 'monthly', plan, interval);
        const sub = await rz.updateSubscription(live, planId, upgrade ? 'now' : 'cycle_end');
        if (upgrade) {
          await applySubscription(deps.store, deps.env, sub, now);
          await deps.store.updateProfile(user.id, { scheduled_change: null });
        } else {
          // Downgrade: keep the current plan until the paid period ends; the webhook switches it.
          await deps.store.updateProfile(user.id, { scheduled_change: `${plan}:${interval}` });
        }
        return json(200, { ok: true, when: upgrade ? 'now' : 'period_end' });
      }

      case 'cancel': {
        if (!live) return fail(409, 'There’s no active subscription to cancel.');
        if (profile.cancel_at_period_end) return json(200, { ok: true, accessUntil: profile.plan_renews_at });
        const sub = await rz.cancelAtPeriodEnd(live);
        await applySubscription(deps.store, deps.env, sub, now);
        await deps.store.updateProfile(user.id, { cancel_at_period_end: true, scheduled_change: null });
        return json(200, { ok: true, accessUntil: profile.plan_renews_at });
      }

      default:
        return fail(400, 'Unknown action.');
    }
  } catch (e) {
    if (e instanceof RazorpayError) {
      // e.g. plan changes aren't allowed for UPI-mandate subscriptions
      return fail(502, `Razorpay: ${e.message}`);
    }
    throw e;
  }
}

/** Upgrades happen now; downgrades (cheaper plan, or yearly → monthly) at the period end. */
export function isUpgrade(fromPlan: PaidPlanId, fromInterval: BillingInterval, toPlan: PaidPlanId, toInterval: BillingInterval): boolean {
  if (planRank(toPlan) !== planRank(fromPlan)) return planRank(toPlan) > planRank(fromPlan);
  return fromInterval === 'monthly' && toInterval === 'yearly';
}
