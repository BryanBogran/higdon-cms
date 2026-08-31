-- ---------------------------------------------------------------------
-- 007 — stop the anon role calling the SECURITY DEFINER functions
--
-- Verified against the live project: an anonymous POST to
-- /rest/v1/rpc/allocate_case_number returned 200 and a fresh case number.
--
-- Why it matters, given both are SECURITY DEFINER so RLS does not apply:
--
--   allocate_case_number()       Each call burns the next number. Repeated
--                                calls walk the counter to its 999 ceiling,
--                                after which real case creation fails the
--                                check constraint. The returned value also
--                                discloses how many cases the firm has
--                                opened this year.
--
--   reseed_case_number_counter() Reads every matter row past RLS. It only
--                                raises the counter (greatest()), so it
--                                cannot cause a collision -- but it is an
--                                unauthenticated read of case data.
--
-- ── TWO separate grants have to go, which is what the first version of
--    this migration got wrong ──────────────────────────────────────────
--
--   1. Postgres grants EXECUTE on every new function to PUBLIC. A later
--      `grant execute ... to authenticated` ADDS to that; it does not
--      replace it.
--
--   2. Supabase ALSO ships default privileges for the public schema that
--      grant EXECUTE on new functions directly to `anon`. That grant is
--      its own entry in the ACL, so revoking PUBLIC leaves it standing and
--      anon keeps working. The first version of this file revoked only
--      PUBLIC, and the check still reported the function as reachable.
--
-- So revoke from both, explicitly.
--
-- `authenticated` keeps EXECUTE, which is what the app uses: createMatter
-- calls allocate_case_number from the browser as a signed-in user. Nothing
-- in the app calls either function while signed out.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

do $$
begin
  -- Guarded so this also runs on a plain Postgres, where the Supabase roles
  -- do not exist.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function allocate_case_number(char) from anon';
    execute 'revoke execute on function reseed_case_number_counter() from anon';
  end if;
end $$;

revoke execute on function allocate_case_number(char) from public;
revoke execute on function reseed_case_number_counter() from public;

grant execute on function allocate_case_number(char) to authenticated;
grant execute on function reseed_case_number_counter() to authenticated;

-- ---------------------------------------------------------------------
-- Confirmation. Read this output -- it is the point of running the file.
--
-- Each row should list `authenticated=X/postgres` and the owner, and must
-- NOT contain `anon=X` or a bare `=X/` entry (the bare form is PUBLIC).
-- ---------------------------------------------------------------------
select
  p.proname                                            as function,
  coalesce(array_to_string(p.proacl, E'\n'),
           'DEFAULT — PUBLIC can execute')             as grants,
  (p.proacl::text like '%anon=X%')                     as anon_can_execute,
  (p.proacl::text like '%,=X/%' or p.proacl is null)   as public_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('allocate_case_number', 'reseed_case_number_counter')
order by p.proname;
