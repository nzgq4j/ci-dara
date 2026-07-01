'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import ProgressBar from './ProgressBar';

export type AiActionResult = { ok: boolean; count: number; error?: string } | null;

// Button that invokes a server action returning {ok,count,error}, shows a live
// pending state, then a success/failure notice — so AI actions (shred, reconcile)
// never fail silently. Refreshes the route on completion so new data renders.
export default function AiActionButton({
  action,
  fields,
  idle,
  label,
  pendingLabel,
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
  noun: string; // singular, e.g. "requirement"
  verb: string; // past tense, e.g. "added"
  className?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<AiActionResult>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = () => {
    setState(null);
    startTransition(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const res = await action(fd);
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

      {pending && (
        <ProgressBar label={`${pendingLabel} — the AI is working, this can take up to a minute.`} />
      )}

      {state && !pending && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
            state.ok
              ? 'border-[#1f5a31]/50 bg-[#1f5a31]/15 text-[#7de0a0]'
              : 'border-[#5a4a1f]/60 bg-[#5a4a1f]/10 text-[#e0c97d]'
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
