-- ---------------------------------------------------------------------
-- 007 — take EXECUTE away from PUBLIC on the SECURITY DEFINER functions
--
-- Postgres grants EXECUTE on a new function to PUBLIC automatically. The
-- `grant execute ... to authenticated` in schema.sql ADDS a grant; it does
-- not remove that default. So both functions below were callable by the
-- anon role -- i.e. by anyone holding the publishable key, which ships in
-- the browser by design.
--
-- Verified against the live project before writing this: an anon POST to
-- /rest/v1/rpc/allocate_case_number returned 200 and a fresh number.
--
-- Why it matters, given both are SECURITY DEFINER so RLS does not apply:
--
--   allocate_case_number()      Each call burns the next number. Repeated
--                               calls walk the counter to its 999 ceiling,
--                               after which real case creation fails the
--                               check constraint. The returned number also
--                               discloses how many cases the firm has
--                               opened this year.
--
--   reseed_case_number_counter() Reads every matter row past RLS. It only
--                               ever raises the counter (greatest()), so it
--                               cannot cause a collision -- but it is still
--                               an unauthenticated read of case data.
--
-- The trigger functions (audit_row, touch_matter_activity, handle_new_user)
-- return type `trigger`, which PostgREST does not expose, so they are not
-- reachable this way and are left alone.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

revoke execute on function allocate_case_number(char) from public;
grant  execute on function allocate_case_number(char) to authenticated;

revoke execute on function reseed_case_number_counter() from public;
grant  execute on function reseed_case_number_counter() to authenticated;
