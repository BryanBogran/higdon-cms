-- ---------------------------------------------------------------------
-- 016 — put the right name on tasks that say "Unknown"
--
-- Tasks raised from the Tasks tab were inserted without an
-- `author_label`, so the feed showed "Unknown created a task". The code
-- is fixed; this repairs the rows already written.
--
-- ── The name was never actually lost ────────────────────────────────
--
-- `audit_row()` fires on every insert into `activity` and records
-- `auth.uid()` as `actor_id`. So the database has known who created each
-- of these all along — it simply was not being read back onto the row.
-- This is a recovery, not a guess.
--
-- ── Two shapes of wrong ─────────────────────────────────────────────
--
--   author_label IS NULL      the original bug: nothing was written
--   author_label = 'Unknown'  a narrow window between two fixes, where
--                             the app wrote the literal word. React was
--                             handing the store a stale closure over a
--                             not-yet-loaded user, and 'Unknown' is the
--                             UI's fallback for a missing value — so it
--                             got persisted as though it were a value.
--
-- Both are repaired. 'Unknown' is not a name anybody has.
--
-- ── What is deliberately NOT touched ────────────────────────────────
--
--   source = 'auto'     deadline-chain tasks. A rule generated these,
--                       not a person. Attributing one to whoever
--                       happened to save the date that triggered it
--                       would be inventing authorship, which is worse
--                       than leaving it blank.
--
--   actor_id is null    inserts with no authenticated user: the inbound
--                       email webhook (service role), imports, seeds.
--                       The join drops them and they stay as they are,
--                       correctly — no user made them.
--
-- ⚠️ This UPDATE is itself audited. `audit_activity` will write one 'U'
-- row per task repaired, attributed to whoever runs this. That is the
-- audit log working as intended: the correction is part of the history,
-- not a silent rewrite of it.
--
-- Safe to re-run: it only touches rows that are still wrong.
-- ---------------------------------------------------------------------

update activity a
set author_label = coalesce(p.display_name, p.handle, p.email::text)
from audit_event e
join profile p on p.id = e.actor_id
where e.table_name = 'activity'
  and e.op = 'I'
  and (e.row_pk ->> 'id') = a.id::text
  and a.source <> 'auto'
  and (a.author_label is null or a.author_label = 'Unknown');

-- What is left, and why — so this reports something rather than
-- "Success. No rows returned."
select
  count(*) filter (where author_label is not null and author_label <> 'Unknown')
    as now_attributed,
  count(*) filter (where (author_label is null or author_label = 'Unknown') and source = 'auto')
    as left_blank_auto_generated,
  count(*) filter (where (author_label is null or author_label = 'Unknown') and source <> 'auto')
    as left_blank_no_actor_recorded
from activity
where kind = 'task';
