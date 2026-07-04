'use client';

// Screen 3 — the unified Direct AI review view. Replaces the color-team pass accordion with
// ONE score summary + a flat, severity-filtered findings list. Three states:
//   A (not_started)  skeleton rows + "Run AI Review"
//   B (running)      unified progress bar (poll every 3s, same as ReviewPassPanel)
//   C (complete)     score summary + score card + filter row + flat findings table
// Reuses the exact finding-row markup / severity styling from ReviewPassPanel (the spec's
// "reuse the existing finding row component"). Colors map to the app's tokens (D5).

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Loader2, RotateCcw } from 'lucide-react';

type Severity = 'critical' | 'high' | 'medium' | 'low';
export type DirectFinding = {
  id: string;
  severity: Severity;
  text: string;
  requirementRef: string;
  recommendedAction: string;
};
type Filter = 'all' | Severity;

const SEV: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'CRITICAL', cls: 'bg-[#FEE2E2] text-[#991B1B]' },
  high: { label: 'HIGH', cls: 'bg-[#FFEDD5] text-[#C05621]' },
  medium: { label: 'MEDIUM', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  low: { label: 'LOW', cls: 'bg-navy/10 text-navy' }
};
const SEV_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

// Score bands per the spec (>=85 / 65-84 / <65), app token colors.
function scoreColor(s: number): string {
  if (s >= 85) return 'text-[#166534]';
  if (s >= 65) return 'text-[#92400E]';
  return 'text-[#991B1B]';
}
function scoreBar(s: number): string {
  if (s >= 85) return 'bg-[#166534]';
  if (s >= 65) return 'bg-[#92400E]';
  return 'bg-[#991B1B]';
}

export default function DirectReviewPanel({
  solId,
  solNumber,
  status,
  score,
  progress,
  progressLabel,
  errorMessage,
  runAtLabel,
  findings,
  runAction,
  canRun,
  disabledReason
}: {
  solId: string;
  solNumber: string;
  status: 'not_started' | 'running' | 'complete' | 'error';
  score: number | null;
  progress: number;
  progressLabel: string;
  errorMessage: string | null;
  runAtLabel: string | null;
  findings: DirectFinding[];
  runAction: (fd: FormData) => Promise<{ ok: boolean }>;
  canRun: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>('all');

  const active = status === 'running';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) c[f.severity]++;
    return c;
  }, [findings]);

  const sorted = useMemo(
    () => [...findings].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]),
    [findings]
  );
  const visible = filter === 'all' ? sorted : sorted.filter((f) => f.severity === filter);

  const run = () => {
    const fd = new FormData();
    fd.set('solId', solId);
    startTransition(async () => {
      await runAction(fd);
      router.refresh();
    });
  };

  const header = (
    <div className="flex items-center justify-between px-1">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-t3">
        AI Review · {solNumber || `SOL ${solId}`}
      </span>
      <StatusLabel status={status} />
    </div>
  );

  // ---- State A: not started ----
  if (status === 'not_started') {
    return (
      <div className="space-y-3">
        {header}
        <div className="overflow-hidden rounded-lg border border-line bg-surf">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
              <div className="h-4 w-16 animate-pulse rounded bg-line/60" />
              <div className="h-4 flex-1 animate-pulse rounded bg-line/40" />
              <div className="h-4 w-14 animate-pulse rounded bg-line/60" />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!canRun || pending}
          title={!canRun ? disabledReason : undefined}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run AI Review
        </button>
        {!canRun && disabledReason && (
          <p className="text-center text-[12px] text-t5">{disabledReason}</p>
        )}
      </div>
    );
  }

  // ---- State B: running ----
  if (status === 'running') {
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded-lg border border-navy/40 bg-navy/[0.04] px-4 py-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-t3">{progressLabel || 'Analyzing section-by-section coverage…'}</span>
            <span className="text-navy">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-line">
            <div
              className="h-full rounded bg-navy transition-all"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </div>
          <p className="mt-2.5 text-[12px] text-t5">
            Review runs in the background — you can close this tab and come back.
          </p>
        </div>
      </div>
    );
  }

  // ---- State C (complete) / error ----
  const s = score ?? 0;
  return (
    <div className="space-y-4">
      {header}

      {status === 'error' && (
        <div className="rounded-lg border border-[#991B1B]/25 bg-[#FEE2E2] px-3.5 py-2.5 text-[12px] text-[#991B1B]">
          {errorMessage || 'The review failed. Re-run it to try again.'}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Left summary (Screen 3 left panel) */}
        <div className="rounded-lg border border-line bg-surf p-4">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.07em] text-t5">
            AI Review Score
          </div>
          <div className={`mt-1 text-[28px] font-bold leading-none ${scoreColor(s)}`}>{s}</div>
          <div className="mt-2 h-[5px] overflow-hidden rounded-[3px] bg-line">
            <div className={`h-full rounded-[3px] ${scoreBar(s)}`} style={{ width: `${s}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-1.5">
            <Count label="Crit" n={counts.critical} cls="text-[#991B1B]" />
            <Count label="High" n={counts.high} cls="text-[#C05621]" />
            <Count label="Med" n={counts.medium} cls="text-[#92400E]" />
            <Count label="Low" n={counts.low} cls="text-navy" />
          </div>
        </div>

        {/* Main: score card + filter + findings */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-line bg-surf px-5 py-4">
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <span className={`text-[48px] font-bold leading-none ${scoreColor(s)}`}>{s}</span>
                <div className="mt-1 h-[4px] w-14 overflow-hidden rounded bg-line">
                  <div className={`h-full rounded ${scoreBar(s)}`} style={{ width: `${s}%` }} />
                </div>
                <span className="mt-0.5 text-[9px] text-t5">of 100</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 text-right">
              <span className="text-[13px] text-t4">{findings.length} findings total</span>
              {runAtLabel && <span className="text-[11px] text-t5">Last run: {runAtLabel}</span>}
              <button
                type="button"
                onClick={run}
                disabled={pending}
                className="no-print mt-1 inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-t3 transition-colors hover:text-t1 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Re-run Review
              </button>
            </div>
          </div>

          {/* Filter row */}
          <div className="no-print flex flex-wrap gap-1.5">
            <FilterBtn label="All" n={findings.length} active={filter === 'all'} onClick={() => setFilter('all')} />
            <FilterBtn label="Critical" n={counts.critical} active={filter === 'critical'} onClick={() => setFilter('critical')} />
            <FilterBtn label="High" n={counts.high} active={filter === 'high'} onClick={() => setFilter('high')} />
            <FilterBtn label="Medium" n={counts.medium} active={filter === 'medium'} onClick={() => setFilter('medium')} />
            <FilterBtn label="Low" n={counts.low} active={filter === 'low'} onClick={() => setFilter('low')} />
          </div>

          {/* Findings table */}
          {findings.length === 0 ? (
            <div className="rounded-lg border border-line bg-surf px-3.5 py-3 text-[12px] text-[#166534]">
              No findings — the proposal is clean against this solicitation.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-surf">
              <div className="grid grid-cols-[78px_minmax(0,1fr)_72px_minmax(0,1fr)] gap-2 border-b border-line bg-surf2 px-3.5 py-1.5 font-mono text-[9px] uppercase tracking-wide text-t5">
                <span>Severity</span>
                <span>Finding</span>
                <span>Ref</span>
                <span>Recommended action</span>
              </div>
              {visible.map((f) => (
                <div
                  key={f.id}
                  className="grid grid-cols-[78px_minmax(0,1fr)_72px_minmax(0,1fr)] items-start gap-2 border-b border-line px-3.5 py-2 last:border-b-0"
                >
                  <span className={`inline-block w-fit rounded px-1.5 py-0.5 text-[9px] font-bold ${SEV[f.severity].cls}`}>
                    {SEV[f.severity].label}
                  </span>
                  <span className="text-[11.5px] leading-snug text-t2">{f.text}</span>
                  <span className="font-mono text-[10px] text-t4">{f.requirementRef || '—'}</span>
                  <span className="text-[11px] leading-snug text-t4">{f.recommendedAction || '—'}</span>
                </div>
              ))}
              {visible.length === 0 && (
                <div className="px-3.5 py-3 text-[12px] text-t5">No {filter} findings.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Count({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <div className="rounded border border-line bg-bg px-1.5 py-1 text-center">
      <div className={`text-[15px] font-bold leading-none ${cls}`}>{n}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-t5">{label}</div>
    </div>
  );
}

function FilterBtn({ label, n, active, onClick }: { label: string; n: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[3px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? 'border-navy bg-navy text-white' : 'border-line bg-surf text-t3 hover:text-t1'
      }`}
    >
      {label} {n}
    </button>
  );
}

function StatusLabel({ status }: { status: 'not_started' | 'running' | 'complete' | 'error' }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-navy">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy" />
        Running
      </span>
    );
  }
  if (status === 'complete') return <span className="text-[12px] text-[#166534]">Complete</span>;
  if (status === 'error') return <span className="text-[12px] text-[#991B1B]">Error</span>;
  return <span className="text-[12px] text-t5">Not started</span>;
}
