-- ---------------------------------------------------------------------
-- DIAGNOSTIC — "Higvine takes about ten seconds to open"
--
-- ⚠️ NOT A MIGRATION. Read-only. Changes nothing. Safe to run on
-- production at any time. Kept unnumbered so it is never mistaken for one.
--
-- Reported 2026-10-13. Every screen waits on `loadAll()` in
-- lib/data/supabase-store.js, which downloads EVERY row of eight tables --
-- every case, every note, every email with its full body -- 1,000 rows
-- per request, one request after another, before anything is shown.
--
-- File storage (the case-files bucket) is not touched at all while the
-- app opens, so its size and plan cannot be the cause.
--
-- Run each query on its own and send back the results.
-- ---------------------------------------------------------------------

-- ── 1. What the app downloads every time it opens ────────────────────
-- `pages` is how many 1,000-row requests that table costs, back to back.
select t.table_name, t.rows, ceil(t.rows / 1000.0) as pages,
       pg_size_pretty(t.bytes) as size, t.bytes
from (
  select 'activity' as table_name, count(*) as rows, coalesce(sum(pg_column_size(x.*)), 0) as bytes from activity x
  union all select 'matter',                count(*), coalesce(sum(pg_column_size(x.*)), 0) from matter x
  union all select 'matter_checklist_item', count(*), coalesce(sum(pg_column_size(x.*)), 0) from matter_checklist_item x
  union all select 'matter_section_data',   count(*), coalesce(sum(pg_column_size(x.*)), 0) from matter_section_data x
  union all select 'matter_section_row',    count(*), coalesce(sum(pg_column_size(x.*)), 0) from matter_section_row x
  union all select 'contact',               count(*), coalesce(sum(pg_column_size(x.*)), 0) from contact x
  union all select 'profile',               count(*), coalesce(sum(pg_column_size(x.*)), 0) from profile x
  union all select 'matter_relation',       count(*), coalesce(sum(pg_column_size(x.*)), 0) from matter_relation x
) t
order by t.bytes desc;

-- ── 2. Inside `activity`: which kind of entry is the weight ───────────
-- Email bodies are the suspect: every inbound message is filed whole,
-- quoted replies and all, and the card shows it collapsed by default.
select kind,
       count(*)                                                    as rows,
       pg_size_pretty(sum(coalesce(octet_length(body), 0)))        as body_text,
       pg_size_pretty(sum(coalesce(pg_column_size(meta), 0)))      as meta,
       pg_size_pretty(sum(coalesce(pg_column_size(attachments), 0))) as attachment_lists,
       pg_size_pretty(sum(pg_column_size(a.*)))                    as whole_rows
from activity a
group by kind
order by sum(pg_column_size(a.*)) desc;

-- ── 3. How fast it is growing ────────────────────────────────────────
select date_trunc('month', created_at)::date as month,
       count(*)                                   as entries,
       count(*) filter (where kind = 'email')     as emails,
       pg_size_pretty(sum(pg_column_size(a.*)))   as added
from activity a
group by 1
order by 1 desc
limit 6;

-- ── 4. What the LAST page of the activity download costs ─────────────
-- The exact query the app sends for its final page. No index matches
-- `created_at desc, id`, so expect a full sort of the table on every
-- page. Read the "Execution Time" line at the bottom, and whether the
-- Sort says "external merge Disk". EXPLAIN ANALYZE runs the SELECT; it
-- still changes nothing.
--
-- ⚠️ THIS DOES NOT MEASURE THE DOWNLOAD. EXPLAIN never fetches values
-- Postgres stored out of line (TOAST) -- and any email body over ~2 KB is
-- one. On 2026-10-13 this came back at 26 ms for 2,284 rows: the sort is
-- cheap, but that says nothing about how many MB of email text follow it.
-- Queries 1 and 2 measure that.
explain (analyze, buffers)
select * from activity
order by created_at desc, id
limit 1000
offset (select greatest(count(*) - 1000, 0) from activity);
