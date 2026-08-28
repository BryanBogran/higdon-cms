/**
 * Server Supabase client, for Server Components and Route Handlers.
 *
 * Use getClaims() rather than getSession() in server code: it validates the
 * JWT signature against the project's published keys on every call, where
 * getSession() trusts whatever is in the cookie.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { normalizeSupabaseUrl } from './url';

/**
 * Is there a Supabase project to talk to at all?
 *
 * Route handlers must check this BEFORE building a client. `createServerClient`
 * with an undefined URL throws, and an unexplained 500 is a much worse answer
 * than "the database is not configured" -- particularly on a fresh deploy where
 * a missing environment variable is the single likeliest cause.
 */
export function isServerSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot write cookies.
            // The middleware refreshes the session instead -- this is the
            // documented, expected no-op.
          }
        },
      },
    }
  );
}

/** The signed-in user, verified. Null when signed out. */
export async function getCurrentUser() {
  if (!isServerSupabaseConfigured()) return null;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return { id: data.claims.sub, email: data.claims.email };
}
