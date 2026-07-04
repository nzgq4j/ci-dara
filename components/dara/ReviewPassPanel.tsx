'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Loader2, CheckCircle2, AlertTriangle, RotateCcw, ChevronDown, Clock } from 'lucide-react';

export type PassView = {
  id: string;
  passType: 'compliance_format' | 'technical_responsiveness' | 'risk_competitive';
  status: 'not_started' | 'queued' | 'running' | 'complete' | 'error';
  score: number | null;
  progress: number;
  progressLabel: string;
  findingsCount: number;
  errorMessage: string | null;
  findings: {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    text: string;
    requirementRef: string;
    recommendedAction: string;
  }[];
};

// The three fixed lenses, in order — labels/blurbs mirror the design.
const PASS_DEFS: { type: PassView['passType']; n: number; label: string; blurb: string }[] = [
  { type: 'compliance_format', n: 1, label: 'Compliance & Format Check', blurb: 'Structure, volume/page limits, required forms, and formatting' },
  { type: 'technical_responsiveness', n: 2, label: 'Technical Responsiveness Review', blurb: 'Technical approach vs PWS requirements and Section M subfactors' },
  { type: 'risk_competitive', n: 3, label: 'Risk & Competitive Assessment', blurb: 'Programmatic risks, competitive gaps, and areas to strengthen' }
];

const SEV: Record<PassView['findings'][number]['severity'], { label: string; cls: string }> = {
  critical: { label: 'CRITICAL', cls: 'bg-[#5a1f1f]/40 text-[#e88]' },
  high: { label: 'HIGH', cls: 'bg-[#5a3a1f]/40 text-[#e0a878]' },
  medium: { label: 'MEDIUM', cls: 'bg-[#5a4a1f]/35 text-[#92400E]' },
  low: { label: 'LOW', cls: 'bg-navy/10 text-navy' }
};

function scoreColor(s: number): string {
  if (s >= 85) return 'text-[#7de0a0]';
  if (s >= 70) return 'text-[#92400E]';
  return 'text-[#e07d7d]';
}
function scoreBar(s: number): string {
  if (s >= 85) return 'bg-[#7de0a0]';
  if (s >= 70) return 'bg-[#e0c97d]';
  return 'bg-[#e07d7d]';
}

export default function ReviewPassPanel({
  solId,
  reviewId,
  passes,
  runAction,
  rerunAction,
  canRun,
  disabledReason
}: {
  solId: string;
  reviewId: string;
  passes: PassView[];
  runAction: (fd: FormData) => Promise<{ ok: boolean }>;
  rerunAction: (fd: FormData) => Promise<{ ok: boolean }>;
  canRun: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const byType = new Map(passes.map((p) => [p.passType, p]));
  const cards = PASS_DEFS.map((d) => ({ def: d, pass: byType.get(d.type) ?? null }));
  const active = passes.some((p) => p.status === 'queued' || p.status === 'running');
  const anyStarted = passes.some((p) => p.status !== 'not_started');

  // Poll while a pass is queued/running so the live status/progress advances.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);

  const run = () => {
    const fd = new FormData();
    fd.set('solId', solId);
    fd.set('reviewId', reviewId);
    startTransition(async () => {
      await runAction(fd);
      router.refresh();
    });
  };
  const rerun = (passId: string) => {
    const fd = new FormData();
    fd.set('solId', solId);
    fd.set('passId', passId);
    startTransition(async () => {
      await rerunAction(fd);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="no-print flex items-center justify-between gap-3">
        <div className="text-[11px] text-t4">
          {active ? (
            <span className="inline-flex items-center gap-1.5 text-navy">
              <Loader2 className="h-3 w-3 animate-spin" /> AI review running — passes update live
            </span>
          ) : anyStarted ? (
            'Multi-pass AI review'
          ) : (
            'Run a 3-pass AI review of the captured draft'
          )}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!canRun || pending || active}
          title={!canRun ? disabledReason : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg border border-navy/50 bg-navy/10 px-3 py-1.5 text-[12px] font-semibold text-navy transition-colors hover:bg-navy/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending || active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : anyStarted ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {anyStarted ? 'Re-run all passes' : 'Run AI review'}
        </button>
      </div>

      {cards.map(({ def, pass }) => {
        const status = pass?.status ?? 'not_started';
        const isOpen = expanded[def.type] ?? (status === 'complete' && def.n === 1);
        return (
          <div
            key={def.type}
            className={`overflow-hidden rounded-lg border ${
              status === 'running' || status === 'queued'
                ? 'border-navy/40 bg-navy/[0.04]'
                : status === 'error'
                  ? 'border-[#5a1f1f]/60 bg-[#5a1f1f]/[0.06]'
                  : 'border-line bg-surf'
            }`}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <StatusDot status={status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-bold text-t1">Pass {def.n} — {def.label}</span>
                  <StatusPill status={status} />
                </div>
                <div className="mt-0.5 truncate text-[11px] text-t5">{def.blurb}</div>
                {status === 'running' && (
                  <div className="mt-1.5">
                    <div className="mb-1 flex justify-between text-[10px]">
                      <span className="text-t4">{pass?.progressLabel || 'Analyzing…'}</span>
                      <span className="text-navy">{pass?.progress ?? 0}%</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded bg-line">
                      <div className="h-full rounded bg-navy transition-all" style={{ width: `${pass?.progress ?? 0}%` }} />
                    </div>
                  </div>
                )}
                {status === 'error' && pass?.errorMessage && (
                  <div className="mt-1 text-[11px] leading-snug text-[#e88]">{pass.errorMessage}</div>
                )}
              </div>

              {/* Score */}
              {status === 'complete' && pass?.score != null && (
                <div className="flex flex-shrink-0 flex-col items-center">
                  <span className={`text-[26px] font-bold leading-none ${scoreColor(pass.score)}`}>{pass.score}</span>
                  <div className="mt-1 h-[3px] w-11 overflow-hidden rounded bg-line">
                    <div className={`h-full rounded ${scoreBar(pass.score)}`} style={{ width: `${pass.score}%` }} />
                  </div>
                  <span className="mt-0.5 text-[9px] text-t5">of 100</span>
                </div>
              )}

              {/* Right controls */}
              <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                {status === 'complete' && (
                  <span className="text-[11px] text-t4">{pass?.findingsCount ?? 0} findings</span>
                )}
                {(status === 'complete' || status === 'error') && (
                  <button
                    type="button"
                    onClick={() => rerun(pass!.id)}
                    disabled={pending || active}
                    className={`no-print inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      status === 'error'
                        ? 'border-[#e07d7d]/50 text-[#e88] hover:bg-[#5a1f1f]/20'
                        : 'border-line text-t3 hover:text-t1'
                    }`}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {status === 'error' ? 'Retry' : 'Re-run'}
                  </button>
                )}
              </div>

              {status === 'complete' && (pass?.findings.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [def.type]: !isOpen }))}
                  className="no-print flex-shrink-0 p-1 text-t5 transition-colors hover:text-t2"
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                </button>
              )}
            </div>

            {/* Findings */}
            {status === 'complete' && isOpen && (pass?.findings.length ?? 0) > 0 && (
              <div className="border-t border-line">
                <div className="grid grid-cols-[78px_minmax(0,1fr)_72px_minmax(0,1fr)] gap-2 border-b border-line bg-surf2 px-3.5 py-1.5 font-mono text-[9px] uppercase tracking-wide text-t5">
                  <span>Severity</span><span>Finding</span><span>Ref</span><span>Recommended action</span>
                </div>
                {pass!.findings.map((f) => (
                  <div key={f.id} className="grid grid-cols-[78px_minmax(0,1fr)_72px_minmax(0,1fr)] items-start gap-2 border-b border-line px-3.5 py-2 last:border-b-0">
                    <span className={`inline-block w-fit rounded px-1.5 py-0.5 text-[9px] font-bold ${SEV[f.severity].cls}`}>{SEV[f.severity].label}</span>
                    <span className="text-[11.5px] leading-snug text-t2">{f.text}</span>
                    <span className="font-mono text-[10px] text-t4">{f.requirementRef || '—'}</span>
                    <span className="text-[11px] leading-snug text-t4">{f.recommendedAction || '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {status === 'complete' && (pass?.findings.length ?? 0) === 0 && (
              <div className="border-t border-line px-3.5 py-2 text-[11px] text-[#7de0a0]">No findings — this pass is clean.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: PassView['status'] }) {
  if (status === 'complete') return <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-[#7de0a0]" />;
  if (status === 'running') return <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-navy" />;
  if (status === 'error') return <AlertTriangle className="h-5 w-5 flex-shrink-0 text-[#e07d7d]" />;
  if (status === 'queued') return <Clock className="h-5 w-5 flex-shrink-0 text-navy" />;
  return <div className="h-5 w-5 flex-shrink-0 rounded-full border-2 border-line" />;
}

function StatusPill({ status }: { status: PassView['status'] }) {
  const map: Record<PassView['status'], { t: string; c: string }> = {
    complete: { t: 'COMPLETE', c: 'bg-[#1f5a31]/25 text-[#7de0a0]' },
    running: { t: 'RUNNING', c: 'bg-navy/10 text-navy' },
    queued: { t: 'QUEUED', c: 'bg-surf2 text-t4' },
    error: { t: 'ERROR', c: 'bg-[#5a1f1f]/40 text-[#e88]' },
    not_started: { t: 'NOT RUN', c: 'bg-surf2 text-t5' }
  };
  const s = map[status];
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide ${s.c}`}>{s.t}</span>;
}
