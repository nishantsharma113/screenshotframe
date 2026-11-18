-- Shotframe — billing (Razorpay subscriptions) and server-side plan limits
-- Run after 0001–0006. Safe to run more than once.
--
-- Who writes what:
--   * Only the billing Edge Functions (service role) write the billing columns, invoices and
--     billing_events. Clients have no write policies on any of them (profiles never had one).
--   * Users can READ their own profile (0001) and their own invoices (below). Nothing else.
--
-- Plan limits live in plan_project_limit(). The number must match
-- supabase/functions/_shared/plans.ts (PLANS.basic.limits.projects); billing_test.ts checks it.

-- ─────────────────────────────────────────────────────────────
-- Billing state on the profile
-- ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists plan_status text not null default 'none'
    check (plan_status in ('none', 'active', 'past_due', 'halted', 'cancelled', 'expired')),
  -- End of the period already paid for. Access continues until then after a cancel.
  add column if not exists plan_renews_at timestamptz,
  add column if not exists plan_interval text check (plan_interval in ('monthly', 'yearly')),
  -- Cancelled by the user; access continues until plan_renews_at.
  add column if not exists cancel_at_period_end boolean not null default false,
  -- The live subscription. A new checkout waits in pending_subscription_id until Razorpay
  -- confirms it, so abandoning checkout never touches access the user already paid for.
  add column if not exists razorpay_subscription_id text,
  add column if not exists pending_subscription_id text,
  add column if not exists razorpay_customer_id text,
  -- A plan change waiting for the next renewal (downgrades), e.g. 'standard:monthly'.
  add column if not exists scheduled_change text,
  -- created_at of the last Razorpay event applied, so late/out-of-order webhooks are ignored.
  add column if not exists billing_updated_at timestamptz;

create unique index if not exists profiles_razorpay_subscription_idx
  on public.profiles (razorpay_subscription_id) where razorpay_subscription_id is not null;

-- 'none' = not billed through Razorpay (the default, and plans set by hand per the README).

-- ─────────────────────────────────────────────────────────────
-- The plan a user actually has right now. Everything that enforces limits uses this.
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_plan(uid uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.id is null then 'basic'
    when coalesce(p.is_admin, false) then 'extended'
    when p.plan = 'basic' then 'basic'
    -- set by hand, or a live subscription
    when p.plan_status in ('none', 'active') then p.plan
    -- payment failed, Razorpay is retrying: keep access for 3 days past the period end
    when p.plan_status = 'past_due' and (p.plan_renews_at is null or now() < p.plan_renews_at + interval '3 days') then p.plan
    -- cancelled: keep access until the end of the period already paid for
    when p.plan_status = 'cancelled' and p.plan_renews_at is not null and now() < p.plan_renews_at then p.plan
    else 'basic'
  end
  from (select 1) one
  left join public.profiles p on p.id = uid;
$$;

-- Not callable by clients with an arbitrary id (that would reveal other users' plans):
-- clients use my_plan(); triggers and policies run it via security definer functions.
revoke all on function public.current_plan(uuid) from public, anon, authenticated;
grant execute on function public.current_plan(uuid) to service_role;

-- Only the caller's own plan can be asked for (no probing other users).
create or replace function public.my_plan()
returns text language sql stable security definer set search_path = public
as $$ select public.current_plan(auth.uid()); $$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Project limit (Basic: 3). Enforced with a trigger, serialised per user, so parallel
-- inserts can't both slip under the cap.
-- ─────────────────────────────────────────────────────────────
create or replace function public.plan_project_limit(plan text)
returns int language sql immutable
as $$ select case plan when 'basic' then 3 else null end; $$;

create or replace function public.enforce_project_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lim int;
  n int;
begin
  -- Only count when users create their OWN project. BEFORE triggers run before RLS, so for anyone
  -- else (who RLS will reject anyway) counting would leak whether that user is at their cap.
  -- Inserts by trusted server code (service role: no auth.uid()) are not limited here.
  if auth.uid() is null or auth.uid() is distinct from new.user_id then
    return new;
  end if;
  lim := public.plan_project_limit(public.current_plan(new.user_id));
  if lim is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('projects:' || new.user_id::text));
  select count(*) into n from public.projects where user_id = new.user_id;
  if n >= lim then
    raise exception 'PLAN_LIMIT_PROJECTS: your plan allows % projects', lim
      using errcode = 'P0001', hint = 'Upgrade to create more projects.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_plan_limit on public.projects;
create trigger projects_plan_limit
  before insert on public.projects
  for each row execute function public.enforce_project_limit();

-- ─────────────────────────────────────────────────────────────
-- Paid features that create server-side data: saved templates and uploaded fonts.
-- (Replaces the insert policies from 0004/0005 with plan-aware ones.)
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.user_templates') is not null then
    drop policy if exists "Owners insert templates" on public.user_templates;
    create policy "Owners insert templates" on public.user_templates
      for insert to authenticated
      with check (auth.uid() = user_id and public.my_plan() in ('standard', 'extended'));
  end if;
  if to_regclass('public.user_fonts') is not null then
    drop policy if exists "Owners insert fonts" on public.user_fonts;
    create policy "Owners insert fonts" on public.user_fonts
      for insert to authenticated
      with check (auth.uid() = user_id and public.my_plan() in ('standard', 'extended'));
  end if;
  if exists (select 1 from storage.buckets where id = 'fonts') then
    drop policy if exists "Users upload their own fonts" on storage.objects;
    create policy "Users upload their own fonts" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'fonts'
        and (storage.foldername(name))[1] = auth.uid()::text
        and public.my_plan() in ('standard', 'extended')
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Invoices (one row per successful charge), readable by their owner only
-- ─────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id            text primary key,            -- Razorpay payment id
  user_id       uuid not null references auth.users (id) on delete cascade,
  subscription_id text,
  invoice_id    text,                        -- Razorpay invoice id, when there is one
  plan          text,
  amount        bigint not null,             -- smallest currency unit (paise)
  currency      text not null,
  status        text not null default 'paid',
  receipt_url   text,                        -- Razorpay-hosted invoice/receipt
  period_start  timestamptz,
  period_end    timestamptz,
  paid_at       timestamptz not null default now()
);

create index if not exists invoices_user_idx on public.invoices (user_id, paid_at desc);

alter table public.invoices enable row level security;

drop policy if exists "Users read their own invoices" on public.invoices;
create policy "Users read their own invoices" on public.invoices
  for select to authenticated using (auth.uid() = user_id);
-- No insert/update/delete policies: only the webhook (service role) writes invoices.

-- ─────────────────────────────────────────────────────────────
-- Webhook log: each Razorpay event id is processed once
-- ─────────────────────────────────────────────────────────────
create table if not exists public.billing_events (
  id           text primary key,             -- X-Razorpay-Event-Id
  event        text not null,
  received_at  timestamptz not null default now(),
  payload      jsonb not null
);

alter table public.billing_events enable row level security;
-- No policies at all: invisible to clients; the service role bypasses RLS.
