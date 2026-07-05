'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Poll the current route (RSC refresh) on an interval while `active` — but ONLY while the tab is
// visible. A backgrounded workspace tab was calling router.refresh() every few seconds forever,
// each call re-running the heavy /app/solicitations/[id] query; several pollers at once starved
// the DB pool and tripped 300s function timeouts (plus the "client already executing a query"
// pg warning). Pausing on hidden — with one immediate catch-up refresh on return — keeps live
// progress visible without the storm. `active` already gates polling to a running job.
//
// Trailing catch-up: when a job finishes, `active` flips true→false. The refresh that observes
// completion reads the job's status and the rows it produced on SEPARATE pooled connections
// (see the solicitation page's Promise.all), so the status can read `done` an instant before the
// just-committed rows are visible to the other connection's snapshot — leaving the panel empty.
// If we simply stopped polling there, those rows would never appear until a manual reload (the
// reconcile "proposed changes don't show until I refresh" bug). So on the true→false edge we fire
// a couple of delayed refreshes to pick up rows that lagged the completion flag.
export function usePollRefresh(active: boolean, intervalMs = 3000) {
  const router = useRouter();
  const wasActive = useRef(false);

  useEffect(() => {
    if (active) {
      wasActive.current = true;

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
    }

    // active === false. Only act on the true→false completion edge, not the initial idle mount.
    if (!wasActive.current) return;
    wasActive.current = false;
    // Two catch-up refreshes to cover the commit-visibility skew described above.
    const t1 = setTimeout(() => router.refresh(), 1200);
    const t2 = setTimeout(() => router.refresh(), 3500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [active, intervalMs, router]);
}
