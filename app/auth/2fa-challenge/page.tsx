import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import TwoFactorChallenge from './TwoFactorChallenge';

// DARA-031 — login-time second factor. Reached when middleware finds a verified TOTP
// factor but an AAL1 session. Sits outside /app so the AAL2 gate can't loop it.
export const dynamic = 'force-dynamic';

export default async function TwoFactorChallengePage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Nothing to challenge — either no factor, or already elevated to AAL2.
  if (!aal || aal.nextLevel !== 'aal2' || aal.currentLevel === 'aal2') {
    redirect('/app/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <TwoFactorChallenge email={user.email ?? ''} />
    </div>
  );
}
