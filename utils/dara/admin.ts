import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

// DARA-010: platform (super) admins are configured ONLY via the
// PLATFORM_ADMIN_EMAILS env var (comma-separated). No source-embedded fallback —
// if the var is unset there are zero platform admins (fail-closed), and a warning
// is logged. Admin actions are audited (DARA-013) and email verification is
// enforced by Supabase sign-in.
export function platformAdminEmails(): string[] {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) {
    console.warn(
      '[admin] PLATFORM_ADMIN_EMAILS is unset — no platform admins are configured.'
    );
  }
  return list;
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().includes(email.toLowerCase());
}

/** Server-side guard: returns the user's email or redirects non-admins away. */
export async function requirePlatformAdmin(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  if (!isPlatformAdmin(user.email)) redirect('/app/dashboard');
  return user.email!;
}
