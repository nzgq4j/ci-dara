'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

// Shows how many evaluations are currently in progress and auto-refreshes the page
// while any are running, so the count + results update live (including runs started
// in another tab). Renders nothing when idle.
export default function RunningBanner({ count }: { count: number }) {
  const router = useRouter();

  useEffect(() => {
    if (count <= 0) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [count, router]);

  if (count <= 0) return null;

  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-[#3b6ef0]/30 bg-[#3b6ef0]/10 px-4 py-2.5 text-[13px] text-t2">
      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-[#6f9bf5]" />
      {count} evaluation{count === 1 ? '' : 's'} in progress…
    </div>
  );
}
