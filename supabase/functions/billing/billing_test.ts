// Run: deno test --allow-read supabase/functions/
// Billing lifecycle with a fake store and a fake Razorpay: checkout → verify → renew → failed
// payment → upgrade → downgrade → cancel, plus webhook signature/duplicate/out-of-order handling.
import { assert, assertEquals } from 'jsr:@std/assert@1.0.13';
import { handleWebhook } from '../billing-webhook/handler.ts';
import { PLANS } from '../_shared/plans.ts';
import { hmacSha256Hex, type RazorpaySubscription } from '../_shared/razorpay.ts';
import type { BillingProfile, BillingStore, InvoiceRow, ProfilePatch } from '../_shared/subscription.ts';
import { _resetPriceCache, handleBilling, isUpgrade, type BillingDeps } from './handler.ts';

const ENV: Record<string, string> = {
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'key_secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec',
  RAZORPAY_PLAN_STANDARD_MONTHLY: 'plan_SM',
  RAZORPAY_PLAN_STANDARD_YEARLY: 'plan_SY',
  RAZORPAY_PLAN_EXTENDED_MONTHLY: 'plan_EM',
  RAZORPAY_PLAN_EXTENDED_YEARLY: 'plan_EY',
};
const env = (n: string) => ENV[n];
const U = 'user-1';
const T0 = 1_800_000_000; // unix seconds

function newProfile(): BillingProfile {
  return {
    id: U,
    plan: 'basic',
    plan_status: 'none',
    plan_renews_at: null,
    plan_interval: null,
    cancel_at_period_end: false,
    razorpay_subscription_id: null,
    pending_subscription_id: null,
    scheduled_change: null,
    billing_updated_at: null,
  };
}

function world() {
  const profiles = new Map<string, BillingProfile>([[U, newProfile()]]);
  const events = new Set<string>();
  const invoices = new Map<string, InvoiceRow>();
  const subs = new Map<string, RazorpaySubscription>();
  const rzCalls: string[] = [];
  let n = 0;
  const store: BillingStore = {
    profileById: async (id) => profiles.get(id) ?? null,
    profileBySubscription: async (sid) =>
      [...profiles.values()].find((p) => p.razorpay_subscription_id === sid || p.pending_subscription_id === sid) ?? null,
    updateProfile: async (id, patch: ProfilePatch) => {
      profiles.set(id, { ...profiles.get(id)!, ...patch } as BillingProfile);
    },
    eventSeen: async (id) => events.has(id),
    recordEvent: async (id) => void events.add(id),
    upsertInvoice: async (row) => void invoices.set(row.id, row),
  };
  const razorpay: NonNullable<BillingDeps['razorpay']> = {
    getPlan: async (id) => ({ id, period: 'monthly', interval: 1, item: { amount: { plan_SM: 49900, plan_SY: 499900, plan_EM: 99900, plan_EY: 999900 }[id] ?? 0, currency: 'INR' } }),
    createSubscription: async (input) => {
      rzCalls.push(`create ${input.plan_id} ${input.total_count} ${JSON.stringify(input.notes)}`);
      const s: RazorpaySubscription = { id: `sub_${++n}`, plan_id: input.plan_id, status: 'created', notes: input.notes };
      subs.set(s.id, s);
      return s;
    },
    getSubscription: async (id) => subs.get(id)!,
    updateSubscription: async (id, planId, when) => {
      rzCalls.push(`update ${id} ${planId} ${when}`);
      const s = subs.get(id)!;
      if (when === 'now') s.plan_id = planId;
      return s;
    },
    cancelAtPeriodEnd: async (id) => {
      rzCalls.push(`cancel ${id}`);
      return subs.get(id)!; // status stays active until the period ends
    },
  };
  const deps: BillingDeps = {
    store,
    env,
    razorpay,
    userFrom: async (h) => (h === 'Bearer good' ? { id: U, email: 'a@example.test' } : null),
    now: () => new Date((T0 + 10) * 1000),
  };
  return { profiles, events, invoices, subs, rzCalls, store, deps, p: () => profiles.get(U)! };
}

const call = (deps: BillingDeps, body: unknown, token = 'good') =>
  handleBilling(new Request('http://x/billing', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), deps);

async function webhook(w: ReturnType<typeof world>, id: string, event: string, sub: RazorpaySubscription, createdAt: number, extra: object = {}, sig?: string) {
  const raw = JSON.stringify({ event, created_at: createdAt, payload: { subscription: { entity: { ...sub } }, ...extra } });
  return handleWebhook(
    new Request('http://x/hook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': sig ?? (await hmacSha256Hex('whsec', raw)), 'x-razorpay-event-id': id },
      body: raw,
    }),
    { store: w.store, env, razorpay: { getInvoice: async (iid) => ({ id: iid, short_url: `https://rzp.io/i/${iid}` }) } },
  );
}

const checkoutSig = (pay: string, sub: string) => hmacSha256Hex('key_secret', `${pay}|${sub}`);

/** Subscribe to Standard monthly and have Razorpay confirm it. */
async function subscribe(w: ReturnType<typeof world>) {
  const res = await call(w.deps, { action: 'checkout', plan: 'standard', interval: 'monthly' });
  const { subscriptionId } = await res.json();
  const sub = w.subs.get(subscriptionId)!;
  Object.assign(sub, { status: 'active', current_start: T0, current_end: T0 + 30 * 86400, customer_id: 'cust_1' });
  return sub;
}

Deno.test('the database project limit matches the shared plan config', async () => {
  const sql = await Deno.readTextFile(new URL('../../migrations/0007_billing.sql', import.meta.url));
  const m = sql.match(/plan_project_limit\(plan text\)[\s\S]*?when 'basic' then (\d+)/);
  assert(m, 'limit not found in 0007_billing.sql');
  assertEquals(Number(m[1]), PLANS.basic.limits.projects);
});

Deno.test('plans: public, prices come from the Razorpay plans', async () => {
  _resetPriceCache();
  const res = await call(world().deps, { action: 'plans' }, 'none');
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.prices.standard.monthly, { amount: 49900, currency: 'INR' });
  assertEquals(body.prices.extended.yearly, { amount: 999900, currency: 'INR' });
});

Deno.test('auth and input checks', async () => {
  const w = world();
  assertEquals((await call(w.deps, { action: 'checkout', plan: 'standard', interval: 'monthly' }, 'forged')).status, 401);
  assertEquals((await call(w.deps, { action: 'checkout', plan: 'basic', interval: 'monthly' })).status, 400);
  assertEquals((await call(w.deps, { action: 'checkout', plan: 'standard', interval: 'weekly' })).status, 400);
  assertEquals((await call(w.deps, { action: 'nope' })).status, 400);
  assertEquals(w.rzCalls.length, 0);
});

Deno.test('checkout → verify: plan only changes after a verified payment, via Razorpay’s record', async () => {
  const w = world();
  const res = await call(w.deps, { action: 'checkout', plan: 'standard', interval: 'monthly' });
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.keyId, 'rzp_test_key');
  assert(w.rzCalls[0].startsWith('create plan_SM 120 {"user_id":"user-1","plan":"standard","interval":"monthly"}'));
  assertEquals(w.p().plan, 'basic'); // nothing granted yet
  assertEquals(w.p().pending_subscription_id, body.subscriptionId);

  // A forged signature changes nothing
  const bad = await call(w.deps, { action: 'verify', razorpay_payment_id: 'pay_1', razorpay_subscription_id: body.subscriptionId, razorpay_signature: 'f'.repeat(64) });
  assertEquals(bad.status, 400);
  assertEquals(w.p().plan, 'basic');

  // A real signature, but Razorpay says the sub isn't active yet → still nothing
  let ok = await call(w.deps, { action: 'verify', razorpay_payment_id: 'pay_1', razorpay_subscription_id: body.subscriptionId, razorpay_signature: await checkoutSig('pay_1', body.subscriptionId) });
  assertEquals((await ok.json()).result, 'not_live');
  assertEquals(w.p().plan, 'basic');

  Object.assign(w.subs.get(body.subscriptionId)!, { status: 'active', current_end: T0 + 30 * 86400 });
  ok = await call(w.deps, { action: 'verify', razorpay_payment_id: 'pay_1', razorpay_subscription_id: body.subscriptionId, razorpay_signature: await checkoutSig('pay_1', body.subscriptionId) });
  assertEquals((await ok.json()).result, 'applied');
  assertEquals([w.p().plan, w.p().plan_status, w.p().plan_interval], ['standard', 'active', 'monthly']);
  assertEquals(w.p().razorpay_subscription_id, body.subscriptionId);
  assertEquals(w.p().pending_subscription_id, null);
  assertEquals(w.p().plan_renews_at, new Date((T0 + 30 * 86400) * 1000).toISOString());
});

Deno.test('verify refuses another account’s subscription', async () => {
  const w = world();
  const res = await call(w.deps, { action: 'verify', razorpay_payment_id: 'p', razorpay_subscription_id: 'sub_other', razorpay_signature: await checkoutSig('p', 'sub_other') });
  assertEquals(res.status, 400);
});

Deno.test('webhook: bad signature 401, duplicates ignored, invoices recorded on charge', async () => {
  const w = world();
  const sub = await subscribe(w);
  assertEquals((await webhook(w, 'evt_x', 'subscription.activated', sub, T0 + 1, {}, 'bad')).status, 401);
  assertEquals(w.p().plan, 'basic');

  const pay = { payment: { entity: { id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured', invoice_id: 'inv_1', created_at: T0 + 1 } } };
  const r1 = await webhook(w, 'evt_1', 'subscription.charged', sub, T0 + 1, pay);
  assertEquals((await r1.json()).result, 'applied');
  assertEquals([w.p().plan, w.p().plan_status], ['standard', 'active']);
  assertEquals(w.invoices.get('pay_1')?.receipt_url, 'https://rzp.io/i/inv_1');
  assertEquals(w.invoices.get('pay_1')?.amount, 49900);

  const dup = await webhook(w, 'evt_1', 'subscription.charged', sub, T0 + 1, pay);
  assertEquals((await dup.json()).duplicate, true);
  assertEquals(w.invoices.size, 1);
});

Deno.test('renewal moves the renewal date; a late, older event cannot roll it back', async () => {
  const w = world();
  const sub = await subscribe(w);
  await webhook(w, 'e1', 'subscription.activated', sub, T0 + 1);
  const renewed = { ...sub, current_start: T0 + 30 * 86400, current_end: T0 + 60 * 86400 };
  await webhook(w, 'e2', 'subscription.charged', renewed, T0 + 30 * 86400, { payment: { entity: { id: 'pay_2', amount: 49900, currency: 'INR', status: 'captured' } } });
  assertEquals(w.p().plan_renews_at, new Date((T0 + 60 * 86400) * 1000).toISOString());
  assertEquals(w.invoices.size, 1);
  // An old "pending" delivered late must not overwrite the newer state.
  const late = await webhook(w, 'e0', 'subscription.pending', { ...sub, status: 'pending' }, T0 + 5);
  assertEquals((await late.json()).result, 'stale');
  assertEquals(w.p().plan_status, 'active');
});

Deno.test('failed payment: past_due (grace) then halted', async () => {
  const w = world();
  const sub = await subscribe(w);
  await webhook(w, 'e1', 'subscription.activated', sub, T0 + 1);
  await webhook(w, 'e2', 'subscription.pending', { ...sub, status: 'pending' }, T0 + 31 * 86400);
  assertEquals(w.p().plan_status, 'past_due');
  await webhook(w, 'e3', 'subscription.halted', { ...sub, status: 'halted' }, T0 + 35 * 86400);
  assertEquals(w.p().plan_status, 'halted'); // current_plan() → basic
});

Deno.test('upgrade applies now; downgrade waits for the period end', async () => {
  const w = world();
  const sub = await subscribe(w);
  await webhook(w, 'e1', 'subscription.activated', sub, T0 + 1);

  let res = await call(w.deps, { action: 'change', plan: 'extended', interval: 'monthly' });
  assertEquals((await res.json()).when, 'now');
  assertEquals(w.rzCalls.at(-1), `update ${sub.id} plan_EM now`);
  assertEquals(w.p().plan, 'extended');

  res = await call(w.deps, { action: 'change', plan: 'standard', interval: 'monthly' });
  assertEquals((await res.json()).when, 'period_end');
  assertEquals(w.rzCalls.at(-1), `update ${sub.id} plan_SM cycle_end`);
  assertEquals([w.p().plan, w.p().scheduled_change], ['extended', 'standard:monthly']); // still Extended for now

  // At the renewal Razorpay switches the plan and tells us.
  await webhook(w, 'e2', 'subscription.updated', { ...sub, plan_id: 'plan_SM', current_end: T0 + 60 * 86400 }, T0 + 30 * 86400);
  assertEquals([w.p().plan, w.p().scheduled_change], ['standard', null]);

  assertEquals((await call(w.deps, { action: 'change', plan: 'standard', interval: 'monthly' })).status, 400); // same plan
});

Deno.test('upgrade/downgrade rules', () => {
  assert(isUpgrade('standard', 'monthly', 'extended', 'monthly'));
  assert(isUpgrade('standard', 'monthly', 'standard', 'yearly'));
  assert(!isUpgrade('standard', 'yearly', 'standard', 'monthly'));
  assert(!isUpgrade('extended', 'monthly', 'standard', 'yearly'));
});

Deno.test('cancel: access continues until the period ends, then Basic', async () => {
  const w = world();
  const sub = await subscribe(w);
  await webhook(w, 'e1', 'subscription.activated', sub, T0 + 1);
  const res = await call(w.deps, { action: 'cancel' });
  assertEquals(res.status, 200);
  assertEquals(w.rzCalls.at(-1), `cancel ${sub.id}`);
  assertEquals([w.p().plan, w.p().plan_status, w.p().cancel_at_period_end], ['standard', 'active', true]);
  assertEquals((await call(w.deps, { action: 'change', plan: 'extended', interval: 'monthly' })).status, 409);

  // Razorpay cancels at the cycle end
  await webhook(w, 'e2', 'subscription.cancelled', { ...sub, status: 'cancelled' }, T0 + 30 * 86400);
  assertEquals([w.p().plan_status, w.p().cancel_at_period_end], ['cancelled', false]);
  // plan_renews_at is the end of the paid period, so current_plan() returns Basic from then on
  assertEquals(w.p().plan_renews_at, new Date((T0 + 30 * 86400) * 1000).toISOString());
});

Deno.test('resubscribing while a cancelled period is still running keeps access until the new one is live', async () => {
  const w = world();
  const sub = await subscribe(w);
  await webhook(w, 'e1', 'subscription.activated', sub, T0 + 1);
  await call(w.deps, { action: 'cancel' });
  const res = await call(w.deps, { action: 'checkout', plan: 'extended', interval: 'yearly' });
  const { subscriptionId } = await res.json();
  assertEquals([w.p().plan, w.p().razorpay_subscription_id], ['standard', sub.id]); // untouched while pending
  // A webhook for the new sub before payment does nothing
  await webhook(w, 'e2', 'subscription.authenticated', { ...w.subs.get(subscriptionId)!, status: 'authenticated' }, T0 + 100);
  assertEquals(w.p().plan, 'standard');
  // Paid → it takes over
  await webhook(w, 'e3', 'subscription.activated', { ...w.subs.get(subscriptionId)!, status: 'active', current_end: T0 + 365 * 86400 }, T0 + 200);
  assertEquals([w.p().plan, w.p().plan_interval, w.p().razorpay_subscription_id, w.p().cancel_at_period_end], ['extended', 'yearly', subscriptionId, false]);
  // The old subscription's final "cancelled" no longer affects the profile
  const old = await webhook(w, 'e4', 'subscription.cancelled', { ...sub, status: 'cancelled' }, T0 + 30 * 86400);
  assertEquals((await old.json()).result, 'unknown_subscription');
  assertEquals(w.p().plan_status, 'active');
});

Deno.test('a webhook whose notes name another user is ignored', async () => {
  const w = world();
  const sub = await subscribe(w);
  const res = await webhook(w, 'e1', 'subscription.activated', { ...sub, notes: { user_id: 'someone-else' } }, T0 + 1);
  assertEquals((await res.json()).result, 'user_mismatch');
  assertEquals(w.p().plan, 'basic');
});

Deno.test('checkout is refused while a live subscription exists (use change instead)', async () => {
  const w = world();
  const sub = await subscribe(w);
  await webhook(w, 'e1', 'subscription.activated', sub, T0 + 1);
  assertEquals((await call(w.deps, { action: 'checkout', plan: 'extended', interval: 'monthly' })).status, 409);
});
