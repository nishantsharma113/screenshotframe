// Razorpay webhook. Verifies the signature on the RAW body, processes each event id once, and
// applies the subscription state to the owner's profile. Razorpay retries on non-2xx responses.
import { verifyWebhookSignature, type Razorpay, type RazorpaySubscription } from '../_shared/razorpay.ts';
import { applySubscription, planForRazorpayPlan, type BillingStore, type Env } from '../_shared/subscription.ts';

export interface WebhookDeps {
  store: BillingStore;
  env: Env;
  razorpay: Pick<Razorpay, 'getInvoice'> | null;
  log?: (msg: string) => void;
}

interface RazorpayEvent {
  event: string;
  created_at?: number; // unix seconds
  payload?: {
    subscription?: { entity: RazorpaySubscription };
    payment?: { entity: { id: string; amount: number; currency: string; status: string; invoice_id?: string | null; created_at?: number } };
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const secret = deps.env('RAZORPAY_WEBHOOK_SECRET') ?? '';
  if (!secret) return json(500, { error: 'RAZORPAY_WEBHOOK_SECRET is not set' });

  const raw = await req.text(); // the exact bytes Razorpay signed
  if (!(await verifyWebhookSignature(raw, req.headers.get('x-razorpay-signature'), secret))) {
    return json(401, { error: 'bad signature' });
  }

  let evt: RazorpayEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const eventId = req.headers.get('x-razorpay-event-id');
  if (!eventId) return json(400, { error: 'missing x-razorpay-event-id' });
  if (await deps.store.eventSeen(eventId)) return json(200, { ok: true, duplicate: true });

  const sub = evt.payload?.subscription?.entity;
  let result: string = 'ignored';
  if (evt.event.startsWith('subscription.') && sub) {
    const at = new Date((evt.created_at ?? Math.floor(Date.now() / 1000)) * 1000);
    result = await applySubscription(deps.store, deps.env, sub, at);

    // A successful charge (first payment or renewal) → an invoice row the user can see.
    const pay = evt.payload?.payment?.entity;
    if (evt.event === 'subscription.charged' && pay && (result === 'applied' || result === 'stale')) {
      const owner = await deps.store.profileBySubscription(sub.id);
      if (owner) {
        let receipt: string | null = null;
        if (pay.invoice_id && deps.razorpay) {
          receipt = (await deps.razorpay.getInvoice(pay.invoice_id).catch(() => null))?.short_url ?? null;
        }
        await deps.store.upsertInvoice({
          id: pay.id,
          user_id: owner.id,
          subscription_id: sub.id,
          invoice_id: pay.invoice_id ?? null,
          plan: planForRazorpayPlan(deps.env, sub.plan_id)?.plan ?? null,
          amount: pay.amount,
          currency: pay.currency,
          status: 'paid',
          receipt_url: receipt,
          period_start: sub.current_start ? new Date(sub.current_start * 1000).toISOString() : null,
          period_end: sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null,
          paid_at: new Date((pay.created_at ?? evt.created_at ?? Date.now() / 1000) * 1000).toISOString(),
        });
      }
    }
  }

  // Recorded only after processing succeeded, so a crash mid-way lets Razorpay's retry run it again
  // (processing is idempotent: state is applied as-is and invoices are upserted by payment id).
  await deps.store.recordEvent(eventId, evt.event, evt);
  deps.log?.(`${evt.event} ${eventId}: ${result}`);
  return json(200, { ok: true, result });
}
