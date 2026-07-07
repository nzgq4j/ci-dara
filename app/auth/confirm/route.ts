import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { finalizeSignIn, safeRelativePath } from '@/utils/dara/auth-finalize';
import { PW_RESET_COOKIE, PW_RESET_MAX_AGE } from '@/utils/dara/pw-reset';

// Token-hash landing for email links (invite / signup confirmation / email change / password
// recovery). verifyOtp works for admin-generated + implicit-flow links (no browser-side code
// verifier needed) and the link points straight here, so it does not depend on the redirect
// allow-list.
//
// IMPORTANT (DARA-046): the OTP token is SINGLE-USE, and corporate email security scanners
// (Outlook Safe Links, Microsoft Defender, etc.) pre-fetch every link — with HEAD or GET —
// before the user ever clicks. If we verify on that automated request we consume the token,
// so the user's real click then fails with "Email link is invalid or has expired" (confirmed
// in prod logs: a scanner HEAD burned the token seconds before the user's GET). To defeat
// this, GET/HEAD only render an interstitial page; the actual verifyOtp runs on the POST that
// a human triggers by clicking "Continue". Scanners don't submit forms, so they can't burn it.

export const dynamic = 'force-dynamic';

const HEADINGS: Record<string, { title: string; blurb: string; cta: string }> = {
  recovery: {
    title: 'Reset your password',
    blurb: 'Click continue to verify this link and set a new password.',
    cta: 'Continue'
  },
  signup: {
    title: 'Confirm your email',
    blurb: 'Click continue to verify your email and finish setting up your account.',
    cta: 'Confirm email'
  },
  email: {
    title: 'Confirm your email',
    blurb: 'Click continue to verify your email and finish setting up your account.',
    cta: 'Confirm email'
  },
  invite: {
    title: 'Accept your invitation',
    blurb: 'Click continue to accept your invitation and join your team.',
    cta: 'Accept invitation'
  },
  email_change: {
    title: 'Confirm your email change',
    blurb: 'Click continue to confirm your new email address.',
    cta: 'Confirm change'
  },
  magiclink: {
    title: 'Sign in to DARA',
    blurb: 'Click continue to finish signing in.',
    cta: 'Continue'
  }
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

// Minimal, self-contained interstitial (no app CSS in a route handler) in the navy/gold brand.
function interstitial(token_hash: string, type: string, next: string): string {
  const h = HEADINGS[type] ?? { title: 'Continue', blurb: 'Click continue to verify this link.', cta: 'Continue' };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(h.title)} — DARA</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f4f6fa; color: #1b2a4a;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .card { width: 100%; max-width: 420px; margin: 24px; padding: 32px; background: #fff;
          border: 1px solid #e3e8f0; border-radius: 14px; box-shadow: 0 8px 30px rgba(27,42,74,0.08); }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
  .brand img { width: 40px; height: 40px; object-fit: contain; }
  .brand .name { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
  .brand .sub { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #b08a3e; margin-top: 2px; }
  h1 { font-size: 20px; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { font-size: 14px; line-height: 1.5; color: #55627a; margin: 0 0 24px; }
  button { width: 100%; padding: 12px 16px; font-size: 14px; font-weight: 600; color: #fff;
           background: #1b2a4a; border: 0; border-radius: 10px; cursor: pointer; }
  button:hover { background: #243660; }
  .foot { margin-top: 18px; font-size: 11px; color: #8a95a8; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="/dara-logo.png" alt="DARA" />
      <div>
        <div class="name">DARA</div>
        <div class="sub">Crucible Insight</div>
      </div>
    </div>
    <h1>${esc(h.title)}</h1>
    <p>${esc(h.blurb)}</p>
    <form method="POST" action="/auth/confirm">
      <input type="hidden" name="token_hash" value="${esc(token_hash)}" />
      <input type="hidden" name="type" value="${esc(type)}" />
      <input type="hidden" name="next" value="${esc(next)}" />
      <button type="submit">${esc(h.cta)}</button>
    </form>
    <div class="foot">For your security this link can only be used once.</div>
  </div>
</body>
</html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = safeRelativePath(url.searchParams.get('next') ?? url.searchParams.get('redirect_to'));

  if (!token_hash || !type) {
    return NextResponse.redirect(`${url.origin}/signin?error=auth_link_invalid`);
  }

  // Render the interstitial only — do NOT verify here (see the DARA-046 note above).
  return new Response(interstitial(token_hash, type, next), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const token_hash = String(form.get('token_hash') ?? '');
  const type = String(form.get('type') ?? '') as EmailOtpType;
  const next = safeRelativePath(String(form.get('next') ?? ''));

  if (token_hash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // DARA-046: a password RECOVERY must force the user to set a new password before
      // they can use the app. verifyOtp necessarily establishes a session (that session
      // is what authorizes updateUser({password})), so instead of dropping them into the
      // app we set a marker cookie — the middleware routes every /app request to the
      // set-password screen until updatePassword() clears it — and send them straight to
      // that screen, ignoring the email's `next`.
      if (type === 'recovery') {
        const res = NextResponse.redirect(`${origin}/signin/update_password`, { status: 303 });
        res.cookies.set(PW_RESET_COOKIE, '1', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: PW_RESET_MAX_AGE
        });
        return res;
      }
      const dest = await finalizeSignIn(supabase, origin, next);
      // 303 so the browser issues a GET to the destination after this POST.
      return NextResponse.redirect(dest, { status: 303 });
    }
    console.error('[auth/confirm] verifyOtp failed:', error.message);
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_link_invalid`, { status: 303 });
}
