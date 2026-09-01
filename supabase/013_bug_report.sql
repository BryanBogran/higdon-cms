-- ---------------------------------------------------------------------
-- 013 — "something is wrong with this" reports
--
-- A button in the app collects what went wrong and emails it. The table
-- exists because THE EMAIL IS THE SECOND STEP, NOT THE FIRST.
--
-- A report that only becomes an email is lost when the mail send fails,
-- and a mail send is the part most likely to fail: an unset variable, a
-- revoked scope, a quota. The person who reported it has already moved
-- on and believes it was received. So the row is written first and
-- always; `emailed_at` records whether the notification also went out,
-- and a null there is a thing to look at rather than a lost report.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

create table if not exists bug_report (
  id             uuid primary key default gen_random_uuid(),

  reported_by    uuid references profile(id) on delete set null,
  -- Snapshot, so a report still says who sent it after the profile is
  -- gone. Same reason activity.author_label exists.
  reporter_label text,

  summary        text not null,
  detail         text,
  -- Not an enum: the useful values will change once people start filing
  -- these, and a new enum member needs a migration where a new string
  -- does not. The check keeps it honest without freezing it.
  severity       text not null default 'normal'
                 check (severity in ('blocking', 'normal', 'minor')),

  /*
   * Context, captured by the app rather than typed.
   *
   * "It doesn't work" is what people write, and it is not their job to
   * write anything better. The page they were on, who they were, and what
   * the browser had already thrown are worth more than any description,
   * and cost the reporter nothing.
   */
  page           text,
  user_agent     text,
  viewport       text,
  console_errors jsonb not null default '[]'::jsonb,

  emailed_at     timestamptz,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists bug_report_open
  on bug_report (created_at desc) where resolved_at is null;

-- ---------------------------------------------------------------------
-- Access
--
-- Anyone signed in can file one and read them, which matches how every
-- other table here works. Deliberately NOT anonymous: an unauthenticated
-- insert endpoint on a public URL is a spam target, and the report is
-- worth less without knowing who sent it.
-- ---------------------------------------------------------------------
alter table bug_report enable row level security;

do $$ begin
  create policy staff_all on bug_report
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- No audit trigger. A bug report is not case data, it is never edited,
-- and auditing it would only duplicate the row.

-- ---------------------------------------------------------------------
-- Confirmation
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name = 'bug_report') as table_present,
  (select count(*) from pg_policies where tablename = 'bug_report')                as policies;
