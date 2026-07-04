'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckSquare, Loader2 } from 'lucide-react';
import { usePollRefresh } from '@/components/dara/usePollRefresh';

// Runs the compliance sweep in the BACKGROUND worker (async JobQueue) instead of a long
// synchronous request. Enqueues the job, then polls while it runs — showing REAL progress
// (graded / total from the DB) rather than a simulated bar that stalls. The sweep grades
// only not-yet-assessed rows, so it resumes cleanly across worker ticks.
export default function ComplianceCheckControl({
  solId,
  total,
  graded,
  active,
  action,
  className
}: {
  solId: string;
  total: number;
  graded: number;
  active: boolean;
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // While a check is running, refresh so graded/total climbs live and we notice completion.
  usePollRefresh(active);

  const run = () => {
    setError(null);
    const fd = new FormData();
    fd.set('solId', solId);
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok) setError(res.error ?? 'Could not start the compliance check.');
      router.refresh();
    });
  };

  const pct = total > 0 ? Math.round((graded / total) * 100) : 0;
  const remaining = Math.max(0, total - graded);
  const busy = active || pending;
  const label = active
    ? 'Checking compliance…'
    : graded > 0 && remaining > 0
      ? 'Continue compliance check'
      : 'Run compliance check';

  return (
    <div className="space-y-2">
      <button type="button" onClick={run} disabled={busy} className={className}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckSquare className="h-4 w-4" />}
        {label}
      </button>

      {active && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-t4">
            <span>Grading pass/fail requirements against your proposal…</span>
            <span className="font-mono text-t5">{graded} / {total} · {pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-navy transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[#92400E]/25 bg-[#FEF3C7] px-3 py-2 text-[12px] leading-relaxed text-[#92400E]">
          {error}
        </div>
      )}
    </div>
  );
}
