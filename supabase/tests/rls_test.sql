-- ─────────────────────────────────────────────────────────────
-- Shotframe — Row Level Security test
--
-- Run in the Supabase SQL Editor (paste the whole file → Run) after the migrations.
--
-- Everything runs inside ONE DO block, so it is all-or-nothing:
--   • a failed check RAISEs "FAIL: …" and Postgres rolls back the whole block,
--     so the test users, projects and files are never saved;
--   • if every check passes, the cleanup at the end removes them and the
--     final SELECT prints "All RLS checks passed".
--
-- How users are simulated: the same way PostgREST / the Storage API do it —
-- switch to the `authenticated` or `anon` role and set the JWT claims, so
-- auth.uid() returns the test user's id and every RLS policy applies for real.
-- Each "cannot" check is paired with a "can" control on the user's own data,
-- so a check can't pass by accident (for example if auth.uid() were null).
--
-- Why some writes have no WHERE ("blind" writes): when an UPDATE/DELETE has a
-- WHERE clause, Postgres first filters rows through the SELECT policy. So
-- "update … where id = B's project" returns 0 rows even if the UPDATE policy
-- itself were `using (true)`. A blind write is checked only against the
-- UPDATE/DELETE policy, so it proves those policies on their own. Afterwards
-- the postgres role confirms B's rows are untouched.
-- ─────────────────────────────────────────────────────────────

do $rls_test$
declare
  uid_a      uuid := gen_random_uuid();
  uid_b      uuid := gen_random_uuid();
  tag        text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  proj_a     uuid;
  proj_b     uuid;
  file_b     text;
  file_a     text;
  n          bigint;
  has_admin_col  boolean;
  has_make_admin boolean;
  sees_own_files boolean;
  has_fonts      boolean;   -- 0004_fonts.sql installed?
  font_b         text;
  font_row_b     uuid;
  has_tpl        boolean;   -- 0005_user_templates.sql installed?
  has_quota      boolean;   -- 0006_translate_usage.sql installed?
  left_today     int;
  tpl_b          uuid;
begin
  -- ── Setup (as the SQL editor's postgres role, which bypasses RLS) ──────────
  if not exists (select 1 from storage.buckets where id = 'screenshots') then
    raise exception 'SETUP: the "screenshots" bucket is missing. Run supabase/migrations/0001_init.sql first.';
  end if;

  -- Newer Supabase blocks plain SQL deletes on storage tables unless this is set.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Only columns every Supabase version has; these users never sign in.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (uid_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls-test-a-' || tag || '@example.test', '',
     '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    (uid_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls-test-b-' || tag || '@example.test', '',
     '{"provider":"email","providers":["email"]}', '{}', now(), now());

  -- The on_auth_user_created trigger should have made both profiles.
  select count(*) into n from public.profiles where id in (uid_a, uid_b) and plan = 'basic';
  if n <> 2 then
    raise exception 'SETUP: expected 2 basic profiles from the signup trigger, found %', n;
  end if;

  insert into public.projects (user_id, name, design) values (uid_a, 'A project', '{}') returning id into proj_a;
  insert into public.projects (user_id, name, design) values (uid_b, 'B project', '{}') returning id into proj_b;

  file_a := uid_a::text || '/' || proj_a::text || '/a.png';
  file_b := uid_b::text || '/' || proj_b::text || '/b.png';
  insert into storage.objects (bucket_id, name, owner) values ('screenshots', file_b, uid_b);

  has_admin_col := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_admin');
  has_make_admin := to_regprocedure('public.make_admin(text)') is not null;
  has_quota := to_regclass('public.translate_usage') is not null
               and to_regprocedure('public.consume_translate_quota()') is not null;
  if has_quota then
    insert into public.translate_usage (user_id, day, count) values (uid_b, (now() at time zone 'utc')::date, 7);
  end if;
  has_tpl := to_regclass('public.user_templates') is not null;
  if has_tpl then
    insert into public.user_templates (user_id, name, design) values (uid_b, 'B template', '{"background":"#000000"}') returning id into tpl_b;
  end if;
  has_fonts := to_regclass('public.user_fonts') is not null
               and exists (select 1 from storage.buckets where id = 'fonts');

  if has_fonts then
    if (select public from storage.buckets where id = 'fonts') then
      raise exception 'FAIL: the fonts bucket is public; it must be private';
    end if;
    font_b := uid_b::text || '/b-font.ttf';
    insert into storage.objects (bucket_id, name, owner) values ('fonts', font_b, uid_b);
    insert into public.user_fonts (user_id, family, path) values (uid_b, 'B font', font_b) returning id into font_row_b;
  end if;

  -- ── Act as user A ─────────────────────────────────────────
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid_a::text, true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', uid_a, 'role', 'authenticated')::text, true);

  if auth.uid() is distinct from uid_a then
    raise exception 'SETUP: auth.uid() is %, expected user A (%)', auth.uid(), uid_a;
  end if;

  -- Projects: control — A sees their own project
  select count(*) into n from public.projects where id = proj_a;
  if n <> 1 then raise exception 'FAIL: user A cannot see their own project (control check)'; end if;

  -- 1. A cannot SELECT B's project
  select count(*) into n from public.projects where id = proj_b;
  if n <> 0 then raise exception 'FAIL: user A can SELECT user B''s project'; end if;
  select count(*) into n from public.projects where user_id = uid_b;
  if n <> 0 then raise exception 'FAIL: user A can list user B''s projects'; end if;

  -- 2. A cannot UPDATE B's project
  update public.projects set name = 'hacked by A' where id = proj_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A can UPDATE user B''s project'; end if;

  -- 2b. A cannot hand their own project to B (WITH CHECK on update; blind, see header)
  begin
    update public.projects set user_id = uid_b;
    raise exception 'FAIL: user A can move their project into user B''s account';
  exception when insufficient_privilege then null; -- 42501: blocked by RLS, as expected
  end;

  -- 2c. A cannot create a project owned by B
  begin
    insert into public.projects (user_id, name, design) values (uid_b, 'planted by A', '{}');
    raise exception 'FAIL: user A can INSERT a project owned by user B';
  exception when insufficient_privilege then null;
  end;

  -- 3. A cannot DELETE B's project
  delete from public.projects where id = proj_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A can DELETE user B''s project'; end if;

  -- Profiles: control — A reads their own profile, but not B's
  select count(*) into n from public.profiles where id = uid_a;
  if n <> 1 then raise exception 'FAIL: user A cannot read their own profile (control check)'; end if;
  select count(*) into n from public.profiles where id = uid_b;
  if n <> 0 then raise exception 'FAIL: user A can read user B''s profile'; end if;

  -- 4. A cannot change their own plan (no UPDATE policy on profiles)
  update public.profiles set plan = 'extended' where id = uid_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A can change their own profiles.plan'; end if;

  -- 4b. …nor make themselves admin (column from 0002_admin.sql, if installed)
  if has_admin_col then
    execute format('update public.profiles set is_admin = true where id = %L', uid_a);
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user A can set their own profiles.is_admin'; end if;
  end if;

  -- 4c. …nor call make_admin() through the API
  if has_make_admin then
    begin
      execute format('select public.make_admin(%L)', 'rls-test-a-' || tag || '@example.test');
      raise exception 'FAIL: user A can call public.make_admin()';
    exception when insufficient_privilege then null;
    end;
  end if;

  -- 4d. …nor insert a second profile row with a better plan
  begin
    insert into public.profiles (id, email, plan) values (gen_random_uuid(), 'x@example.test', 'extended');
    raise exception 'FAIL: user A can INSERT a profile row';
  exception
    when insufficient_privilege then null;
    -- Got past RLS and was only stopped by a constraint: the INSERT policy is too open.
    when foreign_key_violation or unique_violation then
      raise exception 'FAIL: user A can INSERT a profile row (only a constraint stopped it)';
  end;

  -- Storage: control — A can upload into their own folder
  begin
    insert into storage.objects (bucket_id, name, owner) values ('screenshots', file_a, uid_a);
  exception when insufficient_privilege then
    raise exception 'FAIL: user A cannot upload into their own folder (control check)';
  end;

  -- 5. A cannot upload into B's folder
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('screenshots', uid_b::text || '/' || proj_b::text || '/planted.png', uid_a);
    raise exception 'FAIL: user A can upload into user B''s folder';
  exception when insufficient_privilege then null;
  end;

  -- 5b. A cannot move their own file into B's folder (rename = UPDATE)
  begin
    update storage.objects set name = uid_b::text || '/moved.png' where bucket_id = 'screenshots' and name = file_a;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user A can move a file into user B''s folder'; end if;
  exception when insufficient_privilege then null;
  end;

  -- 5c. A cannot see, overwrite or rename B's file
  select count(*) into n from storage.objects where bucket_id = 'screenshots' and name = file_b;
  if n <> 0 then raise exception 'FAIL: user A can list user B''s file'; end if;
  update storage.objects set name = uid_a::text || '/stolen.png' where bucket_id = 'screenshots' and name = file_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A can UPDATE user B''s file'; end if;

  -- 6. A cannot delete from B's folder
  delete from storage.objects where bucket_id = 'screenshots' and name = file_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A can DELETE user B''s file'; end if;

  -- 11. Auto-translate limit (0006_translate_usage.sql)
  if has_quota then
    select public.consume_translate_quota() into left_today;            -- control: A's first call
    if left_today <> 49 then raise exception 'FAIL: first translate call should leave 49, got %', left_today; end if;
    select count(*) into n from public.translate_usage where user_id = uid_a and count = 1;
    if n <> 1 then raise exception 'FAIL: user A cannot read their own usage (control check)'; end if;
    select count(*) into n from public.translate_usage where user_id = uid_b;
    if n <> 0 then raise exception 'FAIL: user A can read user B''s translate usage'; end if;
    begin
      insert into public.translate_usage (user_id, day, count) values (uid_a, (now() at time zone 'utc')::date - 1, 0);
      raise exception 'FAIL: user A can INSERT usage rows directly';
    exception when insufficient_privilege then null;
    end;
    update public.translate_usage set count = 0;   -- blind: try to reset own (or anyone's) counter
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user A can reset translate usage'; end if;
    delete from public.translate_usage;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user A can delete translate usage'; end if;
    -- Use up the rest of today's allowance: calls 2..50 succeed, the 51st is refused and not counted.
    for i in 2..50 loop
      select public.consume_translate_quota() into left_today;
    end loop;
    if left_today <> 0 then raise exception 'FAIL: 50th call should leave 0, got %', left_today; end if;
    select public.consume_translate_quota() into left_today;
    if left_today <> -1 then raise exception 'FAIL: 51st translate call was allowed (got %)', left_today; end if;
  end if;

  -- 10. Saved templates (0005_user_templates.sql): owner-only rows
  if has_tpl then
    insert into public.user_templates (user_id, name, design) values (uid_a, 'A template', '{}');   -- control
    select count(*) into n from public.user_templates where user_id = uid_a;
    if n <> 1 then raise exception 'FAIL: user A cannot see their own template (control check)'; end if;
    select count(*) into n from public.user_templates where id = tpl_b;
    if n <> 0 then raise exception 'FAIL: user A can SELECT user B''s template'; end if;
    begin
      insert into public.user_templates (user_id, name, design) values (uid_b, 'planted', '{}');
      raise exception 'FAIL: user A can INSERT a template owned by user B';
    exception when insufficient_privilege then null;
    end;
    begin
      update public.user_templates set user_id = uid_b;   -- blind: hand own template to B
      raise exception 'FAIL: user A can move their template to user B';
    exception when insufficient_privilege then null;
    end;
    update public.user_templates set name = 'hacked by A';   -- blind (see header)
    delete from public.user_templates;                       -- blind
  end if;

  -- 9. Fonts (0004_fonts.sql): owner-only rows and files
  if has_fonts then
    -- control: A can add and see their own font
    insert into public.user_fonts (user_id, family, path) values (uid_a, 'A font', uid_a::text || '/a-font.ttf');
    insert into storage.objects (bucket_id, name, owner) values ('fonts', uid_a::text || '/a-font.ttf', uid_a);
    select count(*) into n from public.user_fonts where user_id = uid_a;
    if n <> 1 then raise exception 'FAIL: user A cannot see their own font row (control check)'; end if;
    select count(*) into n from storage.objects where bucket_id = 'fonts' and name = uid_a::text || '/a-font.ttf';
    if n <> 1 then raise exception 'FAIL: user A cannot read their own font file, so signed URLs fail (control check)'; end if;

    select count(*) into n from public.user_fonts where id = font_row_b;
    if n <> 0 then raise exception 'FAIL: user A can SELECT user B''s font row'; end if;
    select count(*) into n from storage.objects where bucket_id = 'fonts' and name = font_b;
    if n <> 0 then raise exception 'FAIL: user A can read user B''s font file'; end if;

    begin
      insert into public.user_fonts (user_id, family, path) values (uid_b, 'planted', uid_b::text || '/p.ttf');
      raise exception 'FAIL: user A can INSERT a font row owned by user B';
    exception when insufficient_privilege then null;
    end;
    begin
      -- Own row, but pointing at B's file: blocked by the path check constraint.
      insert into public.user_fonts (user_id, family, path) values (uid_a, 'borrowed', font_b);
      raise exception 'FAIL: user A can register user B''s font file as their own';
    exception when check_violation then null;
    end;
    begin
      insert into storage.objects (bucket_id, name, owner) values ('fonts', uid_b::text || '/planted.ttf', uid_a);
      raise exception 'FAIL: user A can upload into user B''s fonts folder';
    exception when insufficient_privilege then null;
    end;

    -- Blind writes (see header); checked as postgres below.
    update public.user_fonts set family = 'hacked by A';
    delete from public.user_fonts;
  end if;

  -- Informational: the Storage API's remove() and upsert need SELECT on your own files.
  select count(*) > 0 into sees_own_files from storage.objects where bucket_id = 'screenshots' and name = file_a;

  -- Blind writes (no WHERE, see header). Each may touch A's own rows — that's allowed —
  -- and the postgres checks below fail if any of B's rows were affected.
  update public.projects set name = 'hacked by A';                         -- 2d. UPDATE policy
  update storage.objects set metadata = '{"hacked": true}'::jsonb;         -- 5d. storage UPDATE policy
  delete from storage.objects;                                             -- 6b. storage DELETE policy
  delete from public.projects;                                             -- 3b. DELETE policy (removes A's own project too)

  -- ── Act as a signed-out visitor (anon) ────────────────────
  reset role;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  -- 7. anon CAN read templates
  select count(*) into n from public.templates;
  if n = 0 then raise exception 'FAIL: anon cannot read templates (or none are seeded)'; end if;

  -- 8. anon cannot read projects or profiles (0 rows, or no table access at all)
  begin
    select count(*) into n from public.projects;
    if n <> 0 then raise exception 'FAIL: anon can read % project(s)', n; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into n from public.profiles;
    if n <> 0 then raise exception 'FAIL: anon can read % profile(s)', n; end if;
  exception when insufficient_privilege then null;
  end;

  if has_fonts then
    begin
      select count(*) into n from public.user_fonts;
      if n <> 0 then raise exception 'FAIL: anon can read % font row(s)', n; end if;
    exception when insufficient_privilege then null;
    end;
    begin
      select count(*) into n from storage.objects where bucket_id = 'fonts';
      if n <> 0 then raise exception 'FAIL: anon can list % font file(s)', n; end if;
    exception when insufficient_privilege then null;
    end;
  end if;

  if has_tpl then
    begin
      select count(*) into n from public.user_templates;
      if n <> 0 then raise exception 'FAIL: anon can read % saved template(s)', n; end if;
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.user_templates (user_id, name, design) values (uid_b, 'anon', '{}');
      raise exception 'FAIL: anon can INSERT a saved template';
    exception when insufficient_privilege or not_null_violation then null;
    end;
  end if;

  if has_quota then
    begin
      select public.consume_translate_quota() into left_today;
      raise exception 'FAIL: anon can call consume_translate_quota()';
    -- 42501: no execute grant; 28000: the function's own "not signed in" guard (defence in depth).
    exception when insufficient_privilege or invalid_authorization_specification then null;
    end;
  end if;

  -- 8b. anon cannot write templates or projects
  begin
    insert into public.templates (id, name, category, store, design)
    values ('rls-test-' || tag, 'x', 'Minimal', 'both', '{}');
    raise exception 'FAIL: anon can INSERT a template';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.projects (user_id, name, design) values (uid_b, 'anon', '{}');
    raise exception 'FAIL: anon can INSERT a project';
  exception when insufficient_privilege then null;
  end;

  -- ── Back to postgres: confirm nothing actually changed, then clean up ──────
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  if not exists (select 1 from public.projects where id = proj_b) then
    raise exception 'FAIL: user A can DELETE user B''s project (blind delete)';
  end if;
  if not exists (select 1 from public.projects where id = proj_b and name = 'B project' and user_id = uid_b) then
    raise exception 'FAIL: user A can UPDATE user B''s project (blind update)';
  end if;
  if exists (select 1 from public.projects where id = proj_a) then
    raise exception 'FAIL: user A could not delete their own project (control check)';
  end if;
  if exists (select 1 from public.profiles where id = uid_a and plan <> 'basic') then
    raise exception 'FAIL: user A''s plan changed';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'screenshots' and name = file_b) then
    raise exception 'FAIL: user A can DELETE or move user B''s file (blind delete)';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'screenshots' and name = file_b and metadata ? 'hacked') then
    raise exception 'FAIL: user A can UPDATE user B''s file (blind update)';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'screenshots' and name = file_a) then
    raise exception 'FAIL: user A could not delete their own file (control check)';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'screenshots' and name like uid_b::text || '/%' and name <> file_b) then
    raise exception 'FAIL: a file was planted in user B''s folder';
  end if;
  if has_quota then
    if not exists (select 1 from public.translate_usage where user_id = uid_b and count = 7) then
      raise exception 'FAIL: user B''s translate usage was changed';
    end if;
    if not exists (select 1 from public.translate_usage where user_id = uid_a and count = 50) then
      raise exception 'FAIL: user A''s usage should be exactly 50 (refused calls must not count)';
    end if;
  end if;
  if has_tpl then
    if not exists (select 1 from public.user_templates where id = tpl_b and name = 'B template' and user_id = uid_b) then
      raise exception 'FAIL: user A changed or deleted user B''s template (blind write)';
    end if;
    if exists (select 1 from public.user_templates where user_id = uid_a) then
      raise exception 'FAIL: user A could not delete their own template (control check)';
    end if;
  end if;
  if has_fonts then
    if not exists (select 1 from public.user_fonts where id = font_row_b and family = 'B font') then
      raise exception 'FAIL: user A changed or deleted user B''s font row (blind write)';
    end if;
    if exists (select 1 from public.user_fonts where user_id = uid_a) then
      raise exception 'FAIL: user A could not delete their own font row (control check)';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'fonts' and name = font_b and not coalesce(metadata ? 'hacked', false)) then
      raise exception 'FAIL: user A changed or deleted user B''s font file (blind write)';
    end if;
    if exists (select 1 from storage.objects where bucket_id = 'fonts' and name = uid_a::text || '/a-font.ttf') then
      raise exception 'FAIL: user A could not delete their own font file (control check)';
    end if;
  end if;

  delete from storage.objects
   where bucket_id in ('screenshots', 'fonts') and (name like uid_a::text || '/%' or name like uid_b::text || '/%');
  delete from auth.users where id in (uid_a, uid_b); -- cascades to profiles and projects

  if exists (select 1 from public.profiles where id in (uid_a, uid_b))
     or exists (select 1 from public.projects where user_id in (uid_a, uid_b)) then
    raise exception 'CLEANUP: test rows were left behind';
  end if;

  if not sees_own_files then
    raise notice 'NOTE: users cannot SELECT their own files, so the Storage API''s remove() and upsert fail. Run 0003_rls_fixes.sql.';
  end if;
end
$rls_test$;

select 'All RLS checks passed' as result;
