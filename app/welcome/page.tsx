import { redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { btnPrimary, card } from '@/components/dara/theme';
import { completeWelcome } from './actions';

// One-screen welcome for users who joined an existing (already-onboarded) company
// via invitation. Reached from the layout gate when the user's own onboardedAt is
// unset but their company is already set up.
export default async function WelcomePage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  if (daraUser.onboardedAt) redirect('/app/dashboard');

  const meta = (user.user_metadata ?? {}) as Record<string, any>;
  // Prefer the uploaded avatar; fall back to an OAuth provider picture.
  const avatarUrl: string | null =
    daraUser.avatarUrl || meta.avatar_url || meta.picture || null;
  const firstName =
    (daraUser.name || meta.full_name || meta.name || daraUser.email || 'there')
      .toString()
      .split(' ')[0] || 'there';
  const initials = (daraUser.name || daraUser.email || '?')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-t1">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/dara-logo.png" alt="DARA" className="h-8 w-8 object-contain" />
          <span className="text-sm font-bold tracking-tight text-t1">DARA</span>
        </div>

        <div className={`${card} p-8 text-center`}>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-navy to-gold text-lg font-bold text-white">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-t1">
            Welcome to DARA, {firstName}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-t4">
            You&apos;ve joined{' '}
            <span className="font-semibold text-t2">{daraUser.company.name}</span>.
            Jump into the dashboard to see solicitations shared with your team and
            start reviewing.
          </p>

          <form action={completeWelcome} className="mt-7 flex justify-center">
            <button type="submit" className={btnPrimary}>
              Go to dashboard
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
