-- ---------------------------------------------------------------------
-- 011 — permanent deletion of a matter
--
-- Until now the only removal was Archive, which sets `deleted_at` and
-- keeps the row. That is the right default and it stays the default. But
-- an import that went wrong, a duplicate, or a project opened by mistake
-- should not sit in the database forever, and asking a developer to
-- remove one is not a workflow.
--
-- ── What actually gets deleted ────────────────────────────────────────
--
-- Everything hangs off `matter` with ON DELETE CASCADE, so removing the
-- matter takes its checklist items, activity, tasks, section data,
-- section rows and relations with it. Those are handled by the database
-- and are not listed here.
--
-- TWO things do NOT cascade, and both are deliberate:
--
--   audit_event   has no foreign key — it must survive the row it
--                 describes. Handled explicitly below.
--
--   the Drive folder  lives in Google, not Postgres. Nothing here can or
--                 should reach into it. The app says so on the button:
--                 the documents remain, and a person deletes them in
--                 Drive if that is what they want. Silently binning a
--                 client's medical records because someone tidied a case
--                 list would be indefensible.
--
-- ── The audit question ────────────────────────────────────────────────
--
-- audit_event holds a redacted snapshot of every change the matter ever
-- had. Keeping those after a purge means the "deleted" case is still in
-- the database in all but name, which defeats the point. Deleting them
-- silently means a case can vanish with no trace that it existed.
--
-- So: the history goes, and ONE tombstone row replaces it recording that
-- a purge happened, when, by whom, why, and how many rows went. The
-- tombstone carries the CASE NUMBER but NOT the client's name — enough to
-- answer "what happened to 26-042", not enough to leave the person in the
-- database after they were removed from it.
--
-- Safe to re-run.
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
  v_audit_rows  integer;
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

  select count(*) into v_audit_rows
    from audit_event where row_pk->>'matter_id' = p_matter_id::text;

  -- The history. Uses the audit_by_matter index.
  delete from audit_event where row_pk->>'matter_id' = p_matter_id::text;

  -- The matter. Cascades take every child table with it, and the row's
  -- own DELETE audit trigger fires — writing one more row, which is why
  -- the tombstone is inserted after this rather than before.
  delete from matter where id = p_matter_id;

  -- Whatever the cascade's own triggers just wrote is part of the history
  -- being removed, so clear it too and leave only the tombstone.
  delete from audit_event where row_pk->>'matter_id' = p_matter_id::text;

  /*
   * The tombstone. Case number, not client name: enough to answer "what
   * happened to 26-042" without leaving the person in the database after
   * they were taken out of it.
   */
  insert into audit_event (actor_id, table_name, row_pk, op, old_row)
  values (
    auth.uid(),
    'matter',
    jsonb_build_object('matter_id', p_matter_id::text),
    'D',
    jsonb_build_object(
      'purged',            true,
      'case_number',       v_case_number,
      'reason',            nullif(btrim(coalesce(p_reason, '')), ''),
      'audit_rows_removed', v_audit_rows,
      'children_removed',  v_children,
      'note', 'Permanently deleted. Client name withheld deliberately; '
              || 'any Google Drive folder was NOT touched.'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'matter_id', p_matter_id,
    'case_number', v_case_number,
    'audit_rows_removed', v_audit_rows,
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
