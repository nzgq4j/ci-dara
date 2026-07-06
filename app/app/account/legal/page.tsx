import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import PageHeader from '@/components/dara/PageHeader';
import LegalCenter from './LegalCenter';

// Personal legal center — any authenticated user can review + download the Terms of Service
// and Supplemental Policy Addendum, and see / record their acceptance.
export const dynamic = 'force-dynamic';

export default async function LegalPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const acceptedAt = daraUser.tosAcceptedAt
    ? new Date(daraUser.tosAcceptedAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl fade">
      <PageHeader
        eyebrow="Account"
        title="Legal &amp; agreements"
        subtitle="Review, download, and manage your acceptance of our terms."
      />
      <LegalCenter
        acceptedVersion={daraUser.tosAcceptedVersion}
        acceptedAt={acceptedAt}
        signedName={daraUser.tosSignedName}
        prefillName={daraUser.name}
      />
    </div>
  );
}
