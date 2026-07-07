import Link from 'next/link';

// Lightweight branded header + footer for the PUBLIC pages that live outside the app
// shell (/security, /legal). These routes are bared of the marketing chrome by
// ChromeGate, so without this they render as an unbranded slab. This gives them the
// DARA / Crucible Insight wordmark, a way back home, and a consistent footer — matching
// the sign-in brand treatment (dara-logo.png + gold Crucible Insight eyebrow).
export default function PublicChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surf3">
      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/dara-logo.png" alt="DARA" className="h-9 w-9 object-contain" />
            <div>
              <div className="text-[15px] font-bold leading-none tracking-tight text-t1">DARA</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-gold">
                Crucible Insight
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-4 text-[13px] font-medium text-t4 sm:gap-5">
            <Link href="/security" className="hidden transition-colors hover:text-t1 sm:inline">
              Security
            </Link>
            <Link href="/legal" className="hidden transition-colors hover:text-t1 sm:inline">
              Legal
            </Link>
            <Link
              href="/signin"
              className="rounded-lg bg-navy px-4 py-2 text-white transition-colors hover:bg-navy/90"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-bg">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-[11px] text-t5 sm:flex-row">
          <span>© 2026 The Daniel Group LLC · All rights reserved</span>
          <div className="flex items-center gap-3">
            <Link href="/security" className="transition-colors hover:text-t3 hover:underline">
              Security
            </Link>
            <span className="text-t5/50">·</span>
            <Link href="/legal" className="transition-colors hover:text-t3 hover:underline">
              Terms &amp; Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
