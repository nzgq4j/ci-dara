// Shared presentational bits for the Direct AI / Color Team dual-mode dashboard rows.
// Server-safe (no hooks) — used by the dashboard widget and the solicitations list.
//
// Per POA&M decision D5, colors map to the app's semantic tokens / existing accent rather
// than the handoff's literal navy/gold light palette, so these read correctly in both
// light and dark themes.

import Link from 'next/link';
import { Check, Loader2 } from 'lucide-react';

export type ReviewModeValue = 'direct_ai' | 'color_team';
export type DirectReviewStatusValue = 'not_started' | 'running' | 'complete' | 'error';

/** The small pill before a solicitation title marking its review paradigm. */
export function ModeChip({ mode }: { mode: ReviewModeValue }) {
  const isDirect = mode === 'direct_ai';
  return (
    <span
      title={
        isDirect
          ? 'Direct AI review — mode set at upload, cannot be changed'
          : 'Color Team review — mode set at upload, cannot be changed'
      }
      className={`inline-flex items-center rounded-[3px] px-[7px] py-[2px] font-mono text-[10px] font-semibold uppercase tracking-wide ${
        isDirect
          ? 'bg-navy/15 text-navy'
          : 'border border-line bg-surf3 text-t3'
      }`}
    >
      {isDirect ? 'Direct AI' : 'Color Team'}
    </span>
  );
}

/**
 * The Direct AI review status cell — COMPLETE (+ score) / RUNNING (pulse) / NOT STARTED.
 * Mirrors the app's existing status-badge treatment (theme.ts) for visual consistency.
 */
export function AiReviewStatus({
  status,
  score
}: {
  status: DirectReviewStatusValue | undefined;
  score: number | null | undefined;
}) {
  const s = status ?? 'not_started';
  if (s === 'complete') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide bg-[#DCFCE7] text-[#166534]">
          Complete
        </span>
        {score != null && <span className="font-mono text-[11px] font-semibold text-t3">{score}</span>}
      </span>
    );
  }
  if (s === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide bg-navy/20 text-navy">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy" />
        Running
      </span>
    );
  }
  if (s === 'error') {
    return (
      <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide bg-[#FEE2E2] text-[#991B1B]">
        Error
      </span>
    );
  }
  return (
    <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide bg-line text-t4">
      Not started
    </span>
  );
}

/**
 * Context-sensitive row action for a Direct AI solicitation. All three states route to the
 * workspace, which renders the matching AI-review state (run / progress / findings).
 */
export function AiReviewAction({
  solId,
  status
}: {
  solId: string;
  status: DirectReviewStatusValue | undefined;
}) {
  const href = `/app/solicitations/${solId}`;
  const s = status ?? 'not_started';
  if (s === 'complete') {
    return (
      <Link
        href={href}
        className="inline-flex items-center whitespace-nowrap rounded-md bg-navy px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-navy/90"
      >
        Open Findings
      </Link>
    );
  }
  if (s === 'running') {
    return (
      <Link
        href={href}
        className="inline-flex items-center whitespace-nowrap rounded-md border border-navy/50 px-3 py-1.5 text-[12px] font-medium text-navy transition-colors hover:bg-navy/10"
      >
        View Progress
      </Link>
    );
  }
  // not_started / error → start (or re-run) the review
  return (
    <Link
      href={href}
      className="inline-flex items-center whitespace-nowrap rounded-md bg-[#B8952A] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#a3831f]"
    >
      {s === 'error' ? 'Re-run Review' : 'Start Review'}
    </Link>
  );
}

/** A due-date countdown chip: red ≤7 days, amber ≤14, gray beyond, distinct when overdue. */
export function CountdownChip({ days }: { days: number | null }) {
  if (days == null) return <span className="font-mono text-[11px] text-t5">—</span>;
  const urgent = days <= 7;
  const soon = days > 7 && days <= 14;
  const cls = urgent ? 'bg-[#FEE2E2] text-[#991B1B]' : soon ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-surf3 text-t4';
  const dot = urgent ? 'bg-[#991B1B]' : soon ? 'bg-[#92400E]' : 'bg-t5';
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days} day${days === 1 ? '' : 's'}`;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

// Color-team P1/P2/P3 review-status cells + a summary label. `byType` maps each pass type to
// its rolled-up state (not_run / running / error / complete).
const PASS_ORDER = ['compliance_format', 'technical_responsiveness', 'risk_competitive'] as const;

export function ColorTeamStatus({ byType }: { byType: Record<string, string> }) {
  const states = PASS_ORDER.map((t) => byType[t] ?? 'not_run');
  const completeN = states.filter((s) => s === 'complete').length;
  const runningIdx = states.findIndex((s) => s === 'running');
  let label: string;
  let labelCls: string;
  if (runningIdx >= 0) {
    label = `P${runningIdx + 1} Running`;
    labelCls = 'text-navy';
  } else if (completeN === 3) {
    label = 'All passes complete';
    labelCls = 'text-[#166534]';
  } else if (completeN === 1) {
    label = 'Pass 1 only';
    labelCls = 'text-t4';
  } else if (completeN > 0) {
    label = `Passes 1–${completeN}`;
    labelCls = 'text-t4';
  } else {
    label = 'Not started';
    labelCls = 'text-t5';
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {states.map((s, i) => (
          <PassCell key={i} n={i + 1} state={s} />
        ))}
      </div>
      <span className={`whitespace-nowrap text-[11px] ${labelCls}`}>{label}</span>
    </div>
  );
}

function PassCell({ n, state }: { n: number; state: string }) {
  const base = 'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold';
  if (state === 'complete')
    return (
      <span className={`${base} bg-[#DCFCE7] text-[#166534]`}>
        <Check className="h-2.5 w-2.5" />P{n}
      </span>
    );
  if (state === 'running')
    return (
      <span className={`${base} bg-navy/15 text-navy`}>
        <Loader2 className="h-2.5 w-2.5 animate-spin" />P{n}
      </span>
    );
  if (state === 'error') return <span className={`${base} bg-[#FEE2E2] text-[#991B1B]`}>P{n}</span>;
  return <span className={`${base} bg-surf3 text-t5`}>P{n}</span>;
}
