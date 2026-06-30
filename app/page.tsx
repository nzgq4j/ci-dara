import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { resolvePlatformAdmin } from '@/utils/dara/platform';

export default async function HomePage({
  searchParams
}: {
  searchParams: { code?: string; error?: string; redirect_to?: string };
}) {
  // Safety net: some Supabase redirect-URL configs bounce the OAuth/magic-link
  // code to the Site URL root (/) instead of /auth/callback. Forward it so the
  // session exchange still runs (the PKCE verifier cookie is same-domain).
  if (searchParams.code) {
    const params = new URLSearchParams({ code: searchParams.code });
    if (searchParams.redirect_to) params.set('redirect_to', searchParams.redirect_to);
    redirect(`/auth/callback?${params.toString()}`);
  }
  if (searchParams.error) {
    redirect('/signin?error=auth_callback_failed');
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    // Application admins have no company — send them to the admin console. This is
    // also the loop terminator: company pages redirect a no-tenant admin to /signin,
    // which bounces here, which lands them on /app/admin.
    const admin = await resolvePlatformAdmin(user.email);
    redirect(admin ? '/app/admin' : '/app/dashboard');
  }

  redirect('/signin');
}
