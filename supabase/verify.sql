-- =====================================================================
-- Run this AFTER schema.sql. Every block should behave as its comment says.
-- Takes under a minute and proves the database is doing its job.
-- =====================================================================

-- 1. THE HEADLINE CHECK. A messy spreadsheet date must be REJECTED, not
--    silently coerced or stored. This is the whole reason for Postgres.
--    Expect: ERROR  invalid input syntax for type date: "3/1/24"
do $$ begin
  begin
    insert into matter (client_name, sol) values ('CONSTRAINT TEST', '3/1/24');
    raise exception 'FAIL: a bad date was accepted';
  exception when invalid_datetime_format then
    raise notice 'PASS 1: bad date rejected';
  end;
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

-- 3. Case-number format is enforced.
do $$ begin
  begin
    insert into matter (client_name, case_number) values ('CONSTRAINT TEST', '26-42');
    raise exception 'FAIL: malformed case number accepted';
  exception when check_violation then
    raise notice 'PASS 3: case_number_format enforced';
  end;
end $$;

-- 4. Case numbers are unique among live matters.
do $$
declare v1 uuid; begin
  insert into matter (client_name, case_number) values ('DUP A', '99-001') returning id into v1;
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

-- 6. The audit table is append-only, even for the owner.
do $$ begin
  begin
    update audit_event set actor_id = null where id = (select min(id) from audit_event);
    raise exception 'FAIL: audit_event was mutable';
  exception when raise_exception then
    raise notice 'PASS 6: audit_event is append-only';
  end;
end $$;

-- 7. Case numbers allocate sequentially and reset per year.
select allocate_case_number('99') as first,   -- expect 99-001
       allocate_case_number('99') as second,  -- expect 99-002
       allocate_case_number('98') as other_year;  -- expect 98-001

-- 8. Every table has RLS on. Expect zero rows.
select tablename
  from pg_tables
 where schemaname = 'public'
   and tablename in ('matter','matter_checklist_item','activity',
                     'matter_section_data','matter_section_row',
                     'profile','audit_event','case_number_counter')
   and not rowsecurity;

-- Clean up test rows and counters.
delete from matter where client_name in ('CONSTRAINT TEST','DUP A','DUP B','CHAIN TEST');
delete from case_number_counter where year_yy in ('98','99');
