'use client';

import { useRouter, usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { SignOut } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';

interface HeaderUser {
  email: string;
  company: {
    name: string;
    plan: string;
  };
}

export default function Header({ user }: { user: HeaderUser }) {
  const router = useRouter();
  const pathname = usePathname() || '/';

  return (
    <header className="flex items-center justify-between border-b border-line bg-surf px-6 py-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-t1">{user.company.name}</span>
        {user.company.plan === 'trial' && (
          <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
            Trial
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-t4">{user.email}</span>
        <form onSubmit={(e) => handleRequest(e, SignOut, router)}>
          <input type="hidden" name="pathName" value={pathname} />
          <button
            type="submit"
            className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-t4 transition-colors hover:border-navy hover:text-t1"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
