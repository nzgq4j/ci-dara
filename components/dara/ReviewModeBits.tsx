// Shared presentational bits for the Direct AI / Color Team dual-mode dashboard rows.
// Server-safe (no hooks) — used by the dashboard widget and the solicitations list.
//
// Per POA&M decision D5, colors map to the app's semantic tokens / existing accent rather
// than the handoff's literal navy/gold light palette, so these read correctly in both
// light and dark themes.

import Link from 'next/link';

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
