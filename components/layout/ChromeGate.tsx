'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// The marketing Navbar/Footer should not wrap the authenticated app shell, the
// full-screen auth / account-setup flows (sign-in, the 2FA challenge, the org
// onboarding wizard, the invited-member welcome), or the standalone public
// Security/Legal pages (linked from the sign-in footer as plain informational
// pages, not marketing pages). Everywhere else keeps the chrome.
const BARE_PREFIXES = ['/app', '/signin', '/auth', '/onboarding', '/welcome', '/legal', '/security'];

export default function ChromeGate({
  navbar,
  footer,
  children
}: {
  navbar: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname() || '';
  const bare = BARE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (bare) return <>{children}</>;

  return (
    <>
      {navbar}
      <main
        id="skip"
        className="min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-5rem)]"
      >
        {children}
      </main>
      {footer}
    </>
  );
}
