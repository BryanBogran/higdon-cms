-- ---------------------------------------------------------------------
-- 010 — go live: remove the demo data, reset the case-number counter
--
-- ⚠️ THIS DELETES ROWS. It is armed. Running it purges.
--
-- Select the whole file and run it. Four statements; the last one is the
-- report.
--
-- ── Why this file has no temp table any more ──────────────────────────
--
-- It used to capture the before-counts into `create temp table _before
-- ... on commit drop`, inside an explicit `begin; ... commit;`. That
-- failed in the Supabase SQL editor with
--
--     ERROR: 42P01: relation "_before" does not exist
--
-- because the editor does not hold one transaction across the statements
-- the way psql does — each auto-commits. `ON COMMIT DROP` therefore fired
-- the moment the table was created, and the report four statements later
-- was reading something already gone.
--
-- So: no temp table, no reliance on `begin`/`commit`, every statement
-- independent and safe to re-run on its own. A purge script is the last
-- place to be clever.
--
-- ── The before-counts ─────────────────────────────────────────────────
--
-- You already have them from the dry run. The report at the end proves
-- the outcome, which is the half that actually matters: demo_left must
-- be 0.
--
-- ── What it touches ───────────────────────────────────────────────────
--   matter rows whose client_name ends in "(demo)"   — deleted
--   their checklist items, activity, section rows,
--   relations and section data                       — deleted by cascade
--   case_number_counter                              — cleared and rebuilt
--   everything else                                  — untouched
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 1. The purge.
--
-- Matched on the "(demo)" suffix ALONE. seed_demo.sql also filtered on
-- `case_number like '26-0%'`; dropped here, because a demo row whose
-- number fell outside that range would have been silently kept, and a
-- leftover fake case in a live system is worse than a broader match. No
-- real client is named "... (demo)".
--
-- Everything hangs off `matter` with ON DELETE CASCADE, so this one
-- statement takes the checklist items, activity, section rows, section
-- data and relations with it. Nothing else has to be listed.
--
-- `audit_event` is deliberately NOT cleared: it is append-only by design,
-- it holds nothing worth protecting once the matters are gone, and a
-- purge that quietly edits the audit trail is the exact thing an audit
-- trail exists to prevent.
-- ---------------------------------------------------------------------
delete from matter where client_name like '% (demo)';


-- ---------------------------------------------------------------------
-- 2. RESET the counter — do not merely reseed it.
--
-- reseed_case_number_counter() raises each year to the highest number IN
-- USE and never lowers it (`greatest(...)`, deliberately, so a concurrent
-- allocation cannot be clawed back). Right in normal operation, wrong
-- exactly here: the demo run pushed 2026 to 28, and after the purge those
-- numbers are free. Leaving the counter high means the firm's first real
-- 2026 intake is 26-029 with 26-001..26-028 unused, and 26-042 stops
-- meaning "the 42nd case opened in 2026" — which is the only reason the
-- number is shaped this way.
--
-- Clearing it is safe because step 3 rebuilds it from the cases that
-- remain. If none remain the table stays empty and the first allocation
-- of a year starts at 001, which is correct.
-- ---------------------------------------------------------------------
delete from case_number_counter;


-- ---------------------------------------------------------------------
-- 3. Rebuild it from the real cases that are left.
-- ---------------------------------------------------------------------
select reseed_case_number_counter();


-- ---------------------------------------------------------------------
-- 4. The report. This is the result the editor will show.
--
--   demo_left      MUST be 0.
--   matters_now    your real cases, and only those.
--   counter_now    null is CORRECT if no real cases exist yet — the
--                  first case of a year then gets 001.
--
-- ⚠️ After you import the Filevine export, the counter has to move again:
-- those cases run up to 26-101, and allocate_case_number() reads this
-- table rather than the matters. The importer now calls the reseed itself
-- once it has written, so this is handled — but if you ever load cases by
-- any other route, run `select reseed_case_number_counter();` afterwards
-- or the next new intake is refused as a duplicate.
-- ---------------------------------------------------------------------
select
  (select count(*) from matter where client_name like '% (demo)')      as demo_left,
  (select count(*) from matter)                                        as matters_now,
  (select count(*) from matter_checklist_item)                         as checklist_now,
  (select count(*) from activity)                                      as activity_now,
  (select count(*) from matter_section_row)                            as section_rows_now,
  (select count(*) from contact where deleted_at is null)              as contacts_now,
  (select json_agg(row_to_json(c) order by c.year_yy)
     from case_number_counter c)                                       as counter_now;


-- =====================================================================
-- OPTIONAL, and left for you to run by hand — test contacts.
--
-- Not folded into the purge above, because there is no "(demo)" marker on
-- a contact and any rule broad enough to catch a test record is broad
-- enough to catch a real one somebody started this morning and has not
-- finished. Deleting a client's contact is not recoverable from here.
--
-- LOOK FIRST:
--
--   select id,
--          coalesce(company_name, concat_ws(', ', last_name, first_name)) as name,
--          tags,
--          jsonb_array_length(phones) as phones,
--          jsonb_array_length(emails) as emails,
--          created_at,
--          exists (select 1 from matter m where m.client_contact_id = c.id) as on_a_case
--     from contact c
--    where deleted_at is null
--    order by created_at;
--
-- Then delete the specific ones BY ID:
--
--   delete from contact where id in ('...', '...');
--
-- ON DELETE SET NULL on matter.client_contact_id means removing a contact
-- can never remove a case — it only unlinks it, and the typed client_name
-- on the matter still stands.
-- =====================================================================
