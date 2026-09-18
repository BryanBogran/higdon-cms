-- ---------------------------------------------------------------------
-- 019 — the medical records get a history too
--
-- On 2026-09-18 the firm reported that medical records had disappeared
-- from Hollister, Courtney ANF Charles Wyatt 23-235, and the honest
-- answer was that nobody could say what happened to them.
--
-- `matter`, `matter_checklist_item`, `activity` and `contact` have
-- carried an audit trigger since day one. `matter_section_data` and
-- `matter_section_row` never did — and those two hold the medical
-- records, the provider bills, the expenses, the depositions and every
-- other repeating table in the app.
--
-- So the tables holding the least recoverable information had the least
-- protection. This closes that.
--
-- ── What it buys ────────────────────────────────────────────────────
--
-- `audit_event` records the OLD ROW on every update and delete. After
-- this, a row deleted or overwritten in any section can be read back in
-- full, with who did it and when — and restored by hand from the
-- recorded JSON. Today it simply ceases to exist.
--
-- ── row_pk has to be taught these two tables ────────────────────────
--
-- ⚠️ THE PART THAT WOULD HAVE BEEN WRONG BY DEFAULT. `audit_row()` falls
-- through to `{id, matter_id}` for anything it does not recognise.
--
--   matter_section_row   has both, so it would have worked — but without
--                        section_key you cannot ask "what was deleted
--                        from Medicals" without opening every row.
--
--   matter_section_data  HAS NO `id` COLUMN AT ALL. Its key is
--                        (matter_id, section_key), so the fallback would
--                        have written {"id": null, ...} and lost which
--                        section the record belonged to — an audit log
--                        that records that something changed but not
--                        what. Worse than none, because it looks fine.
--
-- Both get an explicit branch. `audit_by_matter` already indexes
-- row_pk->>'matter_id', so both are queryable from day one.
--
-- ── ⚠️ This costs disk, and the number is stated ────────────────────
--
-- Every section write now stores a before and an after. At the firm's
-- volume — and AFTER the write debounce, which cut writes by roughly a
-- factor of ten — expect somewhere around 30–60 MB a month.
--
-- The free Supabase tier is 500 MB total. That is comfortable for most
-- of a year and then it is not, so the last query here reports the size
-- and it is worth a look each month.
--
-- Pruning is deliberately NOT included. On a law firm's file the audit
-- log is the thing you least want thrown away, and how long to keep it
-- is a decision for the firm rather than for this migration.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- ── Teach audit_row() the two section tables ────────────────────────
create or replace function audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then audit_redact(to_jsonb(old)) end;
  v_new jsonb := case when tg_op <> 'DELETE' then audit_redact(to_jsonb(new)) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into audit_event (actor_id, table_name, row_pk, op, changed_cols, old_row, new_row)
  values (
    auth.uid(),
    tg_table_name,
    case tg_table_name
      when 'matter' then
        jsonb_build_object('matter_id', v_row->>'id')
      when 'matter_checklist_item' then
        jsonb_build_object('matter_id', v_row->>'matter_id',
                           'field_key', v_row->>'field_key')
      -- NEW: composite key, and no `id` column to fall back on.
      when 'matter_section_data' then
        jsonb_build_object('matter_id',   v_row->>'matter_id',
                           'section_key', v_row->>'section_key')
      -- NEW: has an id, but section_key is what makes it searchable.
      when 'matter_section_row' then
        jsonb_build_object('id',          v_row->>'id',
                           'matter_id',   v_row->>'matter_id',
                           'section_key', v_row->>'section_key')
      else
        jsonb_build_object('id',        v_row->>'id',
                           'matter_id', v_row->>'matter_id')
    end,
    left(tg_op, 1),
    case when tg_op = 'UPDATE' then (
      select array_agg(key) from jsonb_each(v_new)
       where v_old -> key is distinct from v_new -> key
    ) end,
    v_old, v_new
  );
  return null;
end $$;

-- ── The triggers ────────────────────────────────────────────────────
drop trigger if exists audit_section_data on matter_section_data;
create trigger audit_section_data
  after insert or update or delete on matter_section_data
  for each row execute function audit_row();

drop trigger if exists audit_section_row on matter_section_row;
create trigger audit_section_row
  after insert or update or delete on matter_section_row
  for each row execute function audit_row();

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
do $$
declare
  m uuid;
  probe uuid;
  logged jsonb;
begin
  select id into m from matter where deleted_at is null limit 1;
  if m is null then
    raise notice 'SKIP: no matter to test against';
    return;
  end if;

  -- Write a row, delete it, and check the deletion is recoverable.
  insert into matter_section_row (matter_id, section_key, ordinal, data)
  values (m, '__probe_019', 0, '{"provider":"probe"}'::jsonb)
  returning id into probe;

  delete from matter_section_row where id = probe;

  select old_row into logged
    from audit_event
   where table_name = 'matter_section_row'
     and op = 'D'
     and (row_pk ->> 'id') = probe::text
   limit 1;

  if logged is null then
    raise exception 'FAIL: a deleted section row left no audit trail';
  end if;
  if logged -> 'data' ->> 'provider' is distinct from 'probe' then
    raise exception 'FAIL: the old row was recorded but its contents were not: %', logged;
  end if;

  -- And that the section is identifiable, which the default would have lost.
  if not exists (
    select 1 from audit_event
     where table_name = 'matter_section_row'
       and (row_pk ->> 'id') = probe::text
       and (row_pk ->> 'section_key') = '__probe_019'
  ) then
    raise exception 'FAIL: the audit row does not say which section it came from';
  end if;

  raise notice 'OK: a deleted section row is recorded in full and can be restored';
  raise notice 'NOTE: two audit rows under section_key __probe_019 record this check.';
end $$;

-- ---------------------------------------------------------------------
-- ⚠️ THE PROBE'S OWN AUDIT ROWS ARE LEFT IN PLACE, DELIBERATELY.
--
-- An earlier version of this file ended by deleting them, and got:
--
--   ERROR: P0001: audit_event is append-only
--   CONTEXT: PL/pgSQL function audit_immutable()
--
-- Which is the log working. `audit_no_rowmod` blocks UPDATE and DELETE on
-- audit_event because a history that can be edited is not a history --
-- and the schema says so explicitly: "A REVOKE alone would not restrain a
-- table owner."
--
-- Tidying them away would have meant falsifying the record of a thing
-- that genuinely happened, using a mechanism that exists precisely to
-- stop that. So the two rows stay. They are labelled `__probe_019` and
-- carry no client data, and two rows in a table that will hold hundreds
-- of thousands is not clutter worth breaking a guarantee for.
-- ---------------------------------------------------------------------

-- Which tables now have a history, and which do not.
select
  t.tablename,
  exists (
    select 1 from pg_trigger g
     where g.tgrelid = format('public.%I', t.tablename)::regclass
       and g.tgname like 'audit%'
       and not g.tgisinternal
  ) as has_audit_trail
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in (
    'matter', 'matter_checklist_item', 'activity', 'contact',
    'matter_section_data', 'matter_section_row'
  )
order by t.tablename;

-- Keep an eye on this. See the note on disk above.
select
  pg_size_pretty(pg_total_relation_size('audit_event')) as audit_log_size,
  count(*)                                              as events,
  min(occurred_at)::date                                as oldest,
  max(occurred_at)::date                                as newest
from audit_event;
