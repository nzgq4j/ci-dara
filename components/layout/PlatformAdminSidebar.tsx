'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldCheck, Building2, Users, Cpu, SlidersHorizontal, LogOut, type LucideIcon } from 'lucide-react';
import { SignOut } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';
import ThemeToggle from '@/components/layout/ThemeToggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  hash?: string;
}

// Application Admin console nav. Company-less by design — no Workspace / CUI links.
const ITEMS: NavItem[] = [
  { href: '/app/admin', label: 'Platform AI', icon: Cpu, hash: '#ai' },
  { href: '/app/admin', label: 'Gating', icon: SlidersHorizontal, hash: '#gating' },
  { href: '/app/admin', label: 'Accounts', icon: Building2, hash: '' },
  { href: '/app/admin', label: 'Users', icon: Users, hash: '#users' },
  { href: '/app/admin', label: 'Administrators', icon: ShieldCheck, hash: '#admins' }
];

export default function PlatformAdminSidebar({
  admin
}: {
  admin: { name: string; email: string };
}) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const initials = (admin.name || admin.email || '?').slice(0, 2).toUpperCase();

  return (
    <aside className="flex h-full w-[220px] flex-shrink-0 flex-col overflow-hidden border-r border-line bg-surf3">
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dara-logo.png"
          alt="DARA"
          className="h-8 w-8 flex-shrink-0 object-contain"
        />
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight tracking-tight text-t1">
            DARA
          </div>
          <div className="truncate text-[11px] text-t4">Application Admin</div>
        </div>
      </div>

      {/* Platform badge */}
      <div className="border-b border-line px-4 py-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#3b6ef0]">
          Platform console
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        <div className="px-2 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-t5">
          Administration
        </div>
        {ITEMS.map(({ href, label, icon: Icon, hash }) => (
          <Link
            key={label}
            href={`${href}${hash ?? ''}`}
            className="mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-t4 transition-colors hover:bg-surf2 hover:text-t1"
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            {label}
          </Link>
        ))}
        <div className="mt-4 rounded-md border border-line bg-surf px-2.5 py-2 text-[11px] leading-relaxed text-t5">
          This account has no access to company CUI (solicitations, documents,
          evaluations).
        </div>
      </nav>

      {/* User */}
      <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-3">
        <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5a1f1f] to-[#7c3aed] text-xs font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-t2">
            {admin.name || admin.email}
          </div>
          <div className="text-[10px] text-t5">Application admin</div>
        </div>
        <ThemeToggle />
        <form onSubmit={(e) => handleRequest(e, SignOut, router)}>
          <input type="hidden" name="pathName" value={pathname} />
          <button
            type="submit"
            title="Sign out"
            className="text-t5 transition-colors hover:text-t1"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}
