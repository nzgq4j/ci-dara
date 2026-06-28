import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { provisionNewUser } from '@/utils/dara/provision';

// DARA-018: only allow same-origin, single-slash-rooted relative paths as the
// post-login destination. Reject absolute URLs, protocol-relative `//host`, and
// backslash tricks — anything else falls back to the dashboard.
function safeRelativePath(value: string | null | undefined): string {
  const fallback = '/app/dashboard';
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  return value;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;
  const redirectTo = safeRelativePath(requestUrl.searchParams.get('redirect_to'));

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        await provisionNewUser(
          user.id,
          user.email ?? '',
          user.user_metadata?.full_name ?? user.email ?? ''
        );
      }

      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_callback_failed`);
}