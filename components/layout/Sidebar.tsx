'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Users,
  UsersRound,
  Building2,
  Settings,
  ShieldCheck,
  LogOut,
  type LucideIcon
} from 'lucide-react';
import { SignOut } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';

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
  user: { name: string; email: string; role: string; avatarUrl?: string | null };
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
      // Organization renders only when the viewer can access something in it
      // (empty sections are filtered out below). Company + Team are company-admin only.
      label: 'Organization',
      items: [
        ...(user.role === 'company_admin'
          ? [
              { href: '/app/company', label: 'Company', icon: Building2 },
              { href: '/app/team', label: 'Team', icon: UsersRound }
            ]
          : [])
      ]
    },
    {
      label: 'Account',
      items: [
        { href: '/app/settings', label: 'Settings', icon: Settings },
        ...(isAdmin
          ? [{ href: '/app/admin', label: 'Admin', icon: ShieldCheck }]
          : [])
      ]
    }
  ].filter((section) => section.items.length > 0);

  const initials = (user.name || user.email || '?').slice(0, 2).toUpperCase();
  const planLabel = PLAN_LABELS[company.plan] ?? company.plan;

  return (
    <aside className="flex h-full w-[220px] flex-shrink-0 flex-col overflow-hidden border-r border-navy/20 bg-navy">
      {/* Logo + company */}
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dara-logo.png"
          alt="DARA"
          className="h-8 w-8 flex-shrink-0 object-contain"
        />
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight tracking-tight text-white">
            DARA
          </div>
          <div className="truncate text-[11px] text-white/60">{company.name}</div>
        </div>
      </div>

      {/* Plan */}
      <div className="border-b border-white/10 px-4 py-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-gold">
          {planLabel} plan
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-2 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
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
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:bg-white/10 hover:text-white'
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
      <div className="flex items-center gap-2.5 border-t border-white/10 px-3.5 py-3">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className="h-[30px] w-[30px] flex-shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-navy">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white/90">
            {user.name || user.email}
          </div>
          <div className="text-[10px] text-white/50">{titleCase(user.role)}</div>
        </div>
        <form onSubmit={(e) => handleRequest(e, SignOut, router)}>
          <input type="hidden" name="pathName" value={pathname} />
          <button
            type="submit"
            title="Sign out"
            className="text-white/40 transition-colors hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}
