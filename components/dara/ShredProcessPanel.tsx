'use client';

// Observable shred: a button that starts a v2 run, and a live process log beneath it. While a run is
// active the panel polls the run-log (dara_shred_runs) every ~1.5s and streams each step — a spinner
// on the running step, a check when done, a cross on failure, plus the count it produced and how long
// it took. When the run finishes the matrix data is refreshed and the log stays as a saved record.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';

export type ShredRunView = {
  status: string;
  currentStep: string;
  steps: { step: string; status: 'running' | 'done' | 'failed'; detail?: string; count?: number; ms?: number; at: string }[];
  counts: Record<string, number>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

function fmtMs(ms?: number): string {
  if (ms == null) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function ShredProcessPanel({
  solId,
  initialRun,
  runAction,
  pollAction,
  buttonClass
}: {
  solId: string;
  initialRun: ShredRunView | null;
  runAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  pollAction: (fd: FormData) => Promise<ShredRunView | null>;
  buttonClass?: string;
}) {
  const router = useRouter();
  const [run, setRun] = useState<ShredRunView | null>(initialRun);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const active = pending || run?.status === 'running';

  // Poll the run-log while a run is active. Runs concurrently with the (fast) enqueue action.
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      const fd = new FormData();
      fd.set('solId', solId);
      const latest = await pollAction(fd).catch(() => null);
      if (stopped || !latest) return;
      setRun(latest);
      if (latest.status !== 'running') router.refresh(); // matrix just changed — pull fresh page data
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, solId, pollAction, router]);

  const runNow = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('solId', solId);
      const res = await runAction(fd);
      if (!res.ok) setError(res.error ?? 'Could not start the shred.');
    });
  };

  const statusChip =
    run?.status === 'complete'
      ? 'bg-[#DCFCE7] text-[#166534]'
      : run?.status === 'failed'
        ? 'bg-[#FEE2E2] text-[#991B1B]'
        : 'bg-[#FEF3C7] text-[#92400E]';

  const counts = run?.counts ?? {};
  const countBits = [
    counts.factors != null ? `${counts.factors} factors` : null,
    counts.requirements != null ? `${counts.requirements} requirements` : null,
    counts.flagged ? `${counts.flagged} flagged` : null
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <button type="button" onClick={runNow} disabled={active} className={buttonClass}>
        {active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {active ? 'Shredding — watch the log…' : 'Run shred (v2, live)'}
      </button>

      {error && (
        <div className="rounded-lg border border-[#92400E]/25 bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">{error}</div>
      )}

      {run && run.steps.length > 0 && (
        <div className="rounded-lg border border-line bg-bg">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5 text-t4" /> : <ChevronRight className="h-3.5 w-3.5 text-t4" />}
            <span className="text-[12px] font-semibold text-t2">Progress</span>
            <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${statusChip}`}>{run.status}</span>
            {countBits.length > 0 && <span className="ml-1 truncate text-[11px] text-t5">{countBits.join(' · ')}</span>}
          </button>
          {open && (
            <ol className="border-t border-line">
              {run.steps.map((st, i) => (
                <li key={i} className="flex items-start gap-2 border-b border-line/60 px-3 py-1.5 last:border-b-0">
                  <span className="mt-0.5 flex-shrink-0">
                    {st.status === 'running' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-navy" />
                    ) : st.status === 'failed' ? (
                      <XCircle className="h-3.5 w-3.5 text-[#991B1B]" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#166534]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[12px] text-t2">{st.step}</span>
                    {st.detail && <span className="ml-1.5 text-[11px] text-t5">— {st.detail}</span>}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[10px] text-t5">
                    {st.count != null ? `${st.count} ` : ''}{fmtMs(st.ms)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {run.error && (
            <div className="border-t border-line px-3 py-2 text-[11px] leading-snug text-[#991B1B]">{run.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
