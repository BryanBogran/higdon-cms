-- ---------------------------------------------------------------------
-- 022 — help requests become tickets
--
-- 013 made the help button file a report and email it. That was where it
-- ended: no status, no way to ask the reporter a question inside the app,
-- and a reporter found out their problem was fixed by noticing it one
-- morning.
--
-- This gives every report a status (open → in progress → waiting on you →
-- resolved), a thread both sides can reply in, and a per-person "seen"
-- stamp that drives the badge on the help button.
--
-- It EXTENDS bug_report rather than replacing it, so every report already
-- filed becomes a ticket with its history intact.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- ── ⚠️ First: nobody may promote themselves to admin ────────────────
--
-- Only the admin can change a ticket's status, and "admin" is
-- profile.role = 'admin'. But `profile_self_write` (schema.sql) lets every
-- signed-in user update their own profile row -- EVERY column. So until
-- now anyone could run
--
--   update profile set role = 'admin' where id = auth.uid();
--
-- from the browser console. Harmless while nothing read `role` for
-- permissions; this migration makes it the first thing that does, so the
-- hole would become real the moment it shipped.
--
-- A column-level REVOKE alone does nothing while a table-level grant
-- exists, so the table grant goes and only the harmless columns come back.
-- The app never writes profile from the client (checked: every
-- `from('profile')` is a read), so nothing breaks. Roles are changed in the
-- SQL editor, as the owner, which these grants do not restrict.
revoke update on profile from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke update on profile from anon';
  end if;
end $$;
grant update (display_name, handle) on profile to authenticated;

-- ── Is the caller the admin? ────────────────────────────────────────
create or replace function is_help_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile
     where id = auth.uid() and role = 'admin' and is_active
  )
$$;
-- The same two revokes every function here gets: PUBLIC and anon are
-- separate ACL entries. See supabase/007_function_grants.sql.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function is_help_admin() from anon';
  end if;
end $$;
revoke execute on function is_help_admin() from public;
grant execute on function is_help_admin() to authenticated;

-- ── The ticket ──────────────────────────────────────────────────────
alter table bug_report add column if not exists status text not null default 'open';
alter table bug_report add column if not exists last_activity_at timestamptz not null default now();
alter table bug_report add column if not exists last_activity_by uuid references profile(id) on delete set null;

do $$ begin
  alter table bug_report add constraint bug_report_status
    check (status in ('open', 'in_progress', 'waiting', 'resolved'));
exception when duplicate_object then null; end $$;

-- Existing reports. Without this every old ticket would claim activity
-- "now", by nobody, and light up everyone's badge at once.
update bug_report
   set status = 'resolved'
 where resolved_at is not null and status = 'open';

update bug_report
   set last_activity_at = coalesce(resolved_at, created_at),
       last_activity_by = reported_by
 where last_activity_by is null;

create index if not exists bug_report_by_activity on bug_report (last_activity_at desc);

-- ── The thread ──────────────────────────────────────────────────────
--
-- A status change is a row here too (kind = 'status'), so the ticket reads
-- as a timeline -- "marked this In progress" -- rather than a status that
-- changed with no trace of when. Append-only: no update or delete policy.
create table if not exists bug_report_reply (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references bug_report(id) on delete cascade,
  author_id    uuid references profile(id) on delete set null,
  -- Snapshot, for the same reason activity.author_label exists: a reply
  -- must still say who wrote it after the profile is gone.
  author_label text,
  kind         text not null default 'reply' check (kind in ('reply', 'status')),
  status       text check (status is null or status in ('open', 'in_progress', 'waiting', 'resolved')),
  body         text check (body is null or length(body) <= 5000),
  created_at   timestamptz not null default now()
);

create index if not exists bug_report_reply_by_report on bug_report_reply (report_id, created_at);

-- ── Who has looked at what ──────────────────────────────────────────
--
-- Separate from bug_report so a reporter never needs update rights on the
-- ticket itself just to say "I've read this".
create table if not exists bug_report_seen (
  report_id uuid not null references bug_report(id) on delete cascade,
  user_id   uuid not null references profile(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (report_id, user_id)
);

-- ── A reply moves the ticket ────────────────────────────────────────
--
-- Security definer because the person replying is usually the reporter,
-- who may not update bug_report -- and should not be able to.
--
-- ⚠️ A REPORTER REPLYING TO A RESOLVED TICKET REOPENS IT. "It's still
-- broken" on a green ticket would otherwise sit in the admin's resolved
-- pile where nobody looks. The reopening is written into the thread, so
-- the green does not just vanish without explanation.
create or replace function bug_report_reply_touch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status   text;
  v_reporter uuid;
begin
  select status, reported_by into v_status, v_reporter
    from bug_report where id = new.report_id;

  update bug_report
     set last_activity_at = new.created_at,
         last_activity_by = new.author_id
   where id = new.report_id;

  if new.kind = 'reply' and v_status = 'resolved' and new.author_id = v_reporter then
    update bug_report
       set status = 'open', resolved_at = null
     where id = new.report_id;
    insert into bug_report_reply (report_id, author_id, author_label, kind, status, body)
    values (new.report_id, new.author_id, new.author_label, 'status', 'open',
            'Reopened by a reply after it was resolved.');
  end if;

  return null;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function bug_report_reply_touch() from anon';
  end if;
end $$;
revoke execute on function bug_report_reply_touch() from public;

drop trigger if exists bug_report_reply_touch on bug_report_reply;
create trigger bug_report_reply_touch
  after insert on bug_report_reply
  for each row execute function bug_report_reply_touch();

-- ── Stamping "the email went out" ───────────────────────────────────
--
-- /api/report sets emailed_at after sending, AS THE REPORTER. Updates on
-- bug_report become admin-only below, so that write would start failing
-- silently. This does the one thing it needs and nothing else.
create or replace function stamp_report_emailed(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update bug_report set emailed_at = now()
   where id = p_id and emailed_at is null
$$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function stamp_report_emailed(uuid) from anon';
  end if;
end $$;
revoke execute on function stamp_report_emailed(uuid) from public;
grant execute on function stamp_report_emailed(uuid) to authenticated;

-- ── Access ──────────────────────────────────────────────────────────
--
-- Everyone at the firm sees every ticket -- decided, so people can see
-- what is already reported rather than filing it twice, and matching the
-- rest of the app. What differs is who may WRITE what.
alter table bug_report_reply enable row level security;
alter table bug_report_seen  enable row level security;

drop policy if exists staff_all on bug_report;

drop policy if exists ticket_read on bug_report;
create policy ticket_read on bug_report
  for select to authenticated using (true);

-- Only as yourself. A client-supplied reported_by would let anybody file
-- as anybody.
drop policy if exists ticket_file on bug_report;
create policy ticket_file on bug_report
  for insert to authenticated with check (reported_by = auth.uid());

drop policy if exists ticket_admin_update on bug_report;
create policy ticket_admin_update on bug_report
  for update to authenticated using (is_help_admin()) with check (is_help_admin());

drop policy if exists reply_read on bug_report_reply;
create policy reply_read on bug_report_reply
  for select to authenticated using (true);

-- Anybody may reply, as themselves. Only the admin may write a status row.
drop policy if exists reply_write on bug_report_reply;
create policy reply_write on bug_report_reply
  for insert to authenticated
  with check (author_id = auth.uid() and (kind = 'reply' or is_help_admin()));

drop policy if exists seen_own on bug_report_seen;
create policy seen_own on bug_report_seen
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Verification. Every row should read true.
-- ---------------------------------------------------------------------
select 'nobody can grant themselves a role' as check,
       not has_column_privilege('authenticated', 'profile', 'role', 'UPDATE') as ok
union all
select 'display names can still be edited',
       has_column_privilege('authenticated', 'profile', 'display_name', 'UPDATE')
union all
select 'bug_report has its three policies',
       (select count(*) from pg_policies where tablename = 'bug_report') = 3
union all
select 'the thread table exists',
       exists (select 1 from information_schema.tables where table_name = 'bug_report_reply')
union all
select 'the seen table exists',
       exists (select 1 from information_schema.tables where table_name = 'bug_report_seen')
union all
-- False until you run the one-line update in the note below. Nothing can
-- change a ticket's status until it is true.
select 'an admin is set',
       exists (select 1 from profile where role = 'admin' and is_active);

-- To make yourself the admin (as the owner, in this editor):
--   update profile set role = 'admin' where email = 'you@example.com';

-- Where the existing reports landed.
select status, count(*) from bug_report group by status order by status;
