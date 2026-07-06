import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { finalizeSignIn, safeRelativePath } from '@/utils/dara/auth-finalize';

// PKCE code-exchange landing for OAuth / magic-link sign-ins (they carry a ?code=).
// Invite / signup-confirmation links use the token_hash flow at /auth/confirm instead.
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;
  const redirectTo = safeRelativePath(requestUrl.searchParams.get('redirect_to'));

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const dest = await finalizeSignIn(supabase, origin, redirectTo);
      return NextResponse.redirect(dest);
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_callback_failed`);
}
