import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { provisionNewUser } from '@/utils/dara/provision';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;
  const redirectTo = requestUrl.searchParams.get('redirect_to')?.toString();

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

      if (redirectTo) {
        return NextResponse.redirect(`${origin}${redirectTo}`);
      }

      return NextResponse.redirect(`${origin}/app/dashboard`);
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_callback_failed`);
}