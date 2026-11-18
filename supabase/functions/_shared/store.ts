// BillingStore backed by the service-role Supabase client (bypasses RLS — server only).
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { BillingProfile, BillingStore } from './subscription.ts';

const COLS =
  'id, plan, plan_status, plan_renews_at, plan_interval, cancel_at_period_end, razorpay_subscription_id, pending_subscription_id, scheduled_change, billing_updated_at';

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function supabaseStore(): BillingStore {
  const db = serviceClient();
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as BillingProfile | null) ?? null;
  };
  return {
    profileById: (id) => one(db.from('profiles').select(COLS).eq('id', id).maybeSingle()),
    // The id goes into a PostgREST filter string, so only Razorpay-shaped ids are accepted.
    profileBySubscription: async (sid) =>
      /^sub_[A-Za-z0-9]+$/.test(sid)
        ? one(db.from('profiles').select(COLS).or(`razorpay_subscription_id.eq.${sid},pending_subscription_id.eq.${sid}`).maybeSingle())
        : null,
    async updateProfile(id, patch) {
      const { error } = await db.from('profiles').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async eventSeen(id) {
      const { data, error } = await db.from('billing_events').select('id').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
    async recordEvent(id, event, payload) {
      const { error } = await db.from('billing_events').upsert({ id, event, payload }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
    async upsertInvoice(row) {
      const { error } = await db.from('invoices').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    },
  };
}
