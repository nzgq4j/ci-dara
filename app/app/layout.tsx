import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { isPlatformAdmin } from '@/utils/dara/admin';
import Sidebar from '@/components/layout/Sidebar';

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

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  return (
    <div className="flex h-screen overflow-hidden bg-[#070c16] text-[#e8eef7]">
      <Sidebar
        isAdmin={isPlatformAdmin(user.email)}
        company={{ name: daraUser.company.name, plan: daraUser.company.plan }}
        user={{
          name: daraUser.name,
          email: daraUser.email,
          role: daraUser.role
        }}
      />
      <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
    </div>
  );
}
