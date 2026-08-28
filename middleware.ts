import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: Request) {
  // @ts-expect-error NextRequest is structurally compatible here
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Auth routes are
     * allowed through inside updateSession, not excluded here, so the
     * session still refreshes on them.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
