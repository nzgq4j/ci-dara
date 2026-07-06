import type { SupabaseClient } from '@supabase/supabase-js';
import {
  provisionNewUser,
  touchLastLogin,
  EmailVerificationRequiredError
} from '@/utils/dara/provision';
import {
  resolvePlatformAdmin,
  recordPlatformAdminLogin
} from '@/utils/dara/platform';
import { recordAudit } from '@/utils/dara/audit';

// Shared post-authentication handling for the email-link routes: /auth/callback (PKCE
// code exchange, used by OAuth / magic-link) and /auth/confirm (token_hash verifyOtp, used
// by invite / signup-confirmation links). Given an authenticated Supabase session, it
// routes platform admins to the console, otherwise provisions the DARA user (matching a
// pending invitation and attaching them to that company/team), audits the sign-in, and
// returns the absolute URL to redirect to. `nextPath` is the already-validated relative
// landing path; the /app layout gate takes over from there (onboarding / welcome / app).
export async function finalizeSignIn(
  supabase: SupabaseClient,
  origin: string,
  nextPath: string
): Promise<string> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return `${origin}${nextPath}`;

  const provider = (user.app_metadata?.provider as string) ?? 'email';

  // Application admins are company-less operators — never provision a tenant for them.
  const admin = await resolvePlatformAdmin(user.email);
  if (admin) {
    await recordPlatformAdminLogin(user.email ?? '', user.id);
    await recordAudit({
      action: 'platform.signin',
      actorId: user.id,
      actorEmail: admin.email,
      entityType: 'platform_admin',
      entityId: admin.id,
      metadata: { provider }
    });
    return `${origin}/app/admin`;
  }

  try {
    const daraUser = await provisionNewUser(
      user.id,
      user.email ?? '',
      user.user_metadata?.full_name ?? user.email ?? '',
      // OAuth / magic-link / email-verify all prove ownership; Supabase sets
      // email_confirmed_at on success.
      Boolean(user.email_confirmed_at)
    );
    await touchLastLogin(daraUser.id);
    await recordAudit({
      action: 'user.signin',
      companyId: daraUser.companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'user',
      entityId: daraUser.id,
      metadata: { provider }
    });
  } catch (e) {
    if (e instanceof EmailVerificationRequiredError) {
      // Pending invite for an unverified address — drop the half-authenticated session.
      await supabase.auth.signOut();
      return `${origin}/signin?error=verify_email`;
    }
    throw e;
  }

  return `${origin}${nextPath}`;
}

// DARA-018: only allow same-origin, single-slash-rooted relative paths as the post-login
// destination. Rejects absolute URLs, protocol-relative //host, and backslash tricks.
export function safeRelativePath(value: string | null | undefined): string {
  const fallback = '/app/dashboard';
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  return value;
}
