-- ---------------------------------------------------------------------
-- 009 — close the last anon-callable function
--
-- `audit_redact(jsonb)` is callable by `anon` today. Confirmed against the
-- live project with nothing but the publishable key, which ships in every
-- browser:
--
--   POST /rest/v1/rpc/audit_redact  {"payload":{"ssn":"111-22-3333"}}
--   200  {"ssn":"set"}
--
-- ── How bad is it, honestly ──────────────────────────────────────────
--
-- Not very. The function is IMMUTABLE and pure: it redacts a payload the
-- caller supplies and returns it. It reads no table, writes nothing, and
-- is not SECURITY DEFINER, so there is no data behind it to reach. This
-- is not the hole 007 closed -- `reseed_case_number_counter` was
-- SECURITY DEFINER and could rewrite the case-number counter.
--
-- It is still worth removing. It is attack surface with no purpose: no
-- client calls it, only the audit trigger does, and triggers execute as
-- the table owner regardless of who can call the function by name. An
-- endpoint that exists for nobody is an endpoint that gets fuzzed.
--
-- ── Why it was missed ────────────────────────────────────────────────
--
-- 007 revoked the two functions that existed when it was written. This
-- one predates it in schema.sql and was never in that list, and 008
-- replaced the body without touching grants -- CREATE OR REPLACE keeps
-- the existing ACL, so the hole survived a migration that rewrote the
-- function. Anything added later needs the same two revokes; there is no
-- default that gets this right.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- TWO grants, for the reason spelled out at length in 007: Postgres grants
-- EXECUTE to PUBLIC on every new function, and Supabase's default
-- privileges for the public schema grant it to `anon` directly. Separate
-- ACL entries; revoking one leaves the other.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function audit_redact(jsonb) from anon';
  end if;
end $$;
revoke execute on function audit_redact(jsonb) from public;

-- The trigger does not need this grant -- `audit_row` runs as the table
-- owner -- but granting it to `authenticated` keeps the function usable
-- from a signed-in session if anything ever needs it, and matches how the
-- other two are set up.
grant execute on function audit_redact(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Confirmation
--
-- Expect: anon = false, authenticated = true.
-- ---------------------------------------------------------------------
select
  has_function_privilege('anon', 'audit_redact(jsonb)', 'execute')          as anon_can_execute,
  has_function_privilege('authenticated', 'audit_redact(jsonb)', 'execute') as authenticated_can_execute;
