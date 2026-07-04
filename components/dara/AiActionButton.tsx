'use client';

import { useState, useTransition, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import ProgressBar from './ProgressBar';

export type AiActionResult = { ok: boolean; count: number; error?: string } | null;

// Progress easing: the bar climbs toward this ceiling while the AI works, then snaps
// to 100% on finish. Server actions are opaque (no streamed progress), so we simulate
// a decelerating percentage that never looks stuck and never claims to be done early.
const CEILING = 92;

// Button that invokes a server action returning {ok,count,error}, shows a live
// pending state with a stepped progress bar, then a success/failure notice — so AI
// actions (shred, reconcile) never fail silently. Refreshes the route on completion
// so new data renders.
export default function AiActionButton({
  action,
  fields,
  idle,
  label,
  pendingLabel,
  steps,
  noun,
  verb,
  className,
  disabled
}: {
  action: (fd: FormData) => Promise<{ ok: boolean; count: number; error?: string }>;
  fields: Record<string, string>;
  idle?: ReactNode;
  label: string;
  pendingLabel: string;
  // Ordered sub-step messages describing what's running (reading → extracting →
  // coverage pass…). Shown under the bar and advanced in step with the percentage.
  // Falls back to a single generic line when omitted.
  steps?: string[];
  noun: string; // singular, e.g. "requirement"
  verb: string; // past tense, e.g. "added"
  className?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<AiActionResult>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState(0);
  const router = useRouter();

  // Drive the simulated percentage while pending: decelerate toward CEILING so the bar
  // keeps moving without ever finishing before the action actually resolves.
  useEffect(() => {
    if (!pending) return;
    setProgress(0);
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= CEILING) return p; // holding at the ceiling (or 100 after finish) — stop
        return Math.min(CEILING, p + Math.max(0.4, (CEILING - p) * 0.06));
      });
    }, 350);
    return () => clearInterval(id);
  }, [pending]);

  const stepList = steps && steps.length ? steps : [`${pendingLabel} — the AI is working, this can take up to a minute.`];
  // Tie the current sub-step to the bar: as the percentage advances toward CEILING it
  // walks through the steps, dwelling on the last one while the AI finishes.
  const stepIdx = Math.min(stepList.length - 1, Math.floor((progress / CEILING) * stepList.length));
  const currentStep = stepList[stepIdx];

  const run = () => {
    setState(null);
    startTransition(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const res = await action(fd);
      setProgress(100);
      setState(res);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={run} disabled={disabled || pending} className={className}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : idle}
        {pending ? pendingLabel : label}
      </button>

      {pending && <ProgressBar value={progress} max={100} label={currentStep} />}

      {state && !pending && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
            state.ok
              ? 'border-[#166534]/30 bg-[#DCFCE7] text-[#166534]'
              : 'border-[#92400E]/25 bg-[#FEF3C7] text-[#92400E]'
          }`}
        >
          {state.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          )}
          <span>
            {state.ok
              ? `${state.count} ${noun}${state.count === 1 ? '' : 's'} ${verb}.`
              : (state.error ?? 'Something went wrong.')}
          </span>
        </div>
      )}
    </div>
  );
}
