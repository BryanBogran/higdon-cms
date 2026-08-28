-- =====================================================================
-- Demo data — 25 synthetic matters. SYNTHETIC ONLY.
--
-- Run after schema.sql and 002_date_guard.sql, once you can log in.
-- Safe to re-run: it clears its own rows first.
--
-- Deliberately includes the awkward cases that broke the prototype, so
-- they are visible in a demo rather than hidden behind tidy data:
--   * a matter with no SOL              -> "Missing Key Dates" panel
--   * a trial date on a Saturday        -> the weekend warning
--   * a checklist item done with NO date -> "no deadline is being calculated"
-- =====================================================================

-- Clear previous demo rows (cascades to checklist, activity, sections).
delete from matter where case_number like '26-0%' and client_name like '% (demo)';

insert into matter (client_name, case_number, attorney, status, phase,
                    open_date, doa, sol, trial_date, dco, insurance_class,
                    client_phone, client_email)
select
  (array['Rivera, Marcus','Okafor, Chidi','Barton, Michael','Lindqvist, Anna',
         'Perry, Darrell','Jamal, Farida','Okonkwo, Kendall','Marshall, Patrick',
         'Sandoval, Juan','Morris-Brown, Raquel'])[1 + (i % 10)] || ' (demo)',
  '26-' || lpad((i + 1)::text, 3, '0'),
  (array['Priya Raman','Alex Turner Jr.','Dana Whitfield'])[1 + (i % 3)],
  (array['Open','Open','Open','Settled - Not Disbursed'])[1 + (i % 4)]::matter_status,
  (array['Litigation','Litigation','Treatment','Settlement'])[1 + (i % 4)]::matter_phase,
  current_date - (300 + i * 11),
  current_date - (340 + i * 13),
  -- Every 7th matter has NO SOL, so the dashboard's missing-dates panel fills.
  case when i % 7 = 0 then null else current_date + (60 + i * 17) end,
  case when i % 3 = 0 then current_date + (20 + i * 9) else null end,
  case when i % 3 = 0 then current_date + (5  + i * 9) else null end,
  (array['Personal Lines','Commercial','Unknown'])[1 + (i % 3)]::insurance_class,
  '832-555-' || lpad((100 + i)::text, 4, '0'),
  'client' || i || '@example.com'
from generate_series(0, 24) as i;

-- Served, with a date, on two-thirds of them. This is what generates
-- the Answer Due deadlines under Tex. R. Civ. P. 99.
insert into matter_checklist_item (matter_id, field_key, done, occurred_on)
select id, 'served', true, open_date + 45
  from matter
 where client_name like '% (demo)'
   and (substring(case_number, 4)::int % 3) <> 0;

insert into matter_checklist_item (matter_id, field_key, done, occurred_on)
select id, 'suitFiled', true, open_date + 20
  from matter where client_name like '% (demo)'
   and (substring(case_number, 4)::int % 2) = 0;

-- THE DECEPTIVE CASE: done, but no date. Five of the eight chain rules
-- gate on `done AND occurred_on`, so this produces NO deadline while the
-- task list still looks populated. The Litigation section flags it.
insert into matter_checklist_item (matter_id, field_key, done, occurred_on, note)
select id, 'defDiscoveryReceived', true, null, 'received per MA'
  from matter where case_number = '26-005' and client_name like '% (demo)';

-- A trial date that lands on a Saturday, so the weekend warning shows.
update matter
   set trial_date = (date_trunc('week', current_date + 90) + interval '5 days')::date
 where case_number = '26-002' and client_name like '% (demo)';

-- Some activity, so the Feed and matter Activity tabs aren't empty.
insert into activity (matter_id, kind, body, author_label, pinned, mentions)
select id, 'note',
  (array['New assigned adjuster is Jason, extension 44733.',
         '*******NEEDY CLIENT. NEEDS RESPONSE ASAP IF WE MISS HER CALL*******',
         'Spoke with treating physician; records requested.',
         'Returned call to opposing counsel re: depo scheduling.'])
    [1 + (substring(case_number, 4)::int % 4)],
  (array['Priya Raman','Alex Turner Jr.','Dana Whitfield'])
    [1 + (substring(case_number, 4)::int % 3)],
  substring(case_number, 4)::int <= 3,          -- pin the first three
  case when substring(case_number, 4)::int % 5 = 0
       then array['hlaccounting'] else '{}'::text[] end
  from matter where client_name like '% (demo)';

-- Expenses on one matter, so the generic section engine has something to show.
insert into matter_section_row (matter_id, section_key, ordinal, data)
select id, 'expenses', 0,
       '{"date":"2026-06-28","description":"Filing fee","category":"Court","amount":"402.00"}'::jsonb
  from matter where case_number = '26-001' and client_name like '% (demo)'
union all
select id, 'expenses', 1,
       '{"date":"2026-07-28","description":"Medical records - Village ER","category":"Records","amount":"85.50"}'::jsonb
  from matter where case_number = '26-001' and client_name like '% (demo)';

-- Keep new case numbers from colliding with the demo ones.
select reseed_case_number_counter();

select count(*) as demo_matters from matter where client_name like '% (demo)';
