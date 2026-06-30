import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';
import { createClient } from '@/utils/supabase/server';
import { isPlatformAdmin } from '@/utils/dara/admin';

export async function middleware(request: NextRequest) {
  // Forward a stray OAuth/magic-link `code` that landed on the root (Supabase's
  // Site-URL fallback when redirect_to isn't allow-listed) to the callback handler
  // so the session exchange still runs.
  if (
    request.nextUrl.pathname === '/' &&
    request.nextUrl.searchParams.has('code')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url);
  }

  const response = await updateSession(request);

  if (request.nextUrl.pathname.startsWith('/app')) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(new URL('/signin', request.url));
    }

    // Application admins are company-less: keep them inside the /app/admin console
    // and out of every company (CUI) route. Env-pinned admins are recognized here
    // synchronously; DB-only admins are kept in by the admin sidebar (no company
    // links) and the root redirect, so no per-request DB lookup is needed here.
    if (
      isPlatformAdmin(user.email) &&
      !request.nextUrl.pathname.startsWith('/app/admin')
    ) {
      return NextResponse.redirect(new URL('/app/admin', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};