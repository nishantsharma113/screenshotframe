-- Shotframe — auto-translate usage limit (used by supabase/functions/translate)
-- Run after 0001–0005. Safe to run more than once.
--
-- One row per user per UTC day. Users may read their own count; nobody writes the table
-- directly — only consume_translate_quota() does, atomically, so two parallel calls can't
-- both slip past the limit.

create table if not exists public.translate_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  count    int  not null default 0 check (count >= 0),
  primary key (user_id, day)
);

alter table public.translate_usage enable row level security;

drop policy if exists "Users read their own usage" on public.translate_usage;
create policy "Users read their own usage" on public.translate_usage
  for select to authenticated using (auth.uid() = user_id);
-- No insert/update/delete policies on purpose.

-- Uses one call of today's allowance for the signed-in user.
-- Returns how many calls are left today (0 … 49), or -1 if the limit was already reached
-- (in which case nothing is counted). Change the limit here: 50 calls per user per UTC day.
create or replace function public.consume_translate_quota()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  daily_limit constant int := 50;
  uid  uuid := auth.uid();
  used int;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  insert into public.translate_usage as u (user_id, day, count)
  values (uid, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set count = u.count + 1
    where u.count < daily_limit
  returning u.count into used;
  if used is null then
    return -1;
  end if;
  return daily_limit - used;
end;
$$;

revoke all on function public.consume_translate_quota() from public, anon;
grant execute on function public.consume_translate_quota() to authenticated;
