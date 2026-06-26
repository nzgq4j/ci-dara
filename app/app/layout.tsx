import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  return (
    <div className="flex h-screen bg-[#070c16] text-slate-200">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header user={daraUser} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}