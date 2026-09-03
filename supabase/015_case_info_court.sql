-- ---------------------------------------------------------------------
-- 015 — the court's identifiers, and the policy ceiling
--
-- The firm sent a photo of Filevine's matter header and asked to have it
-- replicated. It carries a strip of values under the client's name, and
-- four of them had nowhere to live here:
--
--   policy_limits   the driver's policy ceiling
--   cause_number    THE COURT'S number for the suit
--   county          where it is filed
--   court_room      one field, as Filevine labels it and as the firm
--                   confirmed they record it
--
-- ⚠️ `cause_number` IS NOT `case_number`. `case_number` is the firm's own
-- 26-033 file number, allocated by this system and unique across it.
-- `cause_number` is issued by the court. Two identifiers for one matter,
-- from two different bodies, and putting the wrong one on a filing is
-- not a small mistake. They are deliberately separate columns with
-- separate labels rather than one reused field.
--
-- ── All text, all nullable, no constraints ──────────────────────────
--
-- Nullable because 344 cases already exist and none of them has these
-- values yet. A NOT NULL here would fail the migration outright, and a
-- default would invent data.
--
-- No check constraint, because there is no format to enforce that would
-- not be wrong somewhere: cause numbers vary by county, and policy
-- limits are written "100/300" and "$30,000 CSL" at least as often as a
-- plain number. A `numeric` column would refuse those and lose what a
-- person deliberately wrote.
--
-- No RLS changes needed: `matter` already carries its policy, and these
-- are columns on it rather than a new table.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

alter table matter add column if not exists policy_limits text;
alter table matter add column if not exists cause_number  text;
alter table matter add column if not exists county        text;
alter table matter add column if not exists court_room    text;

-- What this migration did, so running it in the SQL editor says something
-- rather than "Success. No rows returned."
select
  count(*)                                            as cases,
  count(policy_limits) filter (where policy_limits <> '') as with_policy_limits,
  count(cause_number)  filter (where cause_number  <> '') as with_cause_number,
  count(county)        filter (where county        <> '') as with_county,
  count(court_room)    filter (where court_room    <> '') as with_court_room
from matter
where deleted_at is null;
