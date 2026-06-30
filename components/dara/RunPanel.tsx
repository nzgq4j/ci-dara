'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { btnPrimary } from '@/components/dara/theme';

export type RunState = {
  ok: boolean;
  personas: number;
  results: number;
  errors: number;
} | null;

// Run-evaluation control with a live in-progress indicator + completion notice.
// Calls the server action directly (React 18) inside a transition for `pending`,
// then refreshes so the new results render.
export default function RunPanel({
  action,
  solId,
  responseId,
  activeCount,
  disabled
}: {
  action: (fd: FormData) => Promise<RunState>;
  solId: string;
  responseId: string;
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
      fd.set('responseId', responseId);
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
          ? `Evaluating… (${activeCount} ${plural})`
          : `Run evaluation${activeCount > 0 ? ` (${activeCount} ${plural})` : ''}`}
      </button>

      {state && !pending && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
            state.errors > 0
              ? 'border-[#5a4a1f]/60 bg-[#5a4a1f]/10 text-[#e0c97d]'
              : 'border-[#1f5a31]/50 bg-[#1f5a31]/15 text-[#7de0a0]'
          }`}
        >
          {state.errors > 0 ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          )}
          <span>
            Evaluation complete — {state.results} criteria scored across{' '}
            {state.personas} {state.personas === 1 ? 'persona' : 'personas'}
            {state.errors > 0 ? `, ${state.errors} error(s)` : ''}.
          </span>
        </div>
      )}
    </div>
  );
}
