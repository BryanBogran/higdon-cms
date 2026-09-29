-- ---------------------------------------------------------------------
-- Fix the half-typed dates found by diagnose_half_typed_dates.sql
--
-- Run once, in the Supabase SQL editor. Safe to re-run.
--
-- Two parts:
--
--   1. FIXES the eight dates where the right year is not in doubt: somebody
--      typed a two-digit year ("26") and the box stored year 0026. There is
--      only one year that can mean.
--
--      ⚠️ ALL OR NOTHING. Each fix names the exact bad value it replaces. If
--      any one of them no longer finds it -- someone has since changed that
--      date, or a case number moved -- the whole block stops and NOTHING
--      is changed. A fix already applied is recognised and skipped, which
--      is what makes re-running safe.
--
--   2. LISTS what is left: dates where a digit was lost, so the year cannot
--      be worked out from the database (0202 could be 2020 through 2029).
--      For each one it shows who saved it and when, from the audit log, so
--      the person can be asked -- or the date looked up in the file and
--      retyped on the case. The date box no longer does this, so retyping
--      in the app is now safe.
--
-- Every change made here is recorded in the audit log like any other.
-- ---------------------------------------------------------------------

do $$
declare
  f record;
  n int;
  mid uuid;
begin
  for f in
    select * from (values
      -- case      where         section     field                      inside      saved         correct
      ('26-102', 'open_date', null,       null,                      null,        '0026-09-20', '2026-09-20'),
      ('21-282', 'row',       'dco',      'date',                    null,        '0026-12-16', '2026-12-16'),
      ('23-170', 'row',       'expenses', 'dateofinvoice',           null,        '0026-08-31', '2026-08-31'),
      ('23-217', 'field',     'dco',      'conductadrby',            'dateValue', '0026-10-22', '2026-10-22'),
      ('24-060', 'row',       'meds',     'datetreatmentcompleted',  null,        '0025-12-01', '2025-12-01'),
      ('26-016', 'row',       'dco',      'date',                    null,        '0027-12-15', '2027-12-15'),
      ('26-056', 'row',       'meds',     'billsreceiveddate',       null,        '0026-08-03', '2026-08-03'),
      ('26-073', 'row',       'expenses', 'dateofinvoice',           null,        '0026-06-12', '2026-06-12')
    ) as t(case_number, kind, section_key, field, inner_key, bad, good)
  loop
    select id into mid from matter where case_number = f.case_number and deleted_at is null;
    if mid is null then
      raise exception 'Nothing changed: case % not found', f.case_number;
    end if;

    if f.kind = 'open_date' then
      update matter set open_date = f.good::date
       where id = mid and open_date = f.bad::date;
      get diagnostics n = row_count;
      if n = 0 and exists (select 1 from matter where id = mid and open_date = f.good::date) then
        continue;  -- already fixed
      end if;

    elsif f.kind = 'row' then
      update matter_section_row
         set data = jsonb_set(data, array[f.field], to_jsonb(f.good))
       where matter_id = mid and section_key = f.section_key and data ->> f.field = f.bad;
      get diagnostics n = row_count;
      if n = 0 and exists (select 1 from matter_section_row
                            where matter_id = mid and section_key = f.section_key
                              and data ->> f.field = f.good) then
        continue;
      end if;

    else  -- a date inside a section field (a DCO item's dateValue)
      update matter_section_data
         set fields = jsonb_set(fields, array[f.field, f.inner_key], to_jsonb(f.good)),
             updated_at = now()
       where matter_id = mid and section_key = f.section_key
         and fields #>> array[f.field, f.inner_key] = f.bad;
      get diagnostics n = row_count;
      if n = 0 and exists (select 1 from matter_section_data
                            where matter_id = mid and section_key = f.section_key
                              and fields #>> array[f.field, f.inner_key] = f.good) then
        continue;
      end if;
    end if;

    if n <> 1 then
      raise exception 'Nothing changed: % % % expected one % and found %',
        f.case_number, coalesce(f.section_key, 'Case Info'), f.field, f.bad, n;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. What is left, for a person
-- ---------------------------------------------------------------------
with found as (
  select m.id as matter_id, 'Case Info' as place, 'Date opened' as field,
         'matter' as tbl, null::text as row_id, null::text as section_key,
         array['open_date'] as path, m.open_date::text as saved
    from matter m
   where m.open_date < date '1000-01-01'
  union all
  select m.id, 'Case Info', 'Settlement date', 'matter', null, null,
         array['settlement_date'], m.settlement_date::text
    from matter m
   where m.settlement_date < date '1000-01-01'
  union all
  select d.matter_id, d.section_key, f.key, 'matter_section_data', null, d.section_key,
         array[f.key], f.value #>> '{}'
    from matter_section_data d
   cross join lateral jsonb_each(d.fields) f
   where jsonb_typeof(f.value) = 'string'
     and (f.value #>> '{}') ~ '^0[0-9]{3}-[0-9]{2}-[0-9]{2}'
  union all
  select d.matter_id, d.section_key, f.key || ' → ' || g.key, 'matter_section_data', null, d.section_key,
         array[f.key, g.key], g.value #>> '{}'
    from matter_section_data d
   cross join lateral jsonb_each(d.fields) f
   cross join lateral jsonb_each(case when jsonb_typeof(f.value) = 'object' then f.value else '{}'::jsonb end) g
   where jsonb_typeof(g.value) = 'string'
     and (g.value #>> '{}') ~ '^0[0-9]{3}-[0-9]{2}-[0-9]{2}'
  union all
  select r.matter_id, r.section_key || ' (row ' || (r.ordinal + 1) || ')', c.key,
         'matter_section_row', r.id::text, r.section_key, array[c.key], c.value #>> '{}'
    from matter_section_row r
   cross join lateral jsonb_each(r.data) c
   where jsonb_typeof(c.value) = 'string'
     and (c.value #>> '{}') ~ '^0[0-9]{3}-[0-9]{2}-[0-9]{2}'
)
select m.case_number,
       m.client_name,
       found.place,
       found.field,
       found.saved,
       case
         -- Intake's own incident date stopped being read in 020: the Intake
         -- tab now shows the case's Incident Date / DOA. The old copy is
         -- harmless; what matters is whether the real one is set.
         when found.field = 'incidentdate'
           then 'Old copy, not read. Incident Date on the case is '
                || coalesce(to_char(m.doa, 'Mon DD, YYYY'), 'EMPTY — no SOL can be computed')
         when found.saved like '0202-%' then 'Year 2020–2029, last digit lost'
         when found.saved like '0020-%' then 'Year 20__, two digits lost'
         when found.saved like '0002-%' then 'Year 2___, three digits lost'
         when found.saved ~ '^0(206|226)-' then 'Probably 2026 (a digit mistyped)'
         else 'Check the file'
       end as what_we_know,
       who.saved_by,
       who.saved_at
  from found
  join matter m on m.id = found.matter_id
  -- The first audit entry that stored this exact bad value: who typed it.
  left join lateral (
    select coalesce(p.display_name, 'unknown') as saved_by,
           to_char(a.occurred_at at time zone 'America/Chicago', 'Mon DD, YYYY HH12:MI am') as saved_at
      from audit_event a
      left join profile p on p.id = a.actor_id
     where a.row_pk ->> 'matter_id' = found.matter_id::text
       and a.table_name = found.tbl
       and (found.row_id is null or a.row_pk ->> 'id' = found.row_id)
       and (found.section_key is null or a.row_pk ->> 'section_key' = found.section_key)
       and (case found.tbl
              when 'matter'              then a.new_row #>> found.path
              when 'matter_section_data' then a.new_row -> 'fields' #>> found.path
              else                            a.new_row -> 'data'   #>> found.path
            end) = found.saved
     order by a.occurred_at
     limit 1
  ) who on true
 where m.deleted_at is null
 order by (found.field = 'incidentdate') desc, m.case_number, found.place;

-- `saved_by` blank means the value is older than the audit trail for that
-- tab (section tabs gained one in 019). Fix each row on the case, in the
-- app, from the file.
