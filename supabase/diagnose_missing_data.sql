-- ---------------------------------------------------------------------
-- DIAGNOSTIC — "some of the medical records disappeared"
--
-- ⚠️ NOT A MIGRATION. Read-only. Changes nothing. Safe to run on
-- production at any time. Kept unnumbered so it is never mistaken for one.
--
-- Reported 2026-09-18 against:
--   Hollister, Courtney ANF Charles Wyatt 23-235
--
-- Change the case number on the first line of each query to reuse this.
--
-- ── What this can and cannot tell you ───────────────────────────────
--
-- `matter`, `matter_checklist_item`, `activity` and `contact` carry an
-- audit trigger. Every insert, update and delete on them is recorded in
-- `audit_event` WITH THE OLD ROW, so a deletion on those tables is both
-- traceable and recoverable.
--
-- `matter_section_data` and `matter_section_row` DO NOT. The Medicals
-- table is one of those, so if a provider row was deleted or overwritten
-- there is no record of it and nothing to restore from. Query 5 exists to
-- say so plainly rather than leave you hunting for a history that was
-- never written.
--
-- Query 3 is therefore the most valuable one here: if the records were
-- attached as DOCUMENTS or emails rather than typed into the Medicals
-- table, they live on `activity`, which IS audited -- and the old row is
-- sitting in the audit log waiting to be read.
-- ---------------------------------------------------------------------

-- ── 1. The case, and whether anything happened to the record itself ──
select
  m.id,
  m.case_number,
  m.client_name,
  m.created_at,
  m.last_activity_at,
  m.deleted_at,
  m.drive_folder_name
from matter m
where m.case_number = '23-235';

-- ── 2. What the Medicals section holds RIGHT NOW ─────────────────────
--
-- ⚠️ THE SECTION KEY IS NOT 'medicals'. A collection may declare a
-- `storageKey` and write under THAT instead of its section's key, and the
-- Medicals tab has two that do:
--
--   meds        the providers / treatment / bills table
--   med-chron   the treatment chronology
--
-- The first version of this query filtered on `ilike '%medical%'` and so
-- matched NEITHER, returning nothing and making a populated case look
-- empty. Do not filter by a name you assumed; use the keys, or use the
-- query below that filters by nothing at all.
--
-- `created_at` is the only timestamp these rows carry -- there is no
-- updated_at and no history, so this shows what survives, not what went.
select
  r.section_key,
  r.ordinal,
  r.created_at,
  r.data
from matter_section_row r
join matter m on m.id = r.matter_id
where m.case_number = '23-235'
  and r.section_key in ('meds', 'med-chron')
order by r.section_key, r.ordinal;

-- Every section on the case, so a row that landed under the WRONG SECTION
-- key shows up rather than looking deleted.
select
  r.section_key,
  count(*)            as rows,
  min(r.created_at)   as first_added,
  max(r.created_at)   as last_added
from matter_section_row r
join matter m on m.id = r.matter_id
where m.case_number = '23-235'
group by r.section_key
order by r.section_key;

-- ── 3. ⭐ THE RECOVERABLE ONE ────────────────────────────────────────
--
-- Anything deleted from `activity` on this case -- documents, emails,
-- notes, tasks. `old_row` is the complete record as it stood immediately
-- before deletion, INCLUDING its attachments, so a document removed by
-- accident can be read back in full and re-created.
select
  e.occurred_at,
  e.op,
  coalesce(p.display_name, p.handle, p.email::text, '(no signed-in user)') as who,
  e.old_row ->> 'kind'        as kind,
  e.old_row ->> 'subject'     as subject,
  left(e.old_row ->> 'body', 120) as body_start,
  e.old_row -> 'attachments'  as attachments,
  e.old_row                   as full_old_row
from audit_event e
left join profile p on p.id = e.actor_id
join matter m on m.id::text = (e.row_pk ->> 'matter_id')
where m.case_number = '23-235'
  and e.table_name = 'activity'
  and e.op = 'D'
order by e.occurred_at desc;

-- ── 4. Everything the audit log has on this case ─────────────────────
--
-- Widens the net: a matter archived, a checklist box unticked, a contact
-- unlinked. Useful when "disappeared" turns out to mean something other
-- than a deleted row.
select
  e.occurred_at,
  e.table_name,
  e.op,
  coalesce(p.display_name, p.handle, p.email::text, '(no signed-in user)') as who,
  e.changed_cols
from audit_event e
left join profile p on p.id = e.actor_id
join matter m on m.id::text = (e.row_pk ->> 'matter_id')
where m.case_number = '23-235'
order by e.occurred_at desc
limit 200;

-- ── 5. The gap, stated rather than discovered ────────────────────────
--
-- If this returns rows, those tables have no history and a deletion on
-- them cannot be traced or undone. Expect matter_section_data and
-- matter_section_row to be listed until that is fixed.
select
  t.tablename                                   as no_audit_trail_on,
  'deletions here cannot be traced or restored' as consequence
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in (
    'matter', 'matter_checklist_item', 'activity', 'contact',
    'matter_section_data', 'matter_section_row'
  )
  and not exists (
    select 1 from pg_trigger g
     where g.tgrelid = format('public.%I', t.tablename)::regclass
       and g.tgname like 'audit%'
       and not g.tgisinternal
  )
order by t.tablename;
