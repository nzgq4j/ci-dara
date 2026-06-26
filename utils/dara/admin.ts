import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

// Platform (super) admins are identified by an email allow-list. Configure via
// PLATFORM_ADMIN_EMAILS (comma-separated); falls back to the built-in list.
const DEFAULT_ADMINS = ['islanista@gmail.com', 'david@crucibleinsight.com'];

export function platformAdminEmails(): string[] {
  const fromEnv = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ADMINS;
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
