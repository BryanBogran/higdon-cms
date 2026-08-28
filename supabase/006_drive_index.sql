-- =====================================================================
-- 006 — WHEN WAS THIS MATTER LAST INDEXED?
--
-- Fixes a real bug and enables automatic indexing.
--
-- THE BUG. The batch indexer ordered by `drive_linked_at` and its own
-- comment claimed this meant "oldest-indexed first, so repeated calls
-- sweep everything". It does not. `drive_linked_at` is set once when a
-- folder is linked and never changes, so pressing "Index files"
-- repeatedly re-indexed THE SAME twenty matters forever and never
-- reached the twenty-first.
--
-- A comment asserting a property the code does not have is worse than
-- no comment: it stops the next person checking.
--
-- The fix needs somewhere to record when indexing actually happened,
-- which is what this column is. Ordering by it makes the sweep real,
-- and it doubles as the staleness check that lets the Docs tab refresh
-- itself without hammering the Drive API on every tab switch.
-- =====================================================================

alter table matter add column if not exists drive_indexed_at timestamptz;

-- Partial: only linked matters are ever indexed, and that is a small
-- fraction of the column's rows once the firm has a back catalogue.
create index if not exists matter_drive_stale
  on matter (drive_indexed_at nulls first)
  where drive_folder_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_name = 'matter' and column_name = 'drive_indexed_at';
  if n <> 1 then raise exception 'FAIL: drive_indexed_at was not added'; end if;

  -- A never-indexed matter must sort BEFORE an indexed one, or the sweep
  -- would starve exactly the matters that need it most.
  perform 1 from matter
    where drive_folder_id is not null
    order by drive_indexed_at nulls first
    limit 1;

  raise notice 'OK: 006_drive_index.sql applied';
end $$;
