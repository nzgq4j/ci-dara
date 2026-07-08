'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Sub-navigation for the Application Admin console. The console was split from one
// monolithic page into focused sub-pages; this tab bar ties them together.
const TABS = [
  { href: '/app/admin', label: 'Overview' },
  { href: '/app/admin/jobs', label: 'Background jobs' },
  { href: '/app/admin/ai', label: 'Platform AI' },
  { href: '/app/admin/usage', label: 'AI usage' }
];

export default function AdminNav() {
  const path = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {TABS.map((t) => {
        // Overview matches only itself; the others match their subtree.
        const active = t.href === '/app/admin' ? path === t.href : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors ${
              active
                ? 'border-t1 font-semibold text-t1'
                : 'border-transparent text-t4 hover:text-t2'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
