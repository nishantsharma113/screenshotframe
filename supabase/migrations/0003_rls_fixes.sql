-- Shotframe — RLS fixes found by supabase/tests/rls_test.sql
-- Run after 0001_init.sql and 0002_admin.sql. Safe to run more than once.

-- 1. Users can read (list) the files in their own folder.
--    0001 had INSERT / UPDATE / DELETE but no SELECT. The Storage API needs SELECT
--    for remove() and for uploads with upsert, so deleteScreenshot() silently did
--    nothing. The bucket stays public, so <img> URLs work as before; this only
--    affects API calls, and only for the owner's own folder.
drop policy if exists "Users read their own files" on storage.objects;
create policy "Users read their own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Spell out WITH CHECK on file updates, so a rename can never move a file into
--    someone else's folder. (Postgres already reuses USING when WITH CHECK is
--    missing; this makes the rule explicit and protects against a future edit.)
drop policy if exists "Users update their own files" on storage.objects;
create policy "Users update their own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
