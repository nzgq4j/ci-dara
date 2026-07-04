'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Poll the current route (RSC refresh) on an interval while `active` — but ONLY while the tab is
// visible. A backgrounded workspace tab was calling router.refresh() every few seconds forever,
// each call re-running the heavy /app/solicitations/[id] query; several pollers at once starved
// the DB pool and tripped 300s function timeouts (plus the "client already executing a query"
// pg warning). Pausing on hidden — with one immediate catch-up refresh on return — keeps live
// progress visible without the storm. `active` already gates polling to a running job.
export function usePollRefresh(active: boolean, intervalMs = 3000) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer == null) timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        router.refresh(); // catch up immediately, then resume the interval
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [active, intervalMs, router]);
}
