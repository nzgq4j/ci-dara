'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import ProgressBar from '@/components/dara/ProgressBar';

// Live run indicator: while an evaluation is actively running, it polls the page so the
// accumulating results show up, and renders a determinate progress bar reflecting what
// is actually happening right now (which factor is being assessed, X of Y). Renders
// nothing when idle.
export default function RunningBanner({
  count,
  done = 0,
  total = 0,
  currentLabel
}: {
  count: number;
  done?: number;
  total?: number;
  currentLabel?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (count <= 0) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [count, router]);

  if (count <= 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-[#3b6ef0]/30 bg-[#3b6ef0]/10 px-4 py-3">
      <div className="mb-2 flex items-center gap-2.5 text-[13px] text-t2">
        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-[#6f9bf5]" />
        <span className="font-semibold">Review in progress</span>
        {currentLabel && <span className="truncate text-t4">· {currentLabel}</span>}
        {total > 0 && (
          <span className="ml-auto flex-shrink-0 font-mono text-[11px] text-t5">
            {done}/{total} factor assessments
          </span>
        )}
      </div>
      <ProgressBar value={total > 0 ? done : undefined} max={total > 0 ? total : undefined} />
    </div>
  );
}
