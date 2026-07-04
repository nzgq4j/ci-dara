'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { btnPrimary } from '@/components/dara/theme';
import ProgressBar from '@/components/dara/ProgressBar';

export type RunState = {
  ok: boolean;
  personas: number;
  results: number;
  errors: number;
  done?: number; // evaluation factors assessed (this persona-set), incl. prior runs
  total?: number; // total evaluation factors
  complianceChecked?: number; // pass/fail requirements swept into the matrix
} | null;

// Run-evaluation control with a live in-progress indicator + completion notice.
// Calls the server action directly (React 18) inside a transition for `pending`,
// then refreshes so the new results render.
export default function RunPanel({
  action,
  solId,
  reviewId,
  activeCount,
  disabled
}: {
  action: (fd: FormData) => Promise<RunState>;
  solId: string;
  reviewId: string;
  activeCount: number;
  disabled: boolean;
}) {
  const [state, setState] = useState<RunState>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = () => {
    setState(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('solId', solId);
      fd.set('reviewId', reviewId);
      const res = await action(fd);
      setState(res);
      router.refresh();
    });
  };

  const plural = activeCount === 1 ? 'persona' : 'personas';

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={disabled || pending}
        className={btnPrimary}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {pending
          ? `Reviewing… (${activeCount} ${plural})`
          : `Run review${activeCount > 0 ? ` (${activeCount} ${plural})` : ''}`}
      </button>

      {pending && (
        <ProgressBar label="Holistic review + compliance sweep — this can take a minute." />
      )}

      {state && !pending && (() => {
        const incomplete = state.total != null && state.total > 0 && (state.done ?? 0) < state.total;
        const warn = incomplete || state.errors > 0;
        return (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
              warn
                ? 'border-[#92400E]/25 bg-[#FEF3C7] text-[#92400E]'
                : 'border-[#166534]/30 bg-[#DCFCE7] text-[#166534]'
            }`}
          >
            {warn ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            )}
            <span>
              {incomplete
                ? `Assessed ${state.done} of ${state.total} evaluation factors — click Run again to continue.`
                : `Review complete — ${state.done ?? state.results} factor assessment${(state.done ?? state.results) === 1 ? '' : 's'} across ${state.personas} ${state.personas === 1 ? 'persona' : 'personas'}`}
              {!incomplete && state.complianceChecked ? `, ${state.complianceChecked} compliance checks` : ''}
              {!incomplete && state.errors > 0 ? `, ${state.errors} error(s)` : ''}
              {incomplete ? '' : '.'}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
