import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { PAID_PLANS, PLANS, isInterval, isPaidPlan, planRank, type BillingInterval, type PaidPlanId } from '@shared/plans';
import { SiteHeader } from '@/components/SiteHeader';
import { useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  cancelSubscription,
  changePlan,
  formatPrice,
  getBillingInfo,
  getPrices,
  listInvoices,
  startCheckout,
  type BillingInfo,
  type Invoice,
  type Prices,
} from '@/services/billing';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const LIVE = ['active', 'past_due'];

/** Account → Billing: current plan, renewal, invoices, subscribe / change / cancel. */
export function Billing() {
  const { user, plan: effectivePlan, loading, refreshPlan } = useAuth();
  const [search] = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>(isInterval(search.get('interval')) ? (search.get('interval') as BillingInterval) : 'monthly');
  const highlight = isPaidPlan(search.get('plan')) ? (search.get('plan') as PaidPlanId) : null;
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [prices, setPrices] = useState<Prices | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const userId = user?.id;

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      const [i, inv] = await Promise.all([getBillingInfo(userId), listInvoices()]);
      setInfo(i);
      setInvoices(inv);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not load billing.' });
    }
    refreshPlan();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void reload();
    void getPrices().then(setPrices);
  }, [reload]);

  if (!isSupabaseConfigured) {
    return (
      <div className="light-page">
        <SiteHeader />
        <main className="container section">
          <h1 className="page-title">Billing</h1>
          <p className="muted">Billing needs Supabase. See the README to connect it.</p>
        </main>
      </div>
    );
  }
  if (!loading && !user) return <Navigate to={`/signin?next=${encodeURIComponent(`/account/billing?${search.toString()}`)}`} replace />;

  const live = Boolean(info && LIVE.includes(info.plan_status));
  const cancelling = Boolean(info?.cancel_at_period_end);
  const currentPaid = live && isPaidPlan(info?.plan) ? (info!.plan as PaidPlanId) : null;
  const scheduled = info?.scheduled_change?.split(':') as [PaidPlanId, BillingInterval] | undefined;

  const run = async (key: string, fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(key);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: 'ok', text });
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(null);
    }
  };

  const subscribe = (p: PaidPlanId) =>
    run(`buy:${p}`, async () => {
      const r = await startCheckout(p, interval);
      return r === 'paid' ? `Welcome to ${PLANS[p].name}! Your plan is active.` : null;
    });

  const change = (p: PaidPlanId) =>
    run(`change:${p}`, async () => {
      const r = await changePlan(p, interval);
      return r.when === 'now'
        ? `You’re now on ${PLANS[p].name} (${interval}).`
        : `You’ll switch to ${PLANS[p].name} (${interval}) on ${date(info?.plan_renews_at ?? null)}. Until then nothing changes.`;
    });

  const cancel = () => {
    if (!window.confirm(`Cancel your subscription? You keep ${PLANS[currentPaid!].name} until ${date(info?.plan_renews_at ?? null)}, then move to Basic.`)) return;
    void run('cancel', async () => {
      const r = await cancelSubscription();
      return `Cancelled. You keep your plan until ${date(r.accessUntil)}, then move to Basic.`;
    });
  };

  const status = (() => {
    if (!info) return null;
    if (effectivePlan === 'basic' && !live) {
      if (info.plan_status === 'halted') return 'Your last payment failed, so you’re on Basic. Subscribe again to restore your plan.';
      if (info.plan_status === 'cancelled' || info.plan_status === 'expired') return 'Your subscription has ended. You’re on Basic.';
      return 'You’re on Basic (free).';
    }
    if (info.plan_status === 'none') return `${PLANS[effectivePlan].name} — set on your account (no subscription).`;
    if (info.plan_status === 'past_due') return `A payment failed and Razorpay is retrying. Update your payment method from Razorpay’s email to keep ${PLANS[effectivePlan].name}.`;
    if (cancelling) return `Cancelled — you keep ${PLANS[effectivePlan].name} until ${date(info.plan_renews_at)}, then move to Basic.`;
    if (info.plan_status === 'cancelled') return `Cancelled — ${PLANS[effectivePlan].name} until ${date(info.plan_renews_at)}, then Basic.`;
    const next = scheduled ? ` Switches to ${PLANS[scheduled[0]]?.name} (${scheduled[1]}) on that date.` : '';
    return `Renews ${info.plan_interval ?? ''} on ${date(info.plan_renews_at)}.${next}`;
  })();

  return (
    <div className="light-page">
      <SiteHeader />
      <main className="container section billing">
        <h1 className="page-title">Billing</h1>

        <section className="billing__current" aria-live="polite">
          <p className="muted small">Current plan</p>
          <h2>{PLANS[effectivePlan]?.name ?? 'Basic'}</h2>
          {status && <p>{status}</p>}
          {currentPaid && !cancelling && (
            <button type="button" className="btn btn--outline" disabled={busy !== null} onClick={cancel}>
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel subscription'}
            </button>
          )}
        </section>

        {message && (
          <p className={message.kind === 'error' ? 'error-text' : 'billing__ok'} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}

        <div className="pricing__head">
          <h2>{currentPaid ? 'Change plan' : 'Choose a plan'}</h2>
          <div className="segmented" role="group" aria-label="Billing period">
            <button type="button" aria-pressed={interval === 'monthly'} onClick={() => setInterval('monthly')}>
              Monthly
            </button>
            <button type="button" aria-pressed={interval === 'yearly'} onClick={() => setInterval('yearly')}>
              Yearly
            </button>
          </div>
        </div>

        {prices === null && <p className="muted">Payments aren’t set up yet (Razorpay keys or plans are missing). See README → Billing.</p>}

        <div className="card-grid">
          {PAID_PLANS.map((p) => {
            const cfg = PLANS[p];
            const price = prices?.[p]?.[interval] ?? null;
            const isCurrent = currentPaid === p && info?.plan_interval === interval;
            const isScheduled = scheduled?.[0] === p && scheduled?.[1] === interval;
            let label: string;
            let action: (() => void) | null = null;
            if (isCurrent) label = 'Current plan';
            else if (isScheduled) label = 'Starts at renewal';
            else if (currentPaid && !cancelling) {
              const up = planRank(p) > planRank(currentPaid) || (p === currentPaid && interval === 'yearly');
              label = up ? `Upgrade to ${cfg.name}` : `Switch at renewal`;
              action = () => void change(p);
            } else {
              label = `Subscribe to ${cfg.name}`;
              action = () => void subscribe(p);
            }
            return (
              <div key={p} className={`plan ${cfg.popular ? 'plan--popular' : ''} ${highlight === p ? 'is-highlighted' : ''}`}>
                <div className="plan__top">
                  <h3>{cfg.name}</h3>
                  {isCurrent && <span className="plan__badge">Current</span>}
                </div>
                <div>
                  <span className="plan__price">{price ? formatPrice(price) : prices === undefined ? '…' : '—'}</span>{' '}
                  <span className="plan__per">{interval === 'yearly' ? '/ year' : '/ month'}</span>
                </div>
                <p className="plan__blurb">{cfg.blurb}</p>
                <ul>
                  {cfg.bullets.map((b) => (
                    <li key={b.text} className={b.soon ? 'is-soon' : undefined}>
                      {b.text}
                      {b.soon && <span className="soon-badge">Coming soon</span>}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`btn btn--lg ${cfg.popular ? 'btn--white' : 'btn--dark'}`}
                  disabled={!action || busy !== null || !price}
                  onClick={action ?? undefined}
                >
                  {busy === `buy:${p}` || busy === `change:${p}` ? 'Working…' : label}
                </button>
              </div>
            );
          })}
        </div>
        {currentPaid && !cancelling && (
          <p className="muted small">Upgrades apply right away. Moving to a cheaper plan or from yearly to monthly happens at your next renewal.</p>
        )}

        <h2 className="billing__h">Invoices</h2>
        {invoices === null ? (
          <p className="muted">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="muted">No payments yet.</p>
        ) : (
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Plan</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>{date(i.paid_at)}</td>
                  <td>{i.plan ? PLANS[i.plan as PaidPlanId]?.name ?? i.plan : '—'}</td>
                  <td>
                    {date(i.period_start)} – {date(i.period_end)}
                  </td>
                  <td>{formatPrice({ amount: i.amount, currency: i.currency })}</td>
                  <td>
                    {i.receipt_url ? (
                      <a href={i.receipt_url} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
