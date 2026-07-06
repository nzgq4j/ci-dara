import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TEAM_ROLES = ['company_admin', 'dept_admin', 'manager', 'reviewer'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

// Default invitation lifetime.
export const INVITE_TTL_DAYS = 14;

// Lazy service-role client for auth admin operations (sending invite emails).
// Service-role only — server-side. Constructed on first use so `next build`'s
// page-data collection doesn't evaluate it with empty env (mirrors utils/supabase/admin.ts).
let _authAdmin: SupabaseClient | null = null;
function authAdmin(): SupabaseClient {
  if (!_authAdmin) {
    _authAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _authAdmin;
}

/**
 * Send a Supabase invite email. The recipient clicks the link, authenticates, and
 * lands on /auth/callback, where provisionNewUser() matches the pending invitation
 * row and attaches them to the company/team.
 *
 * Never throws into the caller: the invitation row is the source of truth for
 * joining, so a failed email send still lets the person join by signing in. Returns
 * a soft result the UI can surface.
 *
 * NOTE: invite emails reach prod recipients only once the Supabase Auth Site URL /
 * redirect allow-list is configured (BUILD_STATUS §4 #1); until then the link may
 * point at localhost.
 */
export async function sendInvitationEmail(
  email: string
): Promise<{ ok: boolean; error?: string }> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  try {
    const { error } = await authAdmin().auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/confirm?type=invite`,
    });
    if (error) {
      // Surface the real reason server-side (Vercel logs). Common causes: the built-in
      // email rate limit (a handful/hour), an already-registered address, or missing SMTP.
      console.error('[teams] inviteUserByEmail failed:', error.status, error.code, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('[teams] inviteUserByEmail threw:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'invite email failed' };
  }
}
