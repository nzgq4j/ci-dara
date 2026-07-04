'use client';

// Pre-submission checklist. AI seeds the items + an initial pass/fail/na assessment; clicking an
// item cycles its state (pass → fail → na) and auto-saves via the server action.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Minus } from 'lucide-react';

export type ChecklistItem = { label: string; state: 'pass' | 'fail' | 'na'; detail?: string };

const NEXT: Record<string, ChecklistItem['state']> = { pass: 'fail', fail: 'na', na: 'pass' };

export default function ChecklistPanel({
  items,
  toggleAction
}: {
  items: ChecklistItem[];
  toggleAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return <p className="text-[12px] text-t5">The review will generate a pre-submission checklist.</p>;
  }

  const toggle = (index: number, state: ChecklistItem['state']) => {
    const fd = new FormData();
    fd.set('index', String(index));
    fd.set('state', NEXT[state]);
    startTransition(async () => {
      await toggleAction(fd);
      router.refresh();
    });
  };

  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i}>
          <button
            type="button"
            disabled={pending}
            onClick={() => toggle(i, it.state)}
            title={it.detail || 'Click to change status'}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surf2 disabled:opacity-60"
          >
            <StateIcon state={it.state} />
            <span className={`text-[12px] ${it.state === 'fail' ? 'text-t1' : 'text-t3'}`}>{it.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StateIcon({ state }: { state: ChecklistItem['state'] }) {
  if (state === 'pass')
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#DCFCE7]">
        <Check className="h-3 w-3 text-[#166534]" />
      </span>
    );
  if (state === 'fail')
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#FEE2E2]">
        <X className="h-3 w-3 text-[#991B1B]" />
      </span>
    );
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-line">
      <Minus className="h-3 w-3 text-t5" />
    </span>
  );
}
