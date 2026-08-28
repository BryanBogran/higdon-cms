import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { normalizeSupabaseUrl } from './url';

/**
 * Refresh the auth token and gate every route.
 *
 * Server Components cannot write cookies, so without this the session
 * silently expires and users get logged out mid-edit. Required, not optional.
 */

// The inbound-email webhook is called by a mail provider, which has no
// session and cannot follow a redirect to /login. It authenticates itself with
// a shared secret instead -- see app/api/inbound-email/route.js.
const PUBLIC_PATHS = ['/login', '/auth', '/api/inbound-email'];

export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Not configured yet -- the app runs on localStorage. Let everything through
  // so local development still works before the Supabase project exists.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: getClaims() must be called here, between creating the client
  // and returning the response, or sessions will not refresh.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!signedIn && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', path);
    return NextResponse.redirect(redirect);
  }

  if (signedIn && path === '/login') {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}
