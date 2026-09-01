-- ---------------------------------------------------------------------
-- 014 — the deadline engine could not write
--
-- ⚠️ Run this. It fixes a silent failure, not a cosmetic one.
--
-- The Supabase logs were full of:
--
--     42P10  there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
--
-- ── What was actually broken ──────────────────────────────────────────
--
-- `regenerateChain` upserts the automatic deadline tasks — Answer Due,
-- SOL, discovery responses — with ON CONFLICT (matter_id, rule_key). The
-- index backing that is PARTIAL:
--
--     create unique index activity_auto_rule_uq
--       on activity (matter_id, rule_key) where source = 'auto';
--
-- Postgres will not use a partial index for ON CONFLICT unless the
-- statement repeats the predicate — `ON CONFLICT (...) WHERE source =
-- 'auto'`. PostgREST's `on_conflict` parameter takes column names only
-- and cannot express a WHERE, so the upsert could never match and every
-- call failed.
--
-- The consequence is the part that matters: EVERY regeneration of the
-- deadline chain failed. Editing an SOL, a trial date or a DCO wrote the
-- date to `matter` and then failed to write the tasks that date implies.
-- The app reported the save as fine, because the matter update succeeded.
--
-- ── The fix ───────────────────────────────────────────────────────────
--
-- Drop the predicate. A plain unique index on (matter_id, rule_key) is
-- equivalent here: `rule_key` is written ONLY on rows with source =
-- 'auto' — nothing else in the codebase sets it — and Postgres does not
-- consider two NULLs equal, so the thousands of manual notes and tasks
-- with a null rule_key never collide with each other or with anything.
--
-- Same guarantee, and ON CONFLICT can actually use it.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- Look before leaping. The partial index never constrained rows with a
-- rule_key and a source other than 'auto', so in principle a duplicate
-- could exist that the new index would reject. Expect zero rows.
select matter_id, rule_key, count(*) as copies
  from activity
 where rule_key is not null
 group by matter_id, rule_key
having count(*) > 1;

-- If the query above returned nothing, this succeeds.
drop index if exists activity_auto_rule_uq;

create unique index if not exists activity_auto_rule_uq
  on activity (matter_id, rule_key);

-- ---------------------------------------------------------------------
-- Confirmation. `indpred` is the partial predicate; it must now be null.
-- ---------------------------------------------------------------------
select
  i.relname                                   as index_name,
  pg_get_indexdef(i.oid)                      as definition,
  (x.indpred is null)                         as usable_by_on_conflict
  from pg_class i
  join pg_index x on x.indexrelid = i.oid
 where i.relname = 'activity_auto_rule_uq';
