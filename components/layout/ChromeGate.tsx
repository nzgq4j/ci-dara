'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// The marketing Navbar/Footer should not wrap the authenticated app shell or the
// sign-in screen — those render full-screen. Everywhere else keeps the chrome.
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
  const bare = pathname.startsWith('/app') || pathname.startsWith('/signin');

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
