import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';
import { createClient } from '@/utils/supabase/server';
import { isPlatformAdmin } from '@/utils/dara/admin';
import { MFA_COOKIE, isValidMfaMarker } from '@/utils/dara/mfa-cookie';
import { PW_RESET_COOKIE } from '@/utils/dara/pw-reset';

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

  // DARA-046: a pending password reset must be completed before any /app (CUI) access.
  // The recovery link sets this marker at /auth/confirm and updatePassword() clears it;
  // until then, route every /app request to the set-password screen so the forced reset
  // can't be skipped by navigating straight into the app. The set-password screen lives at
  // /signin/update_password (outside /app), so there is no redirect loop.
  if (
    request.nextUrl.pathname.startsWith('/app') &&
    request.cookies.get(PW_RESET_COOKIE)?.value
  ) {
    return NextResponse.redirect(new URL('/signin/update_password', request.url));
  }

  if (request.nextUrl.pathname.startsWith('/app')) {
    const supabase = createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (!user) {
      // A transient auth rate-limit (429, over_request_rate_limit) or upstream 5xx must NOT
      // sign the user out. The session cookie is a signed JWT that updateSession() just
      // refreshed; getUser only failed to reach the auth server this instant. Rapid progress
      // polling on the workspace page was tripping Supabase's auth rate limit and bouncing the
      // user to /signin. Only redirect on a genuine missing/invalid session.
      const st = error?.status ?? 0;
      if (st === 429 || st >= 500) {
        return response;
      }
      return NextResponse.redirect(new URL('/signin', request.url));
    }

    // DARA-031: AAL2 gate. If the user has a verified TOTP factor but this session is
    // still AAL1, force the 2FA challenge before any /app (CUI) route. A valid single-use
    // backup recovery marker (set server-side after a backup-code challenge) also
    // satisfies the gate. The challenge page lives at /auth/2fa-challenge (outside /app),
    // so there is no redirect loop.
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      const marker = request.cookies.get(MFA_COOKIE)?.value;
      if (!(await isValidMfaMarker(user.id, marker))) {
        return NextResponse.redirect(
          new URL('/auth/2fa-challenge', request.url)
        );
      }
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