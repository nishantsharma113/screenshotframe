-- Shotframe — custom font upload
-- Run after 0001–0003. Safe to run more than once.
-- (Named 0004: 0003 is already rls_fixes.)

-- ─────────────────────────────────────────────────────────────
-- Storage: fonts live at  fonts/<user_id>/<font_id>.<ext>
-- Private bucket: files are read through short-lived signed URLs, which
-- need the SELECT policy below (only the owner can create them).
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fonts', 'fonts', false, 2097152, array['font/ttf', 'font/otf', 'font/woff2'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their own fonts" on storage.objects;
create policy "Users read their own fonts" on storage.objects
  for select to authenticated
  using (bucket_id = 'fonts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users upload their own fonts" on storage.objects;
create policy "Users upload their own fonts" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fonts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update their own fonts" on storage.objects;
create policy "Users update their own fonts" on storage.objects
  for update to authenticated
  using (bucket_id = 'fonts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fonts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete their own fonts" on storage.objects;
create policy "Users delete their own fonts" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fonts' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────
-- user_fonts: one row per uploaded font
-- ─────────────────────────────────────────────────────────────
create table if not exists public.user_fonts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  family      text not null check (char_length(family) between 1 and 80),
  path        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, family),
  -- The file must sit in the owner's own folder of the fonts bucket.
  constraint user_fonts_path_in_own_folder check (split_part(path, '/', 1) = user_id::text)
);

create index if not exists user_fonts_user_idx on public.user_fonts (user_id, created_at);

alter table public.user_fonts enable row level security;

drop policy if exists "Owners select fonts" on public.user_fonts;
create policy "Owners select fonts" on public.user_fonts
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Owners insert fonts" on public.user_fonts;
create policy "Owners insert fonts" on public.user_fonts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Owners update fonts" on public.user_fonts;
create policy "Owners update fonts" on public.user_fonts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Owners delete fonts" on public.user_fonts;
create policy "Owners delete fonts" on public.user_fonts
  for delete to authenticated using (auth.uid() = user_id);
