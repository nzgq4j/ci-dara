import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import {
  provisionNewUser,
  touchLastLogin,
  EmailVerificationRequiredError
} from '@/utils/dara/provision';
import { recordAudit } from '@/utils/dara/audit';

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
        try {
          const daraUser = await provisionNewUser(
            user.id,
            user.email ?? '',
            user.user_metadata?.full_name ?? user.email ?? '',
            // OAuth / magic-link prove email ownership; Supabase sets
            // email_confirmed_at on success. Fall back to that flag.
            Boolean(user.email_confirmed_at)
          );
          await touchLastLogin(daraUser.id);
          // Audit every successful OAuth / magic-link sign-in (NIST AU; DARA-013).
          await recordAudit({
            action: 'user.signin',
            companyId: daraUser.companyId,
            actorId: daraUser.id,
            actorEmail: daraUser.email,
            entityType: 'user',
            entityId: daraUser.id,
            metadata: { provider: user.app_metadata?.provider ?? 'oauth' }
          });
        } catch (e) {
          if (e instanceof EmailVerificationRequiredError) {
            // Pending invite for an unverified address — don't attach. Drop the
            // half-authenticated session and ask them to verify first.
            await supabase.auth.signOut();
            return NextResponse.redirect(`${origin}/signin?error=verify_email`);
          }
          throw e;
        }
      }

      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_callback_failed`);
}