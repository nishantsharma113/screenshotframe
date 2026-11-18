import type { BillingInterval, PaidPlanId } from '@shared/plans';
import { supabase } from '@/lib/supabase';

export interface Price {
  amount: number; // smallest unit (paise)
  currency: string;
}
export type Prices = Record<PaidPlanId, Record<BillingInterval, Price | null>>;

export interface BillingInfo {
  plan: string;
  plan_status: string;
  plan_renews_at: string | null;
  plan_interval: BillingInterval | null;
  cancel_at_period_end: boolean;
  scheduled_change: string | null;
}

export interface Invoice {
  id: string;
  plan: string | null;
  amount: number;
  currency: string;
  status: string;
  receipt_url: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string;
}

function requireClient() {
  if (!supabase) throw new Error('Billing needs Supabase (see README).');
  return supabase;
}

/** Calls the `billing` Edge Function; throws an Error with its readable message. */
async function callBilling<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke<T>('billing', { body });
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      const b = (await ctx.json().catch(() => null)) as { error?: string } | null;
      throw new Error(b?.error ?? (ctx.status === 404 ? 'Billing isn’t deployed yet (see README → Billing).' : `Billing failed (${ctx.status}).`));
    }
    throw new Error('Couldn’t reach billing. Check your connection.');
  }
  return data as T;
}

let pricesPromise: Promise<Prices | null> | null = null;
/** Live prices from the Razorpay plans (null when billing isn't configured). Cached per page load. */
export function getPrices(): Promise<Prices | null> {
  pricesPromise ??= callBilling<{ configured: boolean; prices?: Prices }>({ action: 'plans' })
    .then((r) => (r.configured && r.prices ? r.prices : null))
    .catch(() => {
      pricesPromise = null; // retry next time
      return null;
    });
  return pricesPromise;
}

export const formatPrice = (p: Price) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency, maximumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100);

export async function getBillingInfo(userId: string): Promise<BillingInfo | null> {
  const { data, error } = await requireClient()
    .from('profiles')
    .select('plan, plan_status, plan_renews_at, plan_interval, cancel_at_period_end, scheduled_change')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message.includes('plan_status') ? 'Billing isn’t set up yet: run 0007_billing.sql.' : error.message);
  return (data as BillingInfo | null) ?? null;
}

export async function listInvoices(): Promise<Invoice[]> {
  const { data, error } = await requireClient()
    .from('invoices')
    .select('id, plan, amount, currency, status, receipt_url, period_start, period_end, paid_at')
    .order('paid_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Invoice[];
}

/* ── Razorpay Checkout ──────────────────────────────────────── */

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}
interface RazorpayCheckout {
  open(): void;
  on(event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';
function loadCheckoutJs(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_JS;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Couldn’t load Razorpay Checkout. Check your connection or ad blocker.'));
    document.head.appendChild(s);
  });
}

/**
 * Opens Razorpay Checkout for a new subscription. Resolves 'paid' after the server has verified
 * the payment with Razorpay, or 'dismissed' if the user closed the window.
 */
export async function startCheckout(plan: PaidPlanId, interval: BillingInterval): Promise<'paid' | 'dismissed'> {
  const order = await callBilling<{ subscriptionId: string; keyId: string; email: string | null }>({ action: 'checkout', plan, interval });
  await loadCheckoutJs();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.keyId,
      subscription_id: order.subscriptionId,
      name: 'Shotframe',
      description: `${plan[0].toUpperCase()}${plan.slice(1)} · ${interval}`,
      prefill: order.email ? { email: order.email } : undefined,
      theme: { color: '#4F46E5' },
      handler: (r: RazorpayResponse) => {
        // The plan is granted by the server only after it checks this signature with Razorpay.
        callBilling({ action: 'verify', ...r })
          .then(() => resolve('paid'))
          .catch(reject);
      },
      modal: { ondismiss: () => resolve('dismissed') },
    });
    rzp.on('payment.failed', (r) => reject(new Error(r.error?.description ?? 'The payment failed.')));
    rzp.open();
  });
}

export const changePlan = (plan: PaidPlanId, interval: BillingInterval) =>
  callBilling<{ ok: true; when: 'now' | 'period_end' }>({ action: 'change', plan, interval });

export const cancelSubscription = () => callBilling<{ ok: true; accessUntil: string | null }>({ action: 'cancel' });
