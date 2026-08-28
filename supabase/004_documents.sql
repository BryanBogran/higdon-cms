-- =====================================================================
-- 004 — DOCUMENTS, WITH GOOGLE DRIVE AS THE SYSTEM OF RECORD
--
-- The firm keeps one Drive folder per case and is not moving them. So
-- Drive holds the FILES and this database holds an INDEX of them:
-- enough to search, filter and show a Documents page without hitting
-- the Drive API on every keystroke, and nothing that duplicates a byte.
--
-- ⚠️ THIS TABLE IS A CACHE, NOT A RECORD. Everything in it can be
-- rebuilt by re-running a sync. Nothing may live here that does not
-- exist in Drive, because the day the two disagree, Drive is right.
-- The one exception is `matter_id`: the link between a folder and a
-- case is OUR knowledge and exists nowhere in Drive, which is why it
-- sits on `matter` below rather than in this cache.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The folder link — confirmed once, then permanent
--
-- Drive folders here are named with the CLIENT NAME ONLY, so the first
-- match is a fuzzy, human-confirmed guess. After that this id is the
-- only thing used, and name matching never runs for that matter again.
--
-- That ordering is the whole safety property: renaming a client, fixing
-- a typo, or a second client with the same surname arriving next year
-- cannot silently re-point an existing case at someone else's records.
-- ---------------------------------------------------------------------
alter table matter add column if not exists drive_folder_id text;
alter table matter add column if not exists drive_folder_name text;
alter table matter add column if not exists drive_linked_at timestamptz;
alter table matter add column if not exists drive_linked_by uuid references profile(id);

-- One case, one folder, and one folder, one case. Without this, two
-- matters can point at the same folder and each will show the other's
-- documents -- with no error anywhere.
create unique index if not exists matter_drive_folder_uq
  on matter (drive_folder_id) where drive_folder_id is not null;

-- ---------------------------------------------------------------------
-- 2. The file index
-- ---------------------------------------------------------------------
do $$ begin
  create type doc_provider as enum ('drive', 'supabase');
exception when duplicate_object then null; end $$;

create table if not exists document (
  id             uuid primary key default gen_random_uuid(),
  matter_id      uuid references matter(id) on delete cascade,

  provider       doc_provider not null default 'drive',
  external_id    text not null,        -- Drive file id, or a storage path
  name           text not null,
  mime_type      text,
  size_bytes     bigint,

  -- Drive's own path within the case folder, so a nested structure
  -- survives into our UI instead of being flattened into one list.
  folder_path    text not null default '',
  web_view_link  text,                 -- Drive's UI link; NOT a download URL

  -- Drive's timestamps, not ours. Sorting a legal file by "when we
  -- happened to notice this" rather than "when it was created" is the
  -- sort of thing nobody spots until it matters.
  created_time   timestamptz,
  modified_time  timestamptz,

  -- What this file is attached to in our world, when we know: a
  -- checklist item, a section row, or an email on the feed.
  field_key      text,
  activity_id    uuid references activity(id) on delete set null,

  trashed        boolean not null default false,
  indexed_at     timestamptz not null default now(),

  constraint document_external_id_not_blank check (length(trim(external_id)) > 0)
);

-- Re-running a sync must UPDATE rather than duplicate. This is the
-- idempotency mechanism, the same shape as activity_auto_rule_uq.
create unique index if not exists document_provider_external_uq
  on document (provider, external_id);

create index if not exists document_matter on document (matter_id) where not trashed;
create index if not exists document_name    on document (lower(name));
create index if not exists document_activity on document (activity_id) where activity_id is not null;

-- ---------------------------------------------------------------------
-- 3. The unmatched queue
--
-- A Drive folder the sync could not confidently attach to a case. It is
-- a ROW, not a log line, because somebody has to come back and resolve
-- it and a log line is not a work queue.
--
-- Deliberately never auto-resolved. See lib/domain/drive-match.js: a
-- folder of medical records attached to the wrong client is a privilege
-- breach, and an unlinked folder is a dropdown. Those costs are not
-- close, so ambiguity always stops and asks.
-- ---------------------------------------------------------------------
create table if not exists drive_folder_review (
  folder_id     text primary key,
  folder_name   text not null,
  candidates    jsonb not null default '[]'::jsonb,  -- [{matterId, name, why}]
  reason        text not null,                       -- 'ambiguous' | 'unmatched'
  dismissed     boolean not null default false,
  seen_at       timestamptz not null default now()
);

create index if not exists drive_review_open
  on drive_folder_review (seen_at desc) where not dismissed;

-- ---------------------------------------------------------------------
-- 4. RLS — same blanket policy as every other table
-- ---------------------------------------------------------------------
alter table document enable row level security;
alter table drive_folder_review enable row level security;

do $$ begin
  create policy staff_all on document for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy staff_all on drive_folder_review for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
do $$
begin
  -- Two matters must not be able to claim the same Drive folder.
  begin
    insert into matter (client_name, drive_folder_id) values ('__probe_a__', '__folder__');
    insert into matter (client_name, drive_folder_id) values ('__probe_b__', '__folder__');
    raise exception 'FAIL: two matters accepted the same Drive folder';
  exception when unique_violation then
    raise notice 'OK: a Drive folder cannot be claimed by two matters';
  end;

  -- Re-indexing the same Drive file must update, not duplicate.
  begin
    insert into document (provider, external_id, name) values ('drive', '__probe__', 'a');
    insert into document (provider, external_id, name) values ('drive', '__probe__', 'b');
    raise exception 'FAIL: the same Drive file was indexed twice';
  exception when unique_violation then
    raise notice 'OK: re-indexing a file updates in place';
  end;
  delete from document where external_id = '__probe__';

  raise notice 'OK: 004_documents.sql applied';
end $$;
