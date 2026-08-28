/**
 * Service-role client. SERVER ONLY.
 *
 * This key bypasses RLS entirely — it is the database owner. It exists for
 * exactly one caller: the inbound-email webhook, which has no user session
 * because the request comes from a mail provider, not a browser.
 *
 * Three rules, all of which have been got wrong by someone before:
 *
 *   1. The variable is `SUPABASE_SERVICE_ROLE_KEY`, with no NEXT_PUBLIC_
 *      prefix. A NEXT_PUBLIC_ variable is inlined into the browser bundle at
 *      build time, and prefixing this one would publish full database access
 *      to every visitor.
 *   2. Never import this from a Client Component. The `server-only` guard
 *      below turns that mistake into a build error instead of a breach.
 *   3. No session persistence — there is no user here, and a persisted session
 *      on a shared server process leaks between requests.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { normalizeSupabaseUrl } from './url';

export function getServiceClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
