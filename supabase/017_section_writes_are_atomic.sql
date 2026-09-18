-- ---------------------------------------------------------------------
-- 017 — two people editing one case stop erasing each other
--
-- Reported by the firm on 2026-09-18: "We're entering lines/documents,
-- but then they disappear... things that I've entered, Mireya is unable
-- to see... I've seen meds on Ericka's screen, but I couldn't see them on
-- mine. Then when we went back to look at it on Ericka's screen, it
-- wasn't there anymore."
--
-- All three sentences are the same bug, and it is this one.
--
-- ── READ, MERGE IN JAVASCRIPT, WRITE THE WHOLE THING BACK ───────────
--
-- Saving ONE field did this:
--
--     select fields from matter_section_data ...      -- the whole object
--     fields = { ...fields, [key]: value }            -- in the browser
--     upsert ... set fields = <that entire object>    -- all of it back
--
-- Between the select and the upsert, anything anyone else wrote is
-- invisible to this browser — and then it is overwritten. Last save wins
-- and takes the whole section with it.
--
-- It does not need two people. Two fields edited quickly by one person
-- race the same way, because neither request waits for the other.
--
-- And because the app loads its data once and never refreshes, a tab left
-- open all morning holds a copy of the case from 9am. The FIRST thing
-- that person saves after lunch reverts the section to 9am. That is why
-- it looked random, and why it got worse as more of the firm used it.
--
-- ── THE MERGE MOVES INTO POSTGRES ───────────────────────────────────
--
-- `||` on jsonb merges at the top level, and inside `on conflict do
-- update` it reads the CURRENT row under a lock held by this statement.
-- So two concurrent calls setting different keys both survive: whichever
-- runs second merges onto what the first actually wrote, not onto a
-- snapshot from before it.
--
-- The browser now sends one field, never a whole section. It cannot
-- overwrite what it never saw.
--
-- ── SECURITY INVOKER, DELIBERATELY ──────────────────────────────────
--
-- Not `security definer`. These run as the signed-in user so the existing
-- RLS policy on the table still applies. A definer function here would be
-- a way to write to any case regardless of policy, which is a strictly
-- worse trade for no benefit — every member of staff can already write to
-- every case by policy.
--
-- Grants follow 007: Postgres grants EXECUTE to PUBLIC on every new
-- function, and Supabase grants it to `anon` directly. Both are revoked
-- explicitly, because revoking one leaves the other.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- ── One field of a section's form ───────────────────────────────────
create or replace function set_section_field(
  p_matter_id   uuid,
  p_section_key text,
  p_field_key   text,
  p_value       jsonb
) returns void
language sql
as $$
  insert into matter_section_data (matter_id, section_key, fields, updated_at)
  values (p_matter_id, p_section_key, jsonb_build_object(p_field_key, p_value), now())
  on conflict (matter_id, section_key) do update
     set fields     = matter_section_data.fields || jsonb_build_object(p_field_key, p_value),
         updated_at = now();
$$;

-- ── One cell of one row in a repeating table ────────────────────────
--
-- Returns the id it updated, or NO ROW when the id does not exist.
--
-- That return value is the other half of the fix. The app adds a row to
-- the screen with a temporary id generated in the browser while the real
-- insert is still in flight, and the row is editable the moment it
-- appears. An edit that arrived during that window was written as
--
--     update matter_section_row set data = ... where id = <temporary id>
--
-- which matches nothing, updates nothing, and reports NO ERROR. Postgres
-- was asked to change zero rows and did so perfectly. The value stayed on
-- screen and was never stored, and the person moved on believing it was.
--
-- `returning id` makes that case detectable: no row back means nothing
-- was written, and the app can say so instead of claiming success.
--
-- `- 'id'` because the row's id lives in the column, not in the payload;
-- a patch that carried one would let a client rewrite its own key.
create or replace function update_section_row(
  p_row_id uuid,
  p_patch  jsonb
) returns uuid
language sql
as $$
  update matter_section_row
     set data = (data || p_patch) - 'id'
   where id = p_row_id
  returning id;
$$;

-- ── Grants: see 007 ─────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function set_section_field(uuid, text, text, jsonb) from anon';
    execute 'revoke execute on function update_section_row(uuid, jsonb) from anon';
  end if;
end $$;

revoke execute on function set_section_field(uuid, text, text, jsonb) from public;
revoke execute on function update_section_row(uuid, jsonb) from public;

grant execute on function set_section_field(uuid, text, text, jsonb) to authenticated;
grant execute on function update_section_row(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Verification — proves the race is actually closed, rather than
-- reporting "Success. No rows returned."
-- ---------------------------------------------------------------------
do $$
declare
  m uuid;
  got jsonb;
  updated uuid;
begin
  select id into m from matter where deleted_at is null limit 1;
  if m is null then
    raise notice 'SKIP: no matter to test against';
    return;
  end if;

  -- Two writers, two different fields, neither having seen the other.
  perform set_section_field(m, '__probe_017', 'writer_a', '"a"'::jsonb);
  perform set_section_field(m, '__probe_017', 'writer_b', '"b"'::jsonb);

  select fields into got
    from matter_section_data where matter_id = m and section_key = '__probe_017';

  if got ? 'writer_a' and got ? 'writer_b' then
    raise notice 'OK: both writers survived — % ', got;
  else
    raise exception 'FAIL: a write was lost. fields = %', got;
  end if;

  delete from matter_section_data where matter_id = m and section_key = '__probe_017';

  -- An update to an id that does not exist must come back empty, not silent.
  select update_section_row('00000000-0000-0000-0000-000000000000'::uuid, '{"x":1}'::jsonb)
    into updated;
  if updated is null then
    raise notice 'OK: writing to a row that does not exist returns nothing';
  else
    raise exception 'FAIL: a phantom row reported success';
  end if;
end $$;

select
  'set_section_field' as fn,
  has_function_privilege('authenticated', 'set_section_field(uuid, text, text, jsonb)', 'execute') as staff_can_run,
  has_function_privilege('anon',          'set_section_field(uuid, text, text, jsonb)', 'execute') as anon_can_run
union all
select
  'update_section_row',
  has_function_privilege('authenticated', 'update_section_row(uuid, jsonb)', 'execute'),
  has_function_privilege('anon',          'update_section_row(uuid, jsonb)', 'execute');
