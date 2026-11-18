// Supabase Edge Function: Razorpay webhook endpoint.
// Deploy with --no-verify-jwt: Razorpay can't send a Supabase JWT; requests are authenticated by
// the HMAC signature instead (RAZORPAY_WEBHOOK_SECRET). See README → Billing.
import { Razorpay } from '../_shared/razorpay.ts';
import { supabaseStore } from '../_shared/store.ts';
import { handleWebhook } from './handler.ts';

const env = (name: string) => Deno.env.get(name);
const keyId = env('RAZORPAY_KEY_ID');
const keySecret = env('RAZORPAY_KEY_SECRET');

Deno.serve((req) =>
  handleWebhook(req, {
    store: supabaseStore(),
    env,
    razorpay: keyId && keySecret ? new Razorpay(keyId, keySecret) : null,
    log: (m) => console.log(m),
  }).catch((e) => {
    console.error(e);
    return new Response(JSON.stringify({ error: 'internal error' }), { status: 500 }); // Razorpay will retry
  }),
);
