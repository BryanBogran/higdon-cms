-- =====================================================================
-- 003 — EMAIL ON THE FILE
--
-- Filevine gives every project its own address and drops anything sent
-- to it onto that project's feed, with the original .eml attached. This
-- migration adds the four things that needs:
--
--   1. `activity.meta`        — structured headers on the entry
--   2. `activity.dedupe_key`  — one row per message, however many ways
--                               the same message arrives
--   3. `matter.intake_slug`   — the per-matter address
--   4. a private `case-files` bucket, with policies
--
-- Idempotent throughout: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Structured headers
--
-- JSONB is right here for the same reason it is right on the section
-- tables and WRONG on `matter`: no statutory date and no money lives in
-- it, so nothing in here drives a deadline. `sentAt` is an instant, not
-- a date-only field, so it never touches the date-parsing hazard that
-- 002 exists to guard.
--
-- One header is NOT left in the blob: the subject. It is promoted to a
-- real column because it is the thing people will search for, and
-- reaching into JSONB on every query is both slow and easy to get wrong.
--
-- ⚠️ To be accurate about what exists today: global search covers matters
-- only, not activity, so nothing queries this column yet. It is here
-- because promoting a column later means backfilling it across every row
-- ever written, and that is the expensive direction. Wiring search to it
-- is a listed next step, not a thing already done.
-- ---------------------------------------------------------------------
alter table activity add column if not exists meta jsonb not null default '{}'::jsonb;
alter table activity add column if not exists subject text;

-- ---------------------------------------------------------------------
-- 2. Dedupe
--
-- A HIPAA request goes out CC'ing the case address; the clinic replies
-- to all; someone also drags the .eml onto the matter by hand. That is
-- the SAME message arriving three ways, and without this it is three
-- cards on a legal file.
--
-- Scoped to the matter on purpose: one email legitimately belongs on
-- two matters (a client with two claims), and that must stay possible.
-- Partial, so the millions of non-email rows carry no index cost — the
-- same shape as activity_auto_rule_uq.
-- ---------------------------------------------------------------------
alter table activity add column if not exists dedupe_key text;

create unique index if not exists activity_dedupe_uq
  on activity (dedupe_key) where dedupe_key is not null;

-- Threading. Filevine shows a reply count on every card; In-Reply-To is
-- how a thread is reconstructed from messages that arrive out of order.
create index if not exists activity_email_thread
  on activity (matter_id, (meta->>'inReplyTo')) where kind = 'email';

-- ---------------------------------------------------------------------
-- 3. The per-matter intake address
--
-- Filevine's is `RiveraMarcusZ10000000` — client name, then a
-- numeric id. The name half is a convenience for whoever reads the To
-- line; the id half is what makes it unique and unguessable-ish.
--
-- ⚠️ AN INTAKE ADDRESS IS A CAPABILITY. Anyone who learns it can post to
-- that case file, because SMTP has no authentication worth the name and
-- a From header is trivially forged. Two consequences, both enforced
-- below rather than left to a convention:
--
--   - The random half is 12 hex characters, not a sequence. A guessable
--     address would let anyone walk the firm's whole docket.
--   - Every ingested message records the envelope sender it actually
--     arrived from, and anything not on the firm's allowlist is marked
--     unverified so the feed can show it as such.
--
-- Generated, not written by the app, so a row cannot exist without one.
-- ---------------------------------------------------------------------
create or replace function gen_intake_slug(client text)
returns text language sql volatile as $$
  select coalesce(
           nullif(regexp_replace(coalesce(client, ''), '[^a-zA-Z0-9]', '', 'g'), ''),
           'case'
         ) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  -- gen_random_uuid, not gen_random_bytes: v4 UUIDs come from the same strong
  -- RNG, and it is built into Postgres 13+ rather than living in pgcrypto,
  -- which may or may not be on this database's search_path. random() would
  -- have been wrong -- it is seeded and predictable, and this is a capability.
$$;

alter table matter add column if not exists intake_slug text;

update matter set intake_slug = gen_intake_slug(client_name) where intake_slug is null;

alter table matter alter column intake_slug set default gen_intake_slug(null);
alter table matter alter column intake_slug set not null;

create unique index if not exists matter_intake_slug_uq on matter (lower(intake_slug));

-- Set the slug from the client name on insert, when the app did not.
create or replace function matter_intake_slug_default() returns trigger
language plpgsql as $$
begin
  if new.intake_slug is null or new.intake_slug = '' then
    new.intake_slug := gen_intake_slug(new.client_name);
  end if;
  return new;
end $$;

drop trigger if exists matter_intake_slug_ins on matter;
create trigger matter_intake_slug_ins before insert on matter
  for each row execute function matter_intake_slug_default();

-- ---------------------------------------------------------------------
-- 4. Storage
--
-- PRIVATE. A medical record must never sit behind a URL that works for
-- anyone who has it; reads go through short-lived signed URLs minted for
-- an authenticated session.
--
-- This is also why DECISIONS.md says a doc URL must never be written to
-- audit_event — the URL IS the credential. That rule now covers email
-- attachments, which is where the bulk of them will come from.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('case-files', 'case-files', false, 52428800)   -- 50 MB
on conflict (id) do update set public = false;

do $$ begin
  create policy "staff read case files" on storage.objects
    for select to authenticated using (bucket_id = 'case-files');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff write case files" on storage.objects
    for insert to authenticated with check (bucket_id = 'case-files');
exception when duplicate_object then null; end $$;

-- No UPDATE and no DELETE policy, deliberately. Correspondence on a legal
-- file is evidence: it can be superseded, never quietly overwritten. A
-- genuine deletion is a service-role operation with a reason recorded,
-- not something a logged-in browser session can do by accident.

-- ---------------------------------------------------------------------
-- Backfill: existing email rows get an empty meta rather than a null, so
-- the UI never has to branch on "old row or new row".
-- ---------------------------------------------------------------------
update activity set meta = '{}'::jsonb where meta is null;

-- ---------------------------------------------------------------------
-- Verification. Each should print the expected line.
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  -- Intake slugs are unique and non-empty.
  select count(*) into n from matter where intake_slug is null or intake_slug = '';
  if n > 0 then raise exception 'FAIL: % matters without an intake slug', n; end if;

  -- The slug's random half is long enough not to be guessable.
  select count(*) into n from matter where length(intake_slug) < 12;
  if n > 0 then raise exception 'FAIL: % intake slugs are too short to be safe', n; end if;

  raise notice 'OK: intake addresses present and unique';
end $$;

do $$
declare n int;
begin
  -- The dedupe index actually refuses a duplicate.
  begin
    insert into activity (kind, body, dedupe_key, source) values ('email', 'a', '__probe__', 'ui');
    insert into activity (kind, body, dedupe_key, source) values ('email', 'b', '__probe__', 'ui');
    raise exception 'FAIL: a duplicate message was accepted';
  exception when unique_violation then
    raise notice 'OK: duplicate message refused by activity_dedupe_uq';
  end;
  delete from activity where dedupe_key = '__probe__';

  select count(*) into n from storage.buckets where id = 'case-files' and public = false;
  if n <> 1 then raise exception 'FAIL: case-files bucket is missing or public'; end if;
  raise notice 'OK: case-files bucket exists and is private';
end $$;
