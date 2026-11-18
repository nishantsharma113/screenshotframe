-- Shotframe — saved templates (Standard plan feature, enforced in the app)
-- Run after 0001–0004. Safe to run more than once.
--
-- A template is a design without screenshots. Its background image, if any, is a copy at
-- screenshots/<user_id>/templates/<template_id>/… (covered by the existing per-user folder
-- policies), so deleting the project it came from can't break the template.

create table if not exists public.user_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  design      jsonb not null check (jsonb_typeof(design) = 'object'),
  created_at  timestamptz not null default now()
);

create index if not exists user_templates_user_idx on public.user_templates (user_id, created_at desc);

alter table public.user_templates enable row level security;

drop policy if exists "Owners select templates" on public.user_templates;
create policy "Owners select templates" on public.user_templates
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Owners insert templates" on public.user_templates;
create policy "Owners insert templates" on public.user_templates
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Owners update templates" on public.user_templates;
create policy "Owners update templates" on public.user_templates
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Owners delete templates" on public.user_templates;
create policy "Owners delete templates" on public.user_templates
  for delete to authenticated using (auth.uid() = user_id);
