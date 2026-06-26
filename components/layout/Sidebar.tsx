'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const baseNavItems: NavItem[] = [
  { href: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/solicitations', label: 'Solicitations', icon: FileText },
  { href: '/app/personas', label: 'Personas', icon: Users },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const navItems = isAdmin
    ? [...baseNavItems, { href: '/app/admin', label: 'Admin', icon: ShieldCheck }]
    : baseNavItems;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-[#1a2f4a] bg-[#0d1527]">
      <div className="border-b border-[#1a2f4a] px-6 py-5">
        <div className="text-xl font-semibold tracking-wide text-white">
          DARA
        </div>
        <div className="text-xs text-[#7d97b3]">by Crucible Insight</div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[#1a2f4a] text-white'
                  : 'text-[#7d97b3] hover:bg-[#1a2f4a]/50 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
