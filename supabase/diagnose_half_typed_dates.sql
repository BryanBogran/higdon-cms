-- ---------------------------------------------------------------------
-- Find dates that were saved half-typed.            READ-ONLY. Safe to run.
--
-- Until 34f20ae (2026-09-28), every date box saved each keystroke of the
-- year as a finished date: typing 2026 sent 0002, 0020, 0202, then 2026.
-- Where the database has a range check it refused the first three (the
-- `occurred_on_range` errors in the Supabase log). Where it has none, the
-- half-typed year could be stored -- and stayed, if somebody stopped or
-- left the box mid-year. That is how an intake date of 0202-12-24 reached a
-- real case.
--
-- Every year a person half-types left to right is below 1000, and no real
-- date in this system is. So anything dated year 0001-0999 is one of these.
--
-- Places that CANNOT hold one, because a range check refused it:
--   matter.doa / sol / trial_date / dco, matter_checklist_item.occurred_on,
--   activity.due_date (task due dates).
--
-- Places that CAN, checked below:
--   1. matter.open_date and matter.settlement_date -- no range check.
--   2. Every section field (Intake, Case Info extras, DCO, ...) -- stored in
--      matter_section_data.fields. A DCO item is a small object with its own
--      dateValue and doneDate, so this looks one level inside those too.
--   3. Every table row (Medicals providers, Expenses, Depositions, the DCO's
--      "other deadlines", ...) -- stored in matter_section_row.data.
--
-- Nothing here changes anything. Fix what it finds by hand, in the app, on
-- the case -- the right date is something only the file can tell you.
-- ---------------------------------------------------------------------

with found as (

  -- 1. The two unguarded columns on the case itself.
  select m.id as matter_id, 'Case Info' as place, 'Date opened' as field,
         m.open_date::text as saved
    from matter m
   where m.open_date < date '1000-01-01'
  union all
  select m.id, 'Case Info', 'Settlement date', m.settlement_date::text
    from matter m
   where m.settlement_date < date '1000-01-01'

  union all

  -- 2a. Section fields holding a date directly.
  select d.matter_id, d.section_key, f.key, f.value #>> '{}'
    from matter_section_data d
   cross join lateral jsonb_each(d.fields) f
   where jsonb_typeof(f.value) = 'string'
     and (f.value #>> '{}') ~ '^0[0-9]{3}-[0-9]{2}-[0-9]{2}'

  union all

  -- 2b. Section fields holding a date one level down (DCO dateValue / doneDate).
  select d.matter_id, d.section_key, f.key || ' → ' || g.key, g.value #>> '{}'
    from matter_section_data d
   cross join lateral jsonb_each(d.fields) f
   cross join lateral jsonb_each(case when jsonb_typeof(f.value) = 'object' then f.value else '{}'::jsonb end) g
   where jsonb_typeof(g.value) = 'string'
     and (g.value #>> '{}') ~ '^0[0-9]{3}-[0-9]{2}-[0-9]{2}'

  union all

  -- 3. Table rows.
  select r.matter_id, r.section_key || ' (row ' || (r.ordinal + 1) || ')', c.key, c.value #>> '{}'
    from matter_section_row r
   cross join lateral jsonb_each(r.data) c
   where jsonb_typeof(c.value) = 'string'
     and (c.value #>> '{}') ~ '^0[0-9]{3}-[0-9]{2}-[0-9]{2}'
)
select m.case_number,
       m.client_name,
       found.place,
       found.field,
       found.saved
  from found
  join matter m on m.id = found.matter_id
 where m.deleted_at is null
 order by m.case_number nulls last, found.place, found.field;

-- No rows back means nothing was stored half-typed. The column names in
-- `field` are the app's internal keys (e.g. `incidentdate`, `datesofservice`);
-- `place` says which tab to open.
