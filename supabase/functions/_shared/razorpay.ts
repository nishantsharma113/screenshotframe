// Razorpay REST client + signature checks. No Deno globals, so it can be tested with a fake fetch.

const API = 'https://api.razorpay.com/v1';

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired' | 'paused';
  customer_id?: string | null;
  current_start?: number | null; // unix seconds
  current_end?: number | null; // unix seconds
  ended_at?: number | null;
  notes?: Record<string, string> | unknown[];
  short_url?: string;
}

export interface RazorpayPlan {
  id: string;
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  item: { amount: number; currency: string; name?: string };
}

export class RazorpayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (signatures). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Webhook: X-Razorpay-Signature = HMAC-SHA256(raw request body, webhook secret). */
export async function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  return safeEqual(await hmacSha256Hex(secret, rawBody), signature);
}

/** Checkout success callback: HMAC-SHA256(payment_id + "|" + subscription_id, key secret). */
export async function verifyCheckoutSignature(
  paymentId: string,
  subscriptionId: string,
  signature: string,
  keySecret: string,
): Promise<boolean> {
  if (!paymentId || !subscriptionId || !signature || !keySecret) return false;
  return safeEqual(await hmacSha256Hex(keySecret, `${paymentId}|${subscriptionId}`), signature);
}

export class Razorpay {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${this.keyId}:${this.keySecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok) throw new RazorpayError(data.error?.description ?? `Razorpay returned ${res.status}`, res.status);
    return data as T;
  }

  getPlan(id: string) {
    return this.call<RazorpayPlan>('GET', `/plans/${encodeURIComponent(id)}`);
  }

  createSubscription(input: { plan_id: string; total_count: number; customer_notify: 0 | 1; notes: Record<string, string> }) {
    return this.call<RazorpaySubscription>('POST', '/subscriptions', input);
  }

  getSubscription(id: string) {
    return this.call<RazorpaySubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);
  }

  /** Change plan. 'now' = upgrade immediately; 'cycle_end' = at the next renewal. */
  updateSubscription(id: string, planId: string, when: 'now' | 'cycle_end') {
    return this.call<RazorpaySubscription>('PATCH', `/subscriptions/${encodeURIComponent(id)}`, {
      plan_id: planId,
      schedule_change_at: when,
      customer_notify: 1,
    });
  }

  /** Cancel at the end of the paid period (access continues until then). */
  cancelAtPeriodEnd(id: string) {
    return this.call<RazorpaySubscription>('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 1 });
  }

  getInvoice(id: string) {
    return this.call<{ id: string; short_url?: string; status?: string }>('GET', `/invoices/${encodeURIComponent(id)}`);
  }
}
