/**
 * Server Supabase client, for Server Components and Route Handlers.
 *
 * Use getClaims() rather than getSession() in server code: it validates the
 * JWT signature against the project's published keys on every call, where
 * getSession() trusts whatever is in the cookie.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
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
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return { id: data.claims.sub, email: data.claims.email };
}
