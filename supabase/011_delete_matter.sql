-- ---------------------------------------------------------------------
-- 011 — permanent deletion of a matter
--
-- ⚠️ REVISED. The first version of this file did not run: it tried to
-- delete the matter's rows out of audit_event and was stopped by the
-- `audit_no_rowmod` trigger with
--
--     ERROR: audit_event is append-only
--
-- That trigger was right and this file was wrong. audit_event has RLS
-- with a SELECT-only policy, so no client can touch it; the trigger
-- exists precisely to stop a SECURITY DEFINER function — this one — from
-- doing what a client cannot. Its comment says so: "A REVOKE alone would
-- not restrain a table owner."
--
-- ── Why I am not working around it ────────────────────────────────────
--
-- I could have the trigger stand aside for a session flag this function
-- sets. I am not going to, because the reasoning behind the original
-- version does not survive contact with the question "what is the audit
-- log FOR".
--
-- It is there so nobody can quietly rewrite history. A firm where a case
-- and every trace of it can be removed from one web button has an audit
-- log that proves nothing, because the act of covering the tracks is
-- itself one of the things it can be used to do. That is a bad property
-- for a law firm and a worse one for the person who later has to say
-- under oath what the system does.
--
-- The justification I gave was disk space, and I had already established
-- in 012 that it is not real: DELETE frees nothing until autovacuum, the
-- rows are small, and they are already redacted for SSN, date of birth
-- and document URLs.
--
-- So the history STAYS. The case goes.
--
-- ── What that means in practice ───────────────────────────────────────
--
-- Deleting the matter fires the ordinary audit triggers on it and on
-- every cascaded child, so the audit log ends up holding a full, dated,
-- attributed record of the removal. This function adds one more row
-- carrying the thing those cannot: WHY, in the words of the person who
-- did it.
--
-- If the firm ever genuinely needs history erased — a case imported with
-- another client's data, a court-ordered expungement — that is a
-- deliberate act for a person with database access, not an API:
--
--     alter table audit_event disable trigger audit_no_rowmod;
--     delete from audit_event where row_pk->>'matter_id' = '<uuid>';
--     alter table audit_event enable  trigger audit_no_rowmod;
--
-- Three statements, run knowingly, that leave the trigger back on. That
-- is the right amount of friction for erasing a legal record.
--
-- ── What gets deleted ─────────────────────────────────────────────────
--
-- Everything hangs off `matter` with ON DELETE CASCADE: checklist items,
-- activity, tasks, section data, section rows and relations. Handled by
-- the database and not listed here.
--
-- The Drive folder is NOT touched. It lives in Google, nothing here
-- should reach into it, and the app says so on the button — silently
-- binning a client's medical records because someone tidied a case list
-- would be indefensible.
--
-- Safe to re-run; replaces the earlier version in place.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- legal_hold, finally enforced
--
-- The column has existed since the first schema and nothing has ever
-- checked it. A flag that stops nothing is worse than no flag, because
-- people rely on it.
--
-- Enforced with a TRIGGER, not inside the function below, so it holds no
-- matter how the delete arrives: the app, the SQL editor, a future API
-- route, or a `delete from matter` typed by hand at 6pm. RLS lets any
-- signed-in user issue a DELETE on this table, so the invariant cannot
-- live in one code path.
-- ---------------------------------------------------------------------
create or replace function refuse_delete_on_legal_hold()
returns trigger language plpgsql as $$
begin
  if old.legal_hold then
    raise exception
      'Matter % (%) is under legal hold and cannot be deleted. Clear legal_hold first.',
      coalesce(old.case_number, '<no number>'), old.id
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;

drop trigger if exists matter_legal_hold_guard on matter;
create trigger matter_legal_hold_guard
  before delete on matter
  for each row execute function refuse_delete_on_legal_hold();


-- ---------------------------------------------------------------------
-- delete_matter(uuid, text) -> jsonb
--
-- SECURITY DEFINER so it can write the tombstone into audit_event, which
-- no client may write to directly.
--
-- Returns a summary rather than void, so the app can tell the user what
-- actually went instead of "done".
-- ---------------------------------------------------------------------
create or replace function delete_matter(p_matter_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_number text;
  v_hold        boolean;
  v_children    jsonb;
begin
  select case_number, legal_hold into v_case_number, v_hold
    from matter where id = p_matter_id;

  if not found then
    raise exception 'No matter with id %', p_matter_id using errcode = 'no_data_found';
  end if;

  -- Checked here as well as in the trigger. The trigger is the guarantee;
  -- this is the readable error, raised before anything has been touched.
  if v_hold then
    raise exception
      'Matter % is under legal hold and cannot be deleted. Clear legal_hold first.',
      coalesce(v_case_number, '<no number>')
      using errcode = 'restrict_violation';
  end if;

  -- Counted before the delete, for the tombstone and for the caller.
  select jsonb_build_object(
    'checklist_items', (select count(*) from matter_checklist_item where matter_id = p_matter_id),
    'activity',        (select count(*) from activity            where matter_id = p_matter_id),
    'section_rows',    (select count(*) from matter_section_row  where matter_id = p_matter_id),
    'relations',       (select count(*) from matter_relation
                         where from_id = p_matter_id or to_id = p_matter_id)
  ) into v_children;

  /*
   * audit_event is NOT touched. The delete below fires the ordinary audit
   * triggers on the matter and on every cascaded child, so the log ends up
   * with a complete, dated, attributed record of the removal — which is the
   * point of having one.
   */
  delete from matter where id = p_matter_id;

  /*
   * One extra row carrying the thing the automatic ones cannot: why, in the
   * words of the person who did it. Inserted after the delete so it reads
   * last in the timeline.
   */
  insert into audit_event (actor_id, table_name, row_pk, op, new_row)
  values (
    auth.uid(),
    'matter',
    jsonb_build_object('matter_id', p_matter_id::text),
    'D',
    jsonb_build_object(
      'purged',           true,
      'case_number',      v_case_number,
      'reason',           nullif(btrim(coalesce(p_reason, '')), ''),
      'children_removed', v_children,
      'note', 'Permanently deleted from the case list. History above is '
              || 'retained. Any Google Drive folder was NOT touched.'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'matter_id', p_matter_id,
    'case_number', v_case_number,
    'children_removed', v_children
  );
end $$;

-- ---------------------------------------------------------------------
-- Grants. TWO revokes, not one — the mistake 007 was written to fix and
-- 009 had to fix again for a function everybody forgot about.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase's
-- default privileges grant it directly to `anon`. Separate ACL entries.
-- This one is SECURITY DEFINER and DESTRUCTIVE, so leaving either in
-- place would hand permanent deletion of any case to anyone holding the
-- publishable key — which ships in the browser.
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function delete_matter(uuid, text) from anon';
  end if;
end $$;
revoke execute on function delete_matter(uuid, text) from public;
grant execute on function delete_matter(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Confirmation. Expect: anon false, authenticated true, trigger present.
-- ---------------------------------------------------------------------
select
  has_function_privilege('anon', 'delete_matter(uuid, text)', 'execute')          as anon_can_delete,
  has_function_privilege('authenticated', 'delete_matter(uuid, text)', 'execute') as staff_can_delete,
  exists (select 1 from pg_trigger where tgname = 'matter_legal_hold_guard')      as legal_hold_enforced;
