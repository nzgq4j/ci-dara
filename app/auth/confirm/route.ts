import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { finalizeSignIn, safeRelativePath } from '@/utils/dara/auth-finalize';

// Token-hash landing for email links (invite / signup confirmation / email change).
// Unlike the PKCE /auth/callback, verifyOtp works for admin-generated invite links (no
// browser-side code verifier needed) and the link points straight at this route, so it
// does not depend on the Supabase redirect allow-list. On success the session is
// established server-side and finalizeSignIn provisions + routes to onboarding.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = safeRelativePath(
    url.searchParams.get('next') ?? url.searchParams.get('redirect_to')
  );
  const origin = url.origin;

  if (token_hash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      const dest = await finalizeSignIn(supabase, origin, next);
      return NextResponse.redirect(dest);
    }
    console.error('[auth/confirm] verifyOtp failed:', error.message);
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_link_invalid`);
}
