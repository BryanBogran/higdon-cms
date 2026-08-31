-- =====================================================================
-- Higdon CMS — schema
--
-- Run once, whole file, in the Supabase SQL editor.
-- Safe to re-run: every statement is idempotent.
--
-- The governing idea: THE DATABASE REFUSES BAD DATA -- with one
-- important limit, stated up front because an earlier version of this
-- comment got it wrong.
--
-- A `date` column rejects 'TBD', 'n/a', '', and impossible calendar
-- dates like 2024-02-30, and the CHECKs below reject out-of-range years
-- and an SOL before the DOA. All of that is real protection the
-- prototype never had.
--
-- What it does NOT do is disambiguate. Postgres's default DateStyle is
-- 'ISO, MDY', so '3/1/24' is a valid literal meaning 2024-03-01, and
-- given '13/1/24' it silently switches to DMY. No database can solve
-- that -- only a human knows which the firm meant. So the importer must
-- call parse_iso_date() (see 002_date_guard.sql) rather than casting
-- raw spreadsheet cells.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type matter_status as enum
    ('Open', 'Closed', 'Settled - Not Disbursed', 'Default Judgment');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Distinct from status. Filevine carries both: status is whether the
  -- file is open, phase is where the work has got to.
  create type matter_phase as enum
    ('Intake', 'Treatment', 'Demand', 'Litigation', 'Settlement', 'Disbursement', 'Closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type insurance_class as enum
    ('Commercial', 'Personal Lines', 'Self-Insured / Government', 'Unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('admin', 'attorney', 'paralegal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_kind as enum
    ('note', 'task', 'call', 'text', 'email', 'fax', 'reminder', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type record_source as enum ('ui', 'auto', 'import', 'system');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- profile — one row per auth user
--
-- `handle` is separate from `display_name` because Filevine renders
-- mentions as @jscholl while assignment shows "Alex TurnerJr.".
-- `is_role_account` covers aliases like @hlaccounting, which appear
-- alongside real people in the feed.
-- ---------------------------------------------------------------------
create table if not exists profile (
  id               uuid primary key references auth.users(id) on delete cascade,
  handle           citext not null unique,
  display_name     text   not null,
  email            citext not null unique,
  role             user_role not null default 'paralegal',
  is_role_account  boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- matter
-- ---------------------------------------------------------------------
create table if not exists matter (
  id                 uuid primary key default gen_random_uuid(),

  case_number        text,
  project_name       text,          -- names carry free-text suffixes ("... 26-044 1st case")
  client_name        text not null,
  client_phone       text,
  client_email       citext,

  attorney           text,          -- free text until Parties is a real entity
  primary_user_id    uuid references profile(id),

  status             matter_status not null default 'Open',
  phase              matter_phase,

  -- Every date is a real `date`. This is the forcing function.
  open_date          date,
  doa                date,
  sol                date,
  trial_date         date,
  dco                date,
  settlement_date    date,

  settlement_amount  numeric(14,2),

  opposing_counsel   text,
  insurance          text,
  insurance_class    insurance_class not null default 'Unknown',
  referral           text,
  cross_ref_case     text,
  demands            text,
  how_settled        text,
  check_status       text,

  -- Shapeless tail, and anything the UI adds before it earns a column.
  extra              jsonb not null default '{}'::jsonb,

  legacy_filevine_id text,          -- the numeric id under each Project Hub row
  pinned             boolean not null default false,
  legal_hold         boolean not null default false,

  last_activity_at   timestamptz not null default now(),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid references profile(id),

  constraint case_number_format
    check (case_number is null or case_number ~ '^\d{2}-\d{3}$'),

  -- Literal bounds, never current_date: CHECKs are re-validated on
  -- dump/restore, so current_date would let a row legal today break a
  -- restore in 2031. "Not in 1904" belongs here; "not in the future"
  -- belongs in app validation.
  constraint doa_range   check (doa         is null or doa         between date '1980-01-01' and date '2100-01-01'),
  constraint sol_range   check (sol         is null or sol         between date '1980-01-01' and date '2100-01-01'),
  constraint trial_range check (trial_date  is null or trial_date  between date '1980-01-01' and date '2100-01-01'),
  constraint dco_range   check (dco         is null or dco         between date '1980-01-01' and date '2100-01-01'),
  constraint sol_after_doa
    check (sol is null or doa is null or sol > doa),
  constraint settlement_nonneg
    check (settlement_amount is null or settlement_amount >= 0)
);

-- Partial on deleted_at so a soft-deleted bad import doesn't permanently
-- burn its own case numbers.
create unique index if not exists matter_case_number_uq
  on matter (case_number) where case_number is not null and deleted_at is null;

create index if not exists matter_live_sol   on matter (sol)        where deleted_at is null;
create index if not exists matter_live_trial on matter (trial_date) where deleted_at is null;
create index if not exists matter_activity   on matter (last_activity_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------
-- matter_checklist_item — the 13-item litigation checklist
--
-- `occurred_on`, NOT `date`. It is the date a legal event happened in
-- the world, and must never be confused with updated_at, which is when
-- a human typed it. The audit trail needs both, and a column called
-- `date` sitting next to created_at invites exactly that conflation.
-- ---------------------------------------------------------------------
create table if not exists matter_checklist_item (
  matter_id    uuid not null references matter(id) on delete cascade,
  field_key    text not null,
  done         boolean not null default false,
  occurred_on  date,
  doc_url      text,
  note         text,          -- carries raw imported text that wasn't yes/no
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profile(id),
  primary key (matter_id, field_key),
  constraint occurred_on_range
    check (occurred_on is null or occurred_on between date '1980-01-01' and date '2100-01-01')
);

-- Deliberately NO `check (done implies occurred_on is not null)`. That
-- would reject the real spreadsheet and force the importer to fabricate
-- dates — a visible gap traded for an invisible lie. Index the gap and
-- surface it instead: five of the eight chain rules gate on
-- `done AND occurred_on`, so these rows silently produce no deadline.
create index if not exists checklist_done_no_date
  on matter_checklist_item (matter_id) where done and occurred_on is null;

-- ---------------------------------------------------------------------
-- activity — ONE table for notes, tasks, calls, texts, emails, the feed
--
-- A Filevine task IS a note that carries an assignee and a due date:
-- the same card shows body text, @mentions, attachments, assignee, due
-- date, completion, a pin and a reply count. So task-ness is the
-- presence of assignment fields, not a separate entity.
--
-- Consequence worth noting: "Assign as Task" is an UPDATE, not an
-- INSERT, which is why Filevine can promote a note in place.
-- ---------------------------------------------------------------------
create table if not exists activity (
  id            uuid primary key default gen_random_uuid(),
  matter_id     uuid references matter(id) on delete cascade,
  kind          activity_kind not null default 'note',
  body          text,

  author_id     uuid references profile(id),
  author_label  text,          -- snapshot; survives a profile being removed
  mentions      text[] not null default '{}',
  attachments   jsonb  not null default '[]'::jsonb,

  pinned        boolean not null default false,
  parent_id     uuid references activity(id) on delete cascade,  -- threaded replies

  -- Present only when this row is a task.
  assigned_to   text,
  due_date      date,
  auto_due_date date,
  manual_override boolean not null default false,
  completed     boolean not null default false,
  completed_at  timestamptz,
  calendar_synced boolean not null default false,

  source        record_source not null default 'ui',
  rule_key      text,          -- set only when source = 'auto'
  title         text,          -- null for auto rows: rendered from CHAIN_RULES

  created_at    timestamptz not null default now(),

  constraint auto_iff_rule check ((source = 'auto') = (rule_key is not null)),
  constraint completed_coherent check (completed = (completed_at is not null)),
  constraint due_range
    check (due_date is null or due_date between date '1980-01-01' and date '2100-01-01')
);

-- THE chain idempotency mechanism. At most one auto task per matter per
-- rule, so regeneration updates in place instead of duplicating.
create unique index if not exists activity_auto_rule_uq
  on activity (matter_id, rule_key) where source = 'auto';

create index if not exists activity_matter_time on activity (matter_id, created_at desc);
create index if not exists activity_open_due    on activity (due_date) where kind = 'task' and not completed;
create index if not exists activity_pinned      on activity (created_at desc) where pinned;

-- ---------------------------------------------------------------------
-- Generic section engine storage
--
-- JSONB is correct HERE, unlike on `matter`: these rows carry no
-- statutory dates and no money that drives a decision. Any field that
-- grows teeth gets promoted to a typed column in its own table later.
-- ---------------------------------------------------------------------
create table if not exists matter_section_data (
  matter_id   uuid not null references matter(id) on delete cascade,
  section_key text not null,
  fields      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (matter_id, section_key)
);

create table if not exists matter_section_row (
  id          uuid primary key default gen_random_uuid(),
  matter_id   uuid not null references matter(id) on delete cascade,
  section_key text not null,
  ordinal     integer not null default 0,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists section_row_lookup
  on matter_section_row (matter_id, section_key, ordinal);

-- ---------------------------------------------------------------------
-- Case numbers: YY-NNN, resetting every year
--
-- A counter row, not a SEQUENCE. Sequences don't roll back, so a failed
-- transaction burns a number — and 26-042 *means* "the 42nd case opened
-- in 2026", so gaps are wrong, not merely untidy.
-- ---------------------------------------------------------------------
create table if not exists case_number_counter (
  year_yy  char(2) primary key,
  last_seq integer not null check (last_seq between 0 and 999)
);

create or replace function allocate_case_number(p_year_yy char(2) default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year char(2) := coalesce(
    p_year_yy,
    to_char((now() at time zone 'America/Chicago')::date, 'YY')
  );
  v_number text;
begin
  insert into case_number_counter (year_yy, last_seq)
  values (v_year, 1)
  on conflict (year_yy)
    do update set last_seq = case_number_counter.last_seq + 1
  returning year_yy || '-' || lpad(last_seq::text, 3, '0') into v_number;

  return v_number;
end $$;

-- TWO grants have to go, not one. Postgres grants EXECUTE to PUBLIC on any
-- new function, AND Supabase's default privileges for the public schema
-- grant it directly to `anon`. Those are separate ACL entries, so revoking
-- PUBLIC alone leaves anon able to call it -- which is anyone holding the
-- publishable key, since that ships in the browser. This is SECURITY
-- DEFINER, so RLS would not save it. See supabase/007_function_grants.sql.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function allocate_case_number(char) from anon';
  end if;
end $$;
revoke execute on function allocate_case_number(char) from public;
grant execute on function allocate_case_number(char) to authenticated;

-- Seed the counter from any case numbers already present, or the first
-- new matter of the year will collide with imported history.
create or replace function reseed_case_number_counter()
returns void language sql security definer set search_path = public as $$
  insert into case_number_counter (year_yy, last_seq)
  select split_part(case_number, '-', 1)::char(2),
         max(split_part(case_number, '-', 2)::int)
    from matter
   where case_number ~ '^\d{2}-\d{3}$' and deleted_at is null
   group by 1
  on conflict (year_yy) do update
    set last_seq = greatest(case_number_counter.last_seq, excluded.last_seq);
$$;

-- SECURITY DEFINER, so it reads matter past RLS. Same two grants as above.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function reseed_case_number_counter() from anon';
  end if;
end $$;
revoke execute on function reseed_case_number_counter() from public;
grant execute on function reseed_case_number_counter() to authenticated;

-- ---------------------------------------------------------------------
-- audit_event — append-only, trigger-written
--
-- Kept even on a one-day build, because it is the ONLY item here that
-- cannot be retrofitted for the period it was missing. Every other gap
-- can be filled next week and the data repaired; three months of "who
-- marked Served done, and when" simply would not exist.
-- ---------------------------------------------------------------------
create table if not exists audit_event (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default clock_timestamp(),
  actor_id      uuid,
  table_name    text not null,
  row_pk        jsonb not null,
  op            char(1) not null check (op in ('I', 'U', 'D')),
  changed_cols  text[],
  old_row       jsonb,
  new_row       jsonb
);

create index if not exists audit_by_matter
  on audit_event ((row_pk->>'matter_id'), occurred_at desc);
create index if not exists audit_by_time on audit_event (occurred_at desc);

-- Redact document URLs. They are capability links to privileged files,
-- and an append-only table you cannot edit is the wrong place for them.
create or replace function audit_redact(payload jsonb)
returns jsonb language sql immutable as $$
  select case
    when payload is null then null
    when payload ? 'doc_url' then
      jsonb_set(payload, '{doc_url}',
        to_jsonb(case when payload->>'doc_url' is null then null else 'set' end))
    else payload
  end
$$;

-- Same two revokes as every other function here, so a database built from
-- this file has no anon-callable RPC at all. It is pure and reads nothing,
-- so this is surface reduction rather than a data fix -- but the trigger
-- runs as the table owner and no client calls it, so nothing needs the
-- grant. See supabase/009_audit_redact_grant.sql, which closes it on the
-- databases that predate this.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function audit_redact(jsonb) from anon';
  end if;
end $$;
revoke execute on function audit_redact(jsonb) from public;
grant execute on function audit_redact(jsonb) to authenticated;

-- One generic trigger for every audited table.
--
-- Field access goes through to_jsonb(...)->>'col' rather than new.col on
-- purpose: `new.matter_id` would be invalid on the `matter` table, which
-- has no such column, and relying on CASE short-circuiting to keep an
-- invalid field reference unevaluated is the kind of thing that fails at
-- runtime in production and not in review.
create or replace function audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then audit_redact(to_jsonb(old)) end;
  v_new jsonb := case when tg_op <> 'DELETE' then audit_redact(to_jsonb(new)) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into audit_event (actor_id, table_name, row_pk, op, changed_cols, old_row, new_row)
  values (
    auth.uid(),
    tg_table_name,
    case tg_table_name
      when 'matter' then
        jsonb_build_object('matter_id', v_row->>'id')
      when 'matter_checklist_item' then
        jsonb_build_object('matter_id', v_row->>'matter_id',
                           'field_key', v_row->>'field_key')
      else
        jsonb_build_object('id',        v_row->>'id',
                           'matter_id', v_row->>'matter_id')
    end,
    left(tg_op, 1),
    case when tg_op = 'UPDATE' then (
      select array_agg(key) from jsonb_each(v_new)
       where v_old -> key is distinct from v_new -> key
    ) end,
    v_old, v_new
  );
  return null;
end $$;

drop trigger if exists audit_matter on matter;
create trigger audit_matter after insert or update or delete on matter
  for each row execute function audit_row();

drop trigger if exists audit_checklist on matter_checklist_item;
create trigger audit_checklist after insert or update or delete on matter_checklist_item
  for each row execute function audit_row();

drop trigger if exists audit_activity on activity;
create trigger audit_activity after insert or update or delete on activity
  for each row execute function audit_row();

-- Append-only, enforced. A REVOKE alone would not restrain a table owner.
create or replace function audit_immutable()
returns trigger language plpgsql as $$
begin raise exception 'audit_event is append-only'; end $$;

drop trigger if exists audit_no_rowmod on audit_event;
create trigger audit_no_rowmod before update or delete on audit_event
  for each row execute function audit_immutable();

drop trigger if exists audit_no_truncate on audit_event;
create trigger audit_no_truncate before truncate on audit_event
  for each statement execute function audit_immutable();

-- ---------------------------------------------------------------------
-- Keep last_activity_at honest, so "Cases Needing Attention" works.
--
-- The prototype bumped this on any keystroke and never on a note, which
-- made the staleness panel decorative.
-- ---------------------------------------------------------------------
-- Attached to INSERT / UPDATE only, never DELETE, so NEW is always
-- assigned and can be read directly. Both audited tables carry
-- matter_id, and activity.matter_id is nullable, hence the guard.
create or replace function touch_matter_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.matter_id is not null then
    update matter set last_activity_at = now() where id = new.matter_id;
  end if;
  return null;
end $$;

drop trigger if exists touch_on_activity on activity;
create trigger touch_on_activity after insert on activity
  for each row execute function touch_matter_activity();

drop trigger if exists touch_on_checklist on matter_checklist_item;
create trigger touch_on_checklist after insert or update on matter_checklist_item
  for each row execute function touch_matter_activity();

-- =====================================================================
-- ROW LEVEL SECURITY
--
-- With the browser client talking straight to Postgres, RLS IS the
-- authorization layer. The anon key is public by design, so an
-- unprotected table is a public table.
--
-- The firm has no per-matter access control — everyone already sees
-- every matter via the shared spreadsheet — so each policy is one line:
-- `authenticated` can do everything, `anon` can do nothing. A blanket
-- policy has no gaps to find, which is exactly why this is safe here
-- and would not be safe with per-row rules.
--
-- TRIPWIRE: the moment per-matter access control is needed, move writes
-- behind server routes instead of extending these policies.
-- =====================================================================

alter table profile               enable row level security;
alter table matter                enable row level security;
alter table matter_checklist_item enable row level security;
alter table activity              enable row level security;
alter table matter_section_data   enable row level security;
alter table matter_section_row    enable row level security;
alter table case_number_counter   enable row level security;
alter table audit_event           enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'matter', 'matter_checklist_item', 'activity',
    'matter_section_data', 'matter_section_row'
  ] loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Profiles: everyone signed in can read the directory (needed for
-- @mentions and assignment), but only your own row is writable.
drop policy if exists profile_read on profile;
create policy profile_read on profile
  for select to authenticated using (true);

drop policy if exists profile_self_write on profile;
create policy profile_self_write on profile
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Audit: readable, never writable from the client. Only the SECURITY
-- DEFINER trigger inserts.
drop policy if exists audit_read on audit_event;
create policy audit_read on audit_event
  for select to authenticated using (true);

-- The counter is touched only through allocate_case_number().
drop policy if exists counter_read on case_number_counter;
create policy counter_read on case_number_counter
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- New auth users get a profile automatically.
-- ---------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profile (id, handle, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'handle', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
