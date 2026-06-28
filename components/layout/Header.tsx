'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

interface HeaderUser {
  email: string;
  company: {
    name: string;
    plan: string;
  };
}

export default function Header({ user }: { user: HeaderUser }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/signin');
    router.refresh();
  };

  return (
    <header className="flex items-center justify-between border-b border-line bg-surf px-6 py-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-white">
          {user.company.name}
        </span>
        {user.company.plan === 'trial' && (
          <span className="rounded-full border border-[#3b6ef0]/40 bg-[#3b6ef0]/10 px-2 py-0.5 text-xs font-medium text-[#3b6ef0]">
            Trial
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-t4">{user.email}</span>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-t4 transition-colors hover:border-[#3b6ef0] hover:text-white disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
