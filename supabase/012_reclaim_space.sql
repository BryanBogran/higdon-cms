-- ---------------------------------------------------------------------
-- 012 — reclaiming disk after deletions
--
-- ⚠️ Read this before running it. Not a migration: a maintenance script
-- you run occasionally, by hand, and mostly will not need.
--
-- ── What DELETE actually does, which is not what people expect ────────
--
-- Deleting a row in Postgres does NOT free disk. It marks the row dead
-- and leaves it in place. Three consequences:
--
--   1. The database file does not shrink. Purging 25 demo matters frees
--      nothing you can see in the dashboard's size figure.
--
--   2. AUTOVACUUM — which Supabase runs for you, continuously — comes
--      along and marks that space REUSABLE. The file still does not
--      shrink, but the next rows written go into the holes instead of
--      growing the file. For almost every case this is the whole answer
--      and there is nothing to do.
--
--   3. Only VACUUM FULL returns space to the operating system, and it
--      does it by rewriting the entire table into a new file.
--
-- ── The cost of VACUUM FULL, stated plainly ───────────────────────────
--
-- It takes an ACCESS EXCLUSIVE lock. For the duration, that table cannot
-- be read OR written — the app will error, not wait politely. It also
-- needs free disk equal to the size of the table while it runs.
--
-- On this database that is seconds, because the whole thing is a few MB.
-- Do not carry the habit to a large one.
--
-- ── VACUUM cannot run inside a transaction ────────────────────────────
--
-- If you get `VACUUM cannot run inside a transaction block`, the client
-- wrapped it. Run the VACUUM line ON ITS OWN, selected by itself, rather
-- than as part of a larger script.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 1. LOOK FIRST. This is the part worth running; it changes nothing.
--
--   total_size   what the table occupies including its indexes
--   dead_rows    rows deleted but not yet reclaimed
--   last_autovacuum  if this is recent, Postgres has already handled it
--                    and VACUUM FULL will free almost nothing
-- =====================================================================
select
  relname                                             as table_name,
  pg_size_pretty(pg_total_relation_size(relid))       as total_size,
  n_live_tup                                          as live_rows,
  n_dead_tup                                          as dead_rows,
  case when n_live_tup + n_dead_tup = 0 then 0
       else round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
  end                                                 as pct_dead,
  coalesce(last_autovacuum, last_vacuum)              as last_vacuumed
  from pg_stat_user_tables
 where schemaname = 'public'
 order by pg_total_relation_size(relid) desc;

-- Whole-database size, which is the number the dashboard shows.
select pg_size_pretty(pg_database_size(current_database())) as database_size;


-- =====================================================================
-- 2. The gentle option, and the right one nearly always.
--
-- Reclaims dead space for reuse and refreshes the planner's statistics.
-- Takes only a light lock; the app keeps working throughout. Run this
-- after a large purge or import.
--
-- Uncomment and run:
-- =====================================================================
-- vacuum (analyze);


-- =====================================================================
-- 3. The heavy option. Locks each table while it rewrites it.
--
-- Only worth it when step 1 shows a table that is BOTH large AND mostly
-- dead — say over 50 MB and above 20% dead — and autovacuum has not
-- already dealt with it. Purging 25 demo matters does not qualify.
--
-- Run each line ON ITS OWN, and not during business hours.
-- =====================================================================
-- vacuum (full, analyze) audit_event;
-- vacuum (full, analyze) matter;
-- vacuum (full, analyze) activity;
-- vacuum (full, analyze) matter_section_row;
-- vacuum (full, analyze) matter_checklist_item;


-- =====================================================================
-- 4. Orphans — rows whose matter is gone.
--
-- There should never be any: every child table declares ON DELETE
-- CASCADE. This is the check that proves it rather than assuming it, and
-- it is the honest answer to "make sure there are no empty tables left
-- behind". If any of these are non-zero, something bypassed a foreign
-- key and that is worth understanding before deleting anything.
-- =====================================================================
select 'matter_checklist_item' as table_name, count(*) as orphaned_rows
  from matter_checklist_item i
 where not exists (select 1 from matter m where m.id = i.matter_id)
union all
select 'activity', count(*) from activity a
 where a.matter_id is not null
   and not exists (select 1 from matter m where m.id = a.matter_id)
union all
select 'matter_section_row', count(*) from matter_section_row r
 where not exists (select 1 from matter m where m.id = r.matter_id)
union all
select 'matter_section_data', count(*) from matter_section_data d
 where not exists (select 1 from matter m where m.id = d.matter_id)
union all
select 'matter_relation', count(*) from matter_relation x
 where not exists (select 1 from matter m where m.id = x.from_id)
    or not exists (select 1 from matter m where m.id = x.to_id)
union all
-- Audit rows are EXPECTED to outlive their matter — that is the point of
-- an audit trail, and delete_matter() leaves exactly one tombstone per
-- purged case. A number here is not a fault; a very large one means
-- purges are happening often.
select 'audit_event (tombstones — expected)', count(*)
  from audit_event e
 where e.row_pk ? 'matter_id'
   and not exists (select 1 from matter m where m.id::text = e.row_pk->>'matter_id')
 order by 1;
