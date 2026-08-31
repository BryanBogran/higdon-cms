-- ---------------------------------------------------------------------
-- 010 — go live: remove the demo data, reset the case-number counter
--
-- ⚠️ THIS DELETES ROWS. Read the dry run first.
--
-- Run it in two passes:
--
--   PASS 1  Run only the SELECT block below. It changes nothing and tells
--           you exactly what pass 2 would remove. If the demo count is 0
--           you are already clean and can stop.
--
--   PASS 2  Uncomment the DELETE block and run the whole file.
--
-- The two-pass shape is deliberate. A purge script that runs the moment
-- you paste it gives you no chance to notice it matched 300 rows instead
-- of 25, and there is no undo on a Supabase SQL editor.
-- ---------------------------------------------------------------------

-- =====================================================================
-- PASS 1 — dry run. Safe. Changes nothing.
-- =====================================================================
select 'demo matters (will be deleted)' as what,
       count(*)                        as rows,
       min(case_number)                as lowest,
       max(case_number)                as highest
  from matter
 where client_name like '% (demo)'
union all
select 'real matters (will be KEPT)', count(*), min(case_number), max(case_number)
  from matter
 where client_name not like '% (demo)'
union all
select 'checklist items on demo matters', count(*), null, null
  from matter_checklist_item i
  join matter m on m.id = i.matter_id
 where m.client_name like '% (demo)'
union all
select 'activity on demo matters', count(*), null, null
  from activity a
  join matter m on m.id = a.matter_id
 where m.client_name like '% (demo)'
union all
select 'section rows on demo matters', count(*), null, null
  from matter_section_row r
  join matter m on m.id = r.matter_id
 where m.client_name like '% (demo)';

-- What the case-number counter thinks, versus what is actually in use.
select year_yy,
       last_seq                                        as counter_says,
       (select max(split_part(case_number, '-', 2)::int)
          from matter
         where case_number like year_yy || '-%'
           and client_name not like '% (demo)'
           and deleted_at is null)                     as highest_real_case
  from case_number_counter
 order by year_yy;


-- =====================================================================
-- PASS 2 — the purge. UNCOMMENT TO RUN.
--
-- Everything hangs off `matter` with ON DELETE CASCADE, so removing the
-- matter takes its checklist items, activity, section rows, relations
-- and section data with it. Nothing else has to be listed.
--
-- `audit_event` is NOT cleared, and that is on purpose: it is
-- append-only by design, it holds no client detail worth protecting
-- once the matters are gone, and a purge that quietly edits the audit
-- trail is exactly the thing an audit trail exists to prevent.
-- =====================================================================

-- begin;
--
-- -- Matched on the "(demo)" suffix ALONE.
-- --
-- -- seed_demo.sql also filtered on `case_number like '26-0%'`. Dropped
-- -- here: a demo row whose number fell outside that range would have been
-- -- silently kept, and a leftover fake case in a live system is worse
-- -- than a slightly broader match. The suffix is synthetic — no real
-- -- client is named "... (demo)".
-- delete from matter where client_name like '% (demo)';
--
-- -- Demo contacts, if any were made while trying the Contacts page.
-- -- Narrow on purpose: only rows with no case and no detail on them.
-- -- delete from contact
-- --  where id not in (select client_contact_id from matter where client_contact_id is not null)
-- --    and coalesce(array_length(tags, 1), 0) = 0
-- --    and phones = '[]'::jsonb and emails = '[]'::jsonb;
--
-- -- ⚠️ RESET THE COUNTER, do not just reseed it.
-- --
-- -- reseed_case_number_counter() raises each year to the highest number
-- -- IN USE and never lowers it — `greatest(...)`, deliberately, so a
-- -- concurrent allocation cannot be clawed back. That is right in normal
-- -- operation and wrong exactly here: the demo run pushed 26 up to 28,
-- -- and after the purge those numbers are free. Leaving the counter high
-- -- means the firm's first real 2026 intake is numbered 26-029 with
-- -- 26-001..26-028 unused, and 26-042 stops meaning "the 42nd case of
-- -- 2026" — which is the only reason the number is shaped this way.
-- --
-- -- So: clear the counter and let the reseed rebuild it from the real
-- -- cases that remain.
-- delete from case_number_counter;
-- select reseed_case_number_counter();
--
-- commit;

-- =====================================================================
-- Confirmation — run after pass 2.
-- =====================================================================
-- select (select count(*) from matter where client_name like '% (demo)') as demo_left,
--        (select count(*) from matter)                                   as matters_total,
--        (select json_agg(c) from case_number_counter c)                 as counter;
