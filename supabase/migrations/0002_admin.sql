-- Shotframe — admin accounts
-- Run after 0001_init.sql (SQL Editor → New query → paste → Run, or `supabase db push`).
--
-- An admin always has the top plan ('extended': 3D angles, localization, everything).
-- Clients still can't change their own row (profiles has no update policy), so the
-- only way to become admin is the make_admin() call below, run from the SQL editor.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Promote an existing account:   select public.make_admin('admin@example.com');
create or replace function public.make_admin(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set is_admin = true,
         plan     = 'extended'
   where lower(email) = lower(trim(target_email));
  if not found then
    raise exception 'No account with email %. Create it first (sign up in the app, or Authentication → Users → Add user).', target_email;
  end if;
end;
$$;

-- Demote:   select public.remove_admin('admin@example.com');
create or replace function public.remove_admin(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set is_admin = false,
         plan     = 'basic'
   where lower(email) = lower(trim(target_email));
end;
$$;

-- Only the SQL editor / service role may call these — never the browser.
revoke all on function public.make_admin(text)   from public, anon, authenticated;
revoke all on function public.remove_admin(text) from public, anon, authenticated;
