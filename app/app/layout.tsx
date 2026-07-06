import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { findDaraUserRaw } from '@/utils/dara/provision';
import { resolvePlatformAdmin } from '@/utils/dara/platform';
import Sidebar from '@/components/layout/Sidebar';
import PlatformAdminSidebar from '@/components/layout/PlatformAdminSidebar';
import AccountDisabled from '@/components/layout/AccountDisabled';

export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin');

  // Application admins: company-less operator shell, no CUI surface.
  const admin = await resolvePlatformAdmin(user.email);
  if (admin) {
    return (
      <div className="flex h-screen overflow-hidden bg-bg text-t1">
        <PlatformAdminSidebar
          admin={{ name: admin.name, email: admin.email }}
        />
        <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
      </div>
    );
  }

  // Use the raw lookup here (not getDaraUser, which is fail-closed on !isActive) so a
  // deactivated user still reaches the terminal AccountDisabled screen below instead of a
  // bare signin redirect. Every other caller resolves via the fail-closed getDaraUser.
  const daraUser = await findDaraUserRaw(user.id);
  if (!daraUser) redirect('/signin');

  // Banned/deactivated by a platform admin — terminal screen (no redirect loop).
  if (!daraUser.isActive) {
    return <AccountDisabled email={daraUser.email} />;
  }

  // Onboarding gate. A brand-new org creator (un-onboarded company, company_admin)
  // runs the full setup wizard; any other un-onboarded user (an invited member
  // joining an already-set-up company) gets the one-screen welcome. Existing
  // accounts were backfilled as onboarded, so neither fires for them.
  if (!daraUser.company.onboardedAt && daraUser.role === 'company_admin') {
    redirect('/onboarding');
  }
  if (!daraUser.onboardedAt) redirect('/welcome');

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-t1">
      <Sidebar
        isAdmin={false}
        company={{ name: daraUser.company.name, plan: daraUser.company.plan }}
        user={{
          name: daraUser.name,
          email: daraUser.email,
          role: daraUser.role,
          avatarUrl: daraUser.avatarUrl
        }}
      />
      <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
    </div>
  );
}
