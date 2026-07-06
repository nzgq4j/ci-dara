import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import PageHeader from '@/components/dara/PageHeader';
import TwoFactorPanel from './TwoFactorPanel';

// DARA-031 — personal account security. Any authenticated user can opt in to TOTP 2FA
// here. The TOTP factor lives in Supabase Auth; this page only reads its status.
export const dynamic = 'force-dynamic';

export default async function AccountSecurityPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const enabled = (factors?.totp ?? []).some((f) => f.status === 'verified');
  const backupRemaining = daraUser.mfaBackupCodes?.length ?? 0;

  return (
    <div className="mx-auto max-w-2xl fade">
      <PageHeader
        eyebrow="Account"
        title="Two-Factor Authentication"
        subtitle="Protect access to CUI with a time-based one-time code from an authenticator app."
      />
      <TwoFactorPanel
        enabled={enabled}
        backupRemaining={backupRemaining}
      />
    </div>
  );
}
