-- =====================================================================
-- Run AFTER schema.sql and 002_date_guard.sql.
-- Read the MESSAGES tab. Takes under a minute.
--
-- Corrected 2026-08-27: an earlier version of test 1 asserted that a
-- `date` column rejects '3/1/24'. It does not -- Postgres's default
-- DateStyle is 'ISO, MDY', so that string is a valid literal meaning
-- 2024-03-01. The test now checks what is actually true, and test 1b
-- demonstrates the accept-and-guess behaviour explicitly, because a
-- surprise you can see is worth more than a claim that isn't so.
-- =====================================================================

-- 1. Genuinely unparseable values are rejected.
do $$ begin
  begin
    insert into matter (client_name, sol) values ('CONSTRAINT TEST', 'TBD');
    raise exception 'FAIL: TBD was accepted as a date';
  exception when invalid_datetime_format then
    raise notice 'PASS 1a: non-date text rejected';
  end;

  begin
    insert into matter (client_name, sol) values ('CONSTRAINT TEST', '2024-02-30');
    raise exception 'FAIL: Feb 30 was accepted';
  exception when datetime_field_overflow or invalid_datetime_format then
    raise notice 'PASS 1b: impossible calendar date rejected';
  end;
end $$;

-- 1c. THE IMPORTANT CAVEAT, demonstrated rather than asserted.
--     Postgres accepts '3/1/24' and picks March 1. This is why the
--     importer must call parse_iso_date() instead of casting raw cells.
do $$
declare v date; begin
  insert into matter (client_name, sol) values ('DATESTYLE DEMO', '3/1/24')
    returning sol into v;
  raise notice 'NOTE: Postgres read ''3/1/24'' as % (DateStyle=%). A date column does NOT disambiguate -- parse_iso_date() is the guard.',
    v, current_setting('DateStyle');
  delete from matter where client_name = 'DATESTYLE DEMO';
end $$;

-- 1d. parse_iso_date() is the guard that actually refuses.
do $$ begin
  begin
    perform parse_iso_date('3/1/24');
    raise exception 'FAIL: parse_iso_date accepted an ambiguous date';
  exception when invalid_datetime_format then
    raise notice 'PASS 1d: parse_iso_date refuses ambiguous input';
  end;
  if parse_iso_date('2026-03-01') <> date '2026-03-01' then
    raise exception 'FAIL: parse_iso_date mangled a valid ISO date';
  end if;
  raise notice 'PASS 1e: parse_iso_date accepts real ISO dates';
end $$;

-- 2. SOL cannot precede the date of accident.
do $$ begin
  begin
    insert into matter (client_name, doa, sol)
    values ('CONSTRAINT TEST', '2026-01-01', '2025-01-01');
    raise exception 'FAIL: sol before doa was accepted';
  exception when check_violation then
    raise notice 'PASS 2: sol_after_doa enforced';
  end;
end $$;

-- 3. Case-number format.
do $$ begin
  begin
    insert into matter (client_name, case_number) values ('CONSTRAINT TEST', '26-42');
    raise exception 'FAIL: malformed case number accepted';
  exception when check_violation then
    raise notice 'PASS 3: case_number_format enforced';
  end;
end $$;

-- 4. Case numbers unique among live matters.
do $$ begin
  insert into matter (client_name, case_number) values ('DUP A', '99-001');
  begin
    insert into matter (client_name, case_number) values ('DUP B', '99-001');
    raise exception 'FAIL: duplicate case number accepted';
  exception when unique_violation then
    raise notice 'PASS 4: case number uniqueness enforced';
  end;
  delete from matter where case_number = '99-001';
end $$;

-- 5. Chain idempotency: one auto task per matter per rule.
do $$
declare m uuid; begin
  insert into matter (client_name) values ('CHAIN TEST') returning id into m;
  insert into activity (matter_id, kind, source, rule_key, due_date)
    values (m, 'task', 'auto', 'served', '2026-09-21');
  begin
    insert into activity (matter_id, kind, source, rule_key, due_date)
      values (m, 'task', 'auto', 'served', '2026-10-01');
    raise exception 'FAIL: duplicate auto task accepted';
  exception when unique_violation then
    raise notice 'PASS 5: activity_auto_rule_uq enforced';
  end;
  delete from matter where id = m;
end $$;

-- 6. Audit table is append-only.
do $$ begin
  begin
    update audit_event set actor_id = null where id = (select min(id) from audit_event);
    raise notice 'FAIL: audit_event was mutable';
  exception when others then
    raise notice 'PASS 6: audit_event is append-only';
  end;
end $$;

-- 7. Case numbers allocate sequentially and reset per year.
select allocate_case_number('99') as first,
       allocate_case_number('99') as second,
       allocate_case_number('98') as other_year;

-- 8. Every table has RLS on. MUST return zero rows.
select tablename as "TABLES MISSING RLS"
  from pg_tables
 where schemaname = 'public'
   and tablename in ('matter','matter_checklist_item','activity',
                     'matter_section_data','matter_section_row',
                     'profile','audit_event','case_number_counter')
   and not rowsecurity;

-- Cleanup.
delete from matter where client_name in
  ('CONSTRAINT TEST','DUP A','DUP B','CHAIN TEST','DATESTYLE DEMO');
delete from case_number_counter where year_yy in ('98','99');
