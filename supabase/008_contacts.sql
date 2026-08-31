-- ---------------------------------------------------------------------
-- 008 — contacts, so a client is a record rather than three text columns
--
-- Today a matter carries client_name, client_phone and client_email as
-- free text. "Rivera, Marcus" on two matters is two unrelated strings: fix
-- a phone number on one and the other keeps the old one, and there is no
-- way to ask "what else is this person on".
--
-- This adds the entity and LINKS it. It does not remove the old columns --
-- see the note at the bottom.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

create extension if not exists citext;

do $$ begin
  create type contact_kind as enum ('person', 'company');
exception when duplicate_object then null; end $$;

create table if not exists contact (
  id            uuid primary key default gen_random_uuid(),
  kind          contact_kind not null default 'person',

  -- Name. Stored in parts because a firm addresses letters, sorts by
  -- surname, and greets by first name -- one `full_name` column cannot do
  -- all three without guessing where the surname starts.
  first_name    text,
  middle_name   text,
  last_name     text,
  prefix        text,
  suffix        text,
  nickname      text,
  company_name  text,          -- the name itself when kind = 'company'

  department    text,
  job_title     text,

  -- Repeating groups. Filevine lets a contact carry several of each with a
  -- per-entry label, and a person genuinely does have a mobile and a work
  -- number. jsonb rather than three child tables: they are only ever read
  -- and written whole, with this contact.
  --   phones:    [{ label, value, extension, note }]
  --   emails:    [{ label, value, note }]
  --   addresses: [{ label, line1, line2, city, state, postal, country, note }]
  phones        jsonb not null default '[]'::jsonb,
  emails        jsonb not null default '[]'::jsonb,
  addresses     jsonb not null default '[]'::jsonb,

  -- Details
  salutation      text,        -- "Dear Ms Rivera,"
  primary_language text,
  date_of_birth   date,
  deceased        boolean not null default false,
  can_text        boolean not null default false,
  can_remarket    boolean not null default false,
  is_minor        boolean not null default false,
  gender          text,
  marital_status  text,
  driver_license  text,
  fiduciary       text,
  notes           text,
  client_entity_id text,       -- the firm's own reference, if it keeps one

  /*
   * ⚠️ Social Security Number.
   *
   * A PI firm needs it: Medicare Secondary Payer reporting and most lien
   * resolution ask for it. So it is here rather than pretending otherwise.
   *
   * Three things follow, and none of them are automatic:
   *   - it is redacted from the audit log below, so the append-only history
   *     does not become a second copy of every SSN;
   *   - every signed-in user can read it, because RLS in this app is
   *     all-authenticated. That matches how the firm works today and is a
   *     decision worth revisiting before headcount grows;
   *   - Supabase encrypts at rest, which protects the disk and not a
   *     compromised session.
   */
  ssn           text,

  tags          text[] not null default '{}',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- A contact must be findable by something.
  constraint contact_has_a_name check (
    coalesce(first_name, '') <> '' or coalesce(last_name, '') <> ''
       or coalesce(company_name, '') <> ''
  )
);

-- Surname-first, which is how the firm reads a list of clients.
create index if not exists contact_sort
  on contact (lower(coalesce(last_name, company_name)), lower(coalesce(first_name, '')))
  where deleted_at is null;

-- Type-ahead search runs over this.
create index if not exists contact_search
  on contact using gin (
    to_tsvector('simple',
      coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(company_name,''))
  );

-- ---------------------------------------------------------------------
-- The link
--
-- Nullable, and the old text columns stay. Every existing matter has a
-- client_name and no contact, and a NOT NULL here would mean either
-- inventing a contact for each of them in this migration or refusing to
-- run. Backfilling is a decision for when the firm has looked at its own
-- duplicates, not something a schema change should do quietly.
--
-- ON DELETE SET NULL: removing a contact must never remove a case.
-- ---------------------------------------------------------------------
alter table matter add column if not exists client_contact_id uuid
  references contact(id) on delete set null;

create index if not exists matter_by_contact
  on matter (client_contact_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------
alter table contact enable row level security;

do $$ begin
  create policy staff_all on contact
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Audit
--
-- audit_redact gains ssn and date_of_birth. Without this the audit table
-- keeps a full copy of both on every edit, which turns an append-only
-- history into the most sensitive table in the database.
-- ---------------------------------------------------------------------
create or replace function audit_redact(payload jsonb)
returns jsonb language sql immutable as $$
  select case when payload is null then null else (
    select jsonb_object_agg(
      key,
      case
        when key in ('doc_url', 'ssn', 'date_of_birth')
          then to_jsonb(case when value = 'null'::jsonb then null else 'set' end)
        else value
      end
    )
    from jsonb_each(payload)
  ) end
$$;

-- CREATE OR REPLACE above keeps the function's existing ACL, so replacing
-- the body does NOT re-grant anything -- but it does not fix a stale grant
-- either. Repeated here so this file leaves no anon-callable function
-- behind on its own. See supabase/009_audit_redact_grant.sql.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function audit_redact(jsonb) from anon';
  end if;
end $$;
revoke execute on function audit_redact(jsonb) from public;
grant execute on function audit_redact(jsonb) to authenticated;

do $$ begin
  create trigger audit_contact after insert or update or delete on contact
    for each row execute function audit_row();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Confirmation
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name = 'contact') as contact_table,
  (select count(*) from information_schema.columns
    where table_name = 'matter' and column_name = 'client_contact_id') as matter_link,
  (select audit_redact('{"ssn":"111-22-3333","client_name":"Rivera"}'::jsonb)) as redaction_check;
