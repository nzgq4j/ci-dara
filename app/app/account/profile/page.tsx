import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import PageHeader from '@/components/dara/PageHeader';
import ProfilePanel from './ProfilePanel';
import PasswordPanel from './PasswordPanel';
import SignInMethodsPanel from './SignInMethodsPanel';

// Self-service account profile: display name + avatar, password, and linked sign-in
// methods. The Reset Password email lands here (see supabase/templates/recovery.html).
export const dynamic = 'force-dynamic';

export default async function AccountProfilePage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const { data: identityData } = await supabase.auth.getUserIdentities();
  const identities = (identityData?.identities ?? []).map((i) => ({
    identityId: i.identity_id ?? i.id,
    provider: i.provider,
    email: (i.identity_data?.email as string | undefined) ?? null
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 fade">
      <PageHeader
        eyebrow="Account"
        title="Profile & sign-in"
        subtitle="Manage your name, avatar, password, and how you sign in to DARA."
      />
      <ProfilePanel
        name={daraUser.name}
        email={daraUser.email}
        avatarUrl={daraUser.avatarUrl}
      />
      <PasswordPanel />
      <SignInMethodsPanel identities={identities} />
    </div>
  );
}
