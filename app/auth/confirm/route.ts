import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { finalizeSignIn, safeRelativePath } from '@/utils/dara/auth-finalize';

// Token-hash landing for email links (invite / signup confirmation / email change /
// magic link / password recovery). Unlike the PKCE /auth/callback, verifyOtp works for
// admin-generated invite links (no browser-side code verifier needed) and the link points
// straight at this route, so it does not depend on the Supabase redirect allow-list.
//
// GET is side-effect-free by design: it never calls verifyOtp. Email security scanners
// (Outlook Safe Links, corporate mail gateways, antivirus link-prefetchers) fetch links in
// an email before the recipient ever opens it — production logs showed a bare HEAD request
// hitting this route (Next.js auto-derives HEAD from a GET handler), which silently
// consumed the single-use Supabase token before the real click, so the user landed on
// /signin with "link expired". Consuming the token now only happens on POST, which the
// confirm page below triggers via JS on load — real browsers run it, plain HEAD/GET
// prefetchers do not.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = url.searchParams.get('next') ?? url.searchParams.get('redirect_to') ?? '';

  if (!token_hash || !type) {
    return NextResponse.redirect(`${url.origin}/signin?error=auth_link_invalid`);
  }

  return new NextResponse(confirmPageHtml({ token_hash, type, next }), {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const token_hash = form.get('token_hash');
  const type = form.get('type');
  const next = safeRelativePath(form.get('next')?.toString());
  const origin = new URL(request.url).origin;

  if (typeof token_hash === 'string' && token_hash && typeof type === 'string' && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash
    });
    if (!error) {
      const dest = await finalizeSignIn(supabase, origin, next);
      return NextResponse.redirect(dest, { status: 303 });
    }
    console.error('[auth/confirm] verifyOtp failed:', error.message);
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_link_invalid`, { status: 303 });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function confirmPageHtml(fields: { token_hash: string; type: string; next: string }): string {
  const { token_hash, type, next } = fields;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Confirming — DARA</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f0f4ff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .card { max-width:420px; width:100%; margin:16px; background:#fff; border:1px solid #c7d4e8;
    border-radius:12px; padding:32px; text-align:center; }
  h1 { margin:0 0 8px; font-size:18px; color:#0f172a; }
  p { margin:0 0 20px; font-size:14px; line-height:1.5; color:#64748b; }
  button { font:inherit; font-weight:600; font-size:14px; color:#fff; background:#1b2a4a;
    border:1px solid #1b2a4a; border-radius:8px; padding:12px 28px; cursor:pointer; }
  button:hover { background:#16223c; }
</style>
</head>
<body>
  <div class="card">
    <h1>Confirming your request&hellip;</h1>
    <p>This finishes signing you in to DARA. Click continue if you are not redirected automatically.</p>
    <form method="POST" action="/auth/confirm">
      <input type="hidden" name="token_hash" value="${escapeHtml(token_hash)}" />
      <input type="hidden" name="type" value="${escapeHtml(type)}" />
      <input type="hidden" name="next" value="${escapeHtml(next)}" />
      <button type="submit">Continue</button>
    </form>
  </div>
  <script>document.forms[0].submit();</script>
</body>
</html>`;
}
