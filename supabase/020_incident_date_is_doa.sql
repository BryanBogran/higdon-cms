-- ---------------------------------------------------------------------
-- 020 — Incident Date and DOA become one field
--
-- They were two: `matter.doa`, a column, and `incidentdate` on the Intake
-- section, living in matter_section_data. One fact, two homes, free to
-- disagree — and only the column is read by the deadline chain, the
-- calendar, the dashboard countdown and the projects table.
--
-- So a date typed on the Intake tab looked saved and computed nothing.
-- That is the same fault `sol` had on that tab, fixed the same way: the
-- section field now carries the KEY `doa` and the LABEL "Incident Date",
-- and `matterBackedField` routes it to the matter. One field, shown twice
-- under the two names the firm uses.
--
-- Synchronising two stored copies would have been the worse answer. It
-- drifts the moment anything writes without going through the
-- synchroniser — an import, a migration, live sync — and then nobody can
-- say which of the two is right.
--
-- ── What this migration is for ──────────────────────────────────────
--
-- Values already typed into the Intake field are about to stop being
-- read, because the tab now shows `matter.doa` instead. This moves them
-- across so nothing is lost on the day the code ships.
--
-- ⚠️ IT WILL NOT OVERWRITE A DATE THAT IS ALREADY THERE. Where both are
-- set and they DISAGREE, the column wins and the conflict is REPORTED
-- rather than resolved. `matter.doa` is the one the deadline engine has
-- been using, so silently replacing it could move a statute of
-- limitations — and a migration is the wrong place to decide which of two
-- dates a case actually turns on. The second query below lists them for a
-- person to settle.
--
-- The old `incidentdate` key is left in matter_section_data, unread.
-- Deleting it would destroy the only record of what was typed, and it
-- costs nothing to keep.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- ── ⚠️ THE COLUMN HAS CONSTRAINTS. THE INTAKE FIELD HAD NONE. ───────
--
-- The first version of this file guarded with `~ '^\d{4}-\d{2}-\d{2}$'`
-- and was rejected:
--
--   ERROR: 23514: new row for relation "matter" violates check
--          constraint "doa_range"
--   DETAIL: ... 0202-12-24 ...
--
-- Year 202. A mangled keystroke sitting in matter_section_data since
-- somebody typed it, harmless while nothing read it — and my regex
-- checked the SHAPE of a date, not whether it was a real one.
--
-- That rejection is the database doing its job. A DOA of 0202 would make
-- every statute of limitations computed from it nonsense, and the field
-- it was being copied into is precisely the one the deadline chain reads.
--
-- So the migration now honours both constraints the column carries:
--
--   doa_range       between 1980-01-01 and 2100-01-01
--   sol_after_doa   sol > doa, where a SOL is already recorded
--
-- Anything failing either is LEFT ALONE and listed below for a person.
-- Coercing a nonsense date into a real column to make a migration finish
-- is how bad data becomes permanent.

-- ── Move the ones that can move ─────────────────────────────────────
update matter m
set doa = (d.fields ->> 'incidentdate')::date
from matter_section_data d
where d.matter_id = m.id
  and d.section_key = 'intake'
  and m.doa is null
  -- Only a value that is unambiguously a date. Anything else is left for
  -- the report below rather than crashing the migration on one bad cell.
  and (d.fields ->> 'incidentdate') ~ '^\d{4}-\d{2}-\d{2}$'
  -- doa_range
  and (d.fields ->> 'incidentdate')::date between date '1980-01-01' and date '2100-01-01'
  -- sol_after_doa: an incident cannot fall on or after its own deadline
  and (m.sol is null or (d.fields ->> 'incidentdate')::date < m.sol);

-- ---------------------------------------------------------------------
-- Every intake value, and what became of it
-- ---------------------------------------------------------------------
select
  m.case_number,
  m.client_name,
  d.fields ->> 'incidentdate' as typed_on_intake,
  m.doa                       as on_the_case,
  m.sol,
  case
    when (d.fields ->> 'incidentdate') !~ '^\d{4}-\d{2}-\d{2}$'
      then 'not a date — fix it on Case Info by hand'
    when (d.fields ->> 'incidentdate')::date
         not between date '1980-01-01' and date '2100-01-01'
      then 'outside 1980–2100 — almost certainly a typo, fix by hand'
    when m.sol is not null and (d.fields ->> 'incidentdate')::date >= m.sol
      then 'would fall on or after the SOL — one of the two dates is wrong'
    when m.doa is null
      then 'MOVED to the case'
    when m.doa = (d.fields ->> 'incidentdate')::date
      then 'already matched'
    else 'DISAGREES — the case date was kept, decide by hand'
  end as outcome
from matter m
join matter_section_data d
  on d.matter_id = m.id and d.section_key = 'intake'
where m.deleted_at is null
  and coalesce(d.fields ->> 'incidentdate', '') <> ''
order by
  case when (d.fields ->> 'incidentdate') ~ '^\d{4}-\d{2}-\d{2}$' then 1 else 0 end,
  m.case_number;
