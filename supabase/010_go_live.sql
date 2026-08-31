-- ---------------------------------------------------------------------
-- 010 — go live: remove the demo data, reset the case-number counter
--
-- ⚠️ THIS DELETES ROWS. It is armed. Running it purges.
--
-- The first version shipped with the purge commented out, which meant
-- running the file did the dry run and nothing else. That was one pass
-- too careful: you read the dry run, so the safety it bought is spent.
-- This version runs the whole thing in ONE transaction and reports the
-- before and after together.
--
-- ── To rehearse it first ──────────────────────────────────────────────
-- Change the last line from `commit;` to `rollback;`. Everything runs,
-- you see the exact same report, and nothing is kept. Change it back to
-- `commit;` when the numbers look right. That is a better dry run than
-- the SELECTs were, because it exercises the deletes themselves.
--
-- ── What it touches ───────────────────────────────────────────────────
--   matter rows whose client_name ends in "(demo)"   — deleted
--   their checklist items, activity, section rows,
--   relations and section data                       — deleted by cascade
--   case_number_counter                              — cleared and rebuilt
--   everything else                                  — untouched
-- ---------------------------------------------------------------------

begin;

-- Counts BEFORE, held for the report at the end. Without this the purge
-- runs and you are left looking at zeros with no idea what they replaced.
create temp table _before on commit drop as
select
  (select count(*) from matter where client_name like '% (demo)')     as demo_matters,
  (select count(*) from matter where client_name not like '% (demo)') as real_matters,
  (select count(*) from matter_checklist_item i join matter m on m.id = i.matter_id
     where m.client_name like '% (demo)')                             as demo_checklist,
  (select count(*) from activity a join matter m on m.id = a.matter_id
     where m.client_name like '% (demo)')                             as demo_activity,
  (select count(*) from matter_section_row r join matter m on m.id = r.matter_id
     where m.client_name like '% (demo)')                             as demo_section_rows,
  (select json_agg(row_to_json(c) order by c.year_yy) from case_number_counter c) as counter_before;

-- ---------------------------------------------------------------------
-- The purge
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
-- ⚠️ RESET the counter — do not merely reseed it.
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
-- So: clear it, and let the reseed rebuild it from the real cases left.
-- If no real cases remain the table stays empty, and the first
-- allocation starts that year at 001. That is correct.
-- ---------------------------------------------------------------------
delete from case_number_counter;
select reseed_case_number_counter();

-- ---------------------------------------------------------------------
-- The report. Before and after, side by side.
--
-- demo_left MUST be 0. counter_after should reflect only real cases —
-- or be null if there are none yet, which is fine.
-- ---------------------------------------------------------------------
select
  b.demo_matters                                                      as demo_matters_deleted,
  b.demo_checklist                                                    as checklist_items_deleted,
  b.demo_activity                                                     as activity_deleted,
  b.demo_section_rows                                                 as section_rows_deleted,
  b.real_matters                                                      as real_matters_kept,
  b.counter_before,
  (select count(*) from matter where client_name like '% (demo)')     as demo_left,
  (select count(*) from matter)                                       as matters_now,
  (select json_agg(row_to_json(c) order by c.year_yy)
     from case_number_counter c)                                      as counter_after
  from _before b;

-- `on commit drop` above means the temp table needs no DROP here. That is
-- not tidiness: the SQL editor shows the LAST result, and a trailing DROP
-- returns none, which would leave you looking at a blank pane instead of
-- the report.

-- Change to `rollback;` to rehearse, `commit;` to keep it.
commit;


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
--   select id, coalesce(company_name, last_name || ', ' || first_name) as name,
--          tags, jsonb_array_length(phones) as phones,
--          jsonb_array_length(emails) as emails, created_at,
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
