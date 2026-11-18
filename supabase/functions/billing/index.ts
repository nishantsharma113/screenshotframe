// Supabase Edge Function: billing actions for the signed-in user (see handler.ts).
// Deployed with --no-verify-jwt because the "plans" action is public; every other action
// verifies the caller's JWT itself via Supabase Auth.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { Razorpay } from '../_shared/razorpay.ts';
import { supabaseStore } from '../_shared/store.ts';
import { handleBilling } from './handler.ts';

const env = (name: string) => Deno.env.get(name);
const keyId = env('RAZORPAY_KEY_ID');
const keySecret = env('RAZORPAY_KEY_SECRET');
const auth = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve((req) =>
  handleBilling(req, {
    store: supabaseStore(),
    env,
    razorpay: keyId && keySecret ? new Razorpay(keyId, keySecret) : null,
    async userFrom(header) {
      const jwt = header?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!jwt) return null;
      const { data, error } = await auth.auth.getUser(jwt);
      return error || !data.user ? null : { id: data.user.id, email: data.user.email };
    },
  }).catch((e) => {
    console.error(e);
    return new Response(JSON.stringify({ error: 'Something went wrong. Try again.' }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }),
);
