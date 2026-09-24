-- ---------------------------------------------------------------------
-- DIAGNOSTIC — "two attachments on one email open the same file"
--
-- ⚠️ NOT A MIGRATION. Read-only. Changes nothing. Safe to run on
-- production at any time. Kept unnumbered so it is never mistaken for one.
--
-- Reported 2026-09-23. Until then every email attachment was stored at
-- `<matter>/email/<message>/<filename>` with upsert, so a message carrying
-- two files with the same name (Outlook signature logos: image.png,
-- image001.jpg) wrote both to ONE object and the second replaced the
-- first. Every card in the group now opens the last one uploaded.
--
-- ── What this can and cannot tell you ───────────────────────────────
--
-- A row with a repeated `path` is where storage lost bytes: of the N
-- entries sharing a path, N-1 now open somebody else's file.
--
-- `distinct_sizes` says how bad it is. Each entry kept its OWN size, so:
--   * sizes differ  -> different files, and some of them are no longer
--                      in storage. Real loss from the bucket.
--   * sizes all the same -> almost always the same logo attached twice;
--                      probably nothing of value was lost.
--
-- ── Nothing is unrecoverable, as long as the .eml survived ──────────
--
-- The original message is stored beside its attachments (role
-- 'original'), and every attachment is inside it. Re-parse that .eml
-- and the overwritten files come back byte for byte. Query 3 checks the
-- one case where that fails: an attachment whose path landed on the
-- original itself.
-- ---------------------------------------------------------------------

-- ── 1. The headline: how many emails and files are affected ──────────
with files as (
  select a.id as activity_id, f.value as file
  from activity a
  cross join lateral jsonb_array_elements(a.attachments) as f(value)
  where jsonb_typeof(a.attachments) = 'array'
    and f.value ->> 'path' is not null
),
groups as (
  select
    activity_id,
    file ->> 'path'                       as path,
    count(*)                              as copies,
    count(distinct file ->> 'size')       as distinct_sizes
  from files
  group by activity_id, file ->> 'path'
  having count(*) > 1
)
select
  count(distinct activity_id)                               as emails_affected,
  count(*)                                                  as colliding_paths,
  coalesce(sum(copies - 1), 0)                              as attachments_overwritten,
  count(distinct activity_id) filter (where distinct_sizes > 1)
                                                            as emails_with_real_loss,
  coalesce(sum(copies - 1) filter (where distinct_sizes > 1), 0)
                                                            as attachments_really_lost
from groups;

-- ── 2. Every colliding path, by case, newest first ───────────────────
with files as (
  select a.id as activity_id, a.matter_id, a.created_at, f.value as file, f.ord
  from activity a
  cross join lateral jsonb_array_elements(a.attachments) with ordinality as f(value, ord)
  where jsonb_typeof(a.attachments) = 'array'
    and f.value ->> 'path' is not null
)
select
  m.case_number,
  m.client_name,
  f.activity_id,
  f.created_at,
  f.file ->> 'path'                                      as path,
  count(*)                                               as copies,
  count(distinct f.file ->> 'size')                      as distinct_sizes,
  array_agg(f.file ->> 'name' order by f.ord)            as names,
  array_agg((f.file ->> 'size')::bigint order by f.ord)  as sizes
from files f
left join matter m on m.id = f.matter_id
group by m.case_number, m.client_name, f.activity_id, f.created_at, f.file ->> 'path'
having count(*) > 1
order by f.created_at desc, path;

-- ── 3. Was any ORIGINAL .eml overwritten? (the unrecoverable case) ───
-- Expect zero rows. A row here means an attachment was written over the
-- stored message itself, and the re-parse in the note above cannot help.
select a.id as activity_id, m.case_number, f.value ->> 'path' as path,
       array_agg(f.value ->> 'role') as roles
from activity a
left join matter m on m.id = a.matter_id
cross join lateral jsonb_array_elements(a.attachments) as f(value)
where jsonb_typeof(a.attachments) = 'array'
group by a.id, m.case_number, f.value ->> 'path'
having count(*) > 1
   and bool_or(f.value ->> 'role' = 'original');
