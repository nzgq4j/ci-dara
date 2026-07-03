'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import ProgressBar from './ProgressBar';

// Kicks off a background worker job (shred, amendment reconcile) then polls while it runs.
// These jobs have no known total, so the bar is indeterminate; an optional live count of
// items produced so far (requirements found / changes proposed) climbs as the worker writes.
// Non-blocking — the request returns immediately; the worker does the slow AI work.
export default function AsyncJobControl({
  idleLabel,
  activeLabel,
  idleIcon,
  active,
  count,
  countNoun,
  action,
  fields,
  className,
  disabled
}: {
  idleLabel: string;
  activeLabel: string;
  idleIcon?: ReactNode;
  active: boolean;
  count?: number;
  countNoun?: string;
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  fields: Record<string, string>;
  className?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);

  const run = () => {
    setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok) setError(res.error ?? 'Could not start.');
      router.refresh();
    });
  };

  const busy = active || pending;
  const showCount = active && count != null && count > 0 && countNoun;

  return (
    <div className="space-y-2">
      <button type="button" onClick={run} disabled={busy || disabled} className={className}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : idleIcon}
        {active ? activeLabel : idleLabel}
      </button>

      {active && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-t4">
            <span>{activeLabel}</span>
            {showCount && (
              <span className="font-mono text-t5">
                {count} {countNoun}
                {count === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <ProgressBar />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[#5a4a1f]/60 bg-[#5a4a1f]/10 px-3 py-2 text-[12px] leading-relaxed text-[#e0c97d]">
          {error}
        </div>
      )}
    </div>
  );
}
