'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Users,
  UsersRound,
  Settings,
  ShieldCheck,
  ShieldAlert,
  CreditCard,
  LogOut,
  type LucideIcon
} from 'lucide-react';
import { SignOut } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';
import ThemeToggle from '@/components/layout/ThemeToggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}
interface Section {
  label: string;
  items: NavItem[];
}

function titleCase(s: string) {
  return s
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Base',
  pro: 'Pro',
  enterprise: 'Enterprise'
};

export default function Sidebar({
  isAdmin = false,
  company,
  user
}: {
  isAdmin?: boolean;
  company: { name: string; plan: string };
  user: { name: string; email: string; role: string };
}) {
  const pathname = usePathname() || '';
  const router = useRouter();

  const sections: Section[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/app/solicitations', label: 'Solicitations', icon: FileText }
      ]
    },
    {
      label: 'Analysis',
      items: [{ href: '/app/personas', label: 'Personas', icon: Users }]
    },
    {
      label: 'Account',
      items: [
        { href: '/app/billing', label: 'Billing', icon: CreditCard },
        ...(user.role === 'company_admin'
          ? [{ href: '/app/team', label: 'Team', icon: UsersRound }]
          : []),
        { href: '/app/settings', label: 'Settings', icon: Settings },
        ...(isAdmin
          ? [{ href: '/app/admin', label: 'Admin', icon: ShieldCheck }]
          : []),
        { href: '/app/security', label: 'Security', icon: ShieldAlert }
      ]
    }
  ];

  const initials = (user.name || user.email || '?').slice(0, 2).toUpperCase();
  const planLabel = PLAN_LABELS[company.plan] ?? company.plan;

  return (
    <aside className="flex h-full w-[220px] flex-shrink-0 flex-col overflow-hidden border-r border-line bg-surf3">
      {/* Logo + company */}
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
          <div className="truncate text-[11px] text-t4">{company.name}</div>
        </div>
      </div>

      {/* Plan */}
      <div className="border-b border-line px-4 py-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#3b6ef0]">
          {planLabel} plan
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-2 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-t5">
              {section.label}
            </div>
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-[#3b6ef0]/15 text-t1'
                      : 'text-t4 hover:bg-surf2 hover:text-t1'
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-3">
        <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1d4ed8] to-[#7c3aed] text-xs font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-t2">
            {user.name || user.email}
          </div>
          <div className="text-[10px] text-t5">{titleCase(user.role)}</div>
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
