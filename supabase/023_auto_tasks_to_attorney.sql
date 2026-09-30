-- ---------------------------------------------------------------------
-- 023 — the System's deadline tasks go to the case attorney
--
-- Reported 2026-09-30: tasks the system creates from the SOL, trial date
-- and DCO sit in the case file "Unassigned".
--
-- The deadline engine already gives an unclaimed deadline to the case
-- attorney (8f605c2), but only when it rebuilds -- and it rebuilt only when
-- a DATE changed. Picking the attorney did not rebuild it, so every case
-- whose dates were set before its attorney kept its deadlines on nobody's
-- list. The app now rebuilds on the attorney too. This file catches up the
-- tasks that are already sitting there.
--
-- Three steps, all safe to re-run:
--
--   1. The attorney's NAME on each case is spelled the way that attorney's
--      login spells it, where there is no doubt who it is. The firm had
--      twelve spellings of two attorneys ("John Paul Bogran, Jr.", "John
--      Paul Bográn Jr"...). The Tasks page matches names exactly, so a task
--      given to a variant spelling would be on nobody's list. Only a name
--      that matches ONE active person, ignoring case, accents and
--      punctuation, is touched. "JP" matches nobody and is left alone.
--
--   2. Every OPEN system task with nobody on it goes to its case attorney
--      -- only where that attorney is a person with a login.
--
--      ⚠️ A task somebody deliberately gave to someone is NOT touched.
--      Only blank and "Unassigned".
--
--   3. Lists what is still unassigned, and why, for a person.
--
-- Nothing is deleted. Every change is in the audit log.
-- ---------------------------------------------------------------------

-- Compares names the way lib/domain/team.js foldName does. Temporary: it
-- lasts only as long as this session.
create or replace function pg_temp.fold_name(n text) returns text
language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(n, '')),
                     'áàäâãéèëêíìïîóòöôõúùüûñç',
                     'aaaaaeeeeiiiiooooouuuunc'),
           '[^a-z0-9]+', '', 'g')
$$;

-- Active people who can be handed a deadline -- not shared desk logins.
-- A fold shared by two people matches neither: guessing would be worse.
drop table if exists pg_temp.people;
create temporary table people as
select pg_temp.fold_name(display_name) as fold, min(trim(display_name)) as name
  from profile
 where is_active and not is_role_account and trim(coalesce(display_name, '')) <> ''
 group by 1
having count(*) = 1;

-- 1. One spelling per attorney.
update matter m
   set attorney = p.name
  from people p
 where pg_temp.fold_name(m.attorney) = p.fold
   and m.attorney is distinct from p.name;

-- 2. Open system tasks with nobody on them go to the case attorney.
update activity a
   set assigned_to = m.attorney
  from matter m
  join people p on p.name = m.attorney
 where a.matter_id = m.id
   and a.source = 'auto'
   and a.kind = 'task'
   and not a.completed
   and lower(trim(coalesce(a.assigned_to, ''))) in ('', 'unassigned');

-- 3. What is still unassigned, and why.
select m.case_number,
       m.client_name,
       count(*) as open_system_tasks,
       case
         when trim(coalesce(m.attorney, '')) = ''
           then 'No attorney on the case — pick one on Case Info'
         else 'Attorney "' || m.attorney || '" is not a person with a login — pick them again on Case Info'
       end as why
  from activity a
  join matter m on m.id = a.matter_id
 where a.source = 'auto'
   and a.kind = 'task'
   and not a.completed
   and m.deleted_at is null
   and lower(trim(coalesce(a.assigned_to, ''))) in ('', 'unassigned')
 group by m.case_number, m.client_name, m.attorney
 order by m.case_number;

-- No rows back means every open system task is on somebody's list.
