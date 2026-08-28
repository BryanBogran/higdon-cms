/**
 * Shared by the browser, server, and middleware clients, so it lives outside
 * client.js -- that file carries 'use client', and importing it from server
 * code muddies the boundary for what is a pure string function.
 *
 * The Supabase dashboard shows several URLs, and it is easy to copy the REST
 * endpoint (`https://xxx.supabase.co/rest/v1/`) instead of the Project URL.
 * The client appends `/rest/v1/...` itself, so that mistake yields
 * `PGRST125: Invalid path specified in request URL` on every query -- an error
 * that points nowhere near its cause. Normalize rather than trust the paste.
 */
export function normalizeSupabaseUrl(raw) {
  if (!raw) return raw;
  return raw
    .trim()
    .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?$/, '')
    .replace(/\/+$/, '');
}
