-- Shotframe — initial schema
-- Run in Supabase SQL editor, or with the Supabase CLI: `supabase db push`

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Profiles (one row per auth user; holds the plan)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  plan        text not null default 'basic'
              check (plan in ('basic', 'standard', 'extended')),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read their own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);
-- No update policy on purpose: the plan is changed only with the
-- service-role key (for example from a payment webhook), never by the client.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Projects (one screenshot set per row; the design is JSON)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  name        text not null default 'Untitled project'
              check (char_length(name) between 1 and 120),
  design      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

create policy "Owners select projects" on public.projects
  for select to authenticated using (auth.uid() = user_id);
create policy "Owners insert projects" on public.projects
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Owners update projects" on public.projects
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners delete projects" on public.projects
  for delete to authenticated using (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Templates (public, read-only for clients)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.templates (
  id          text primary key,
  name        text not null,
  category    text not null
              check (category in ('Minimal', 'Bold', 'Panoramic', 'Dark', 'Playful')),
  store       text not null check (store in ('both', 'ios', 'play')),
  design      jsonb not null,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.templates enable row level security;

create policy "Anyone reads templates" on public.templates
  for select to anon, authenticated using (true);

insert into public.templates (id, name, category, store, sort, design) values
  ('indigo-wave',  'Indigo Wave',  'Panoramic', 'both', 1, '{"background":"#4F46E5","panoramic":true,"layout":"top","font":"Space Grotesk","angle":"flat"}'),
  ('paper-clean',  'Paper Clean',  'Minimal',   'both', 2, '{"background":"#F5F5F4","panoramic":false,"layout":"top","font":"Inter","angle":"flat"}'),
  ('night-mode',   'Night Mode',   'Dark',      'ios',  3, '{"background":"#0F172A","panoramic":true,"layout":"top","font":"Inter","angle":"flat"}'),
  ('citrus-pop',   'Citrus Pop',   'Bold',      'play', 4, '{"background":"#EA580C","panoramic":true,"layout":"bottom","font":"Poppins","angle":"flat"}'),
  ('forest-calm',  'Forest Calm',  'Minimal',   'play', 5, '{"background":"#047857","panoramic":false,"layout":"top","font":"Inter","angle":"flat"}'),
  ('butter-day',   'Butter Day',   'Playful',   'ios',  6, '{"background":"#FDE68A","panoramic":true,"layout":"top","font":"Poppins","angle":"flat"}'),
  ('rose-bold',    'Rose Bold',    'Bold',      'both', 7, '{"background":"#BE123C","panoramic":false,"layout":"bottom","font":"Space Grotesk","angle":"flat"}'),
  ('sky-sweep',    'Sky Sweep',    'Panoramic', 'ios',  8, '{"background":"#0369A1","panoramic":true,"layout":"top","font":"Space Grotesk","angle":"flat"}')
on conflict (id) do update
  set name = excluded.name, category = excluded.category, store = excluded.store,
      sort = excluded.sort, design = excluded.design;

-- ─────────────────────────────────────────────────────────────
-- Storage: uploaded app screenshots
-- Files live at  screenshots/<user_id>/<project_id>/<file>
-- The bucket is public so exported images can load them without signed URLs.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "Users upload to their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update their own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete their own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
