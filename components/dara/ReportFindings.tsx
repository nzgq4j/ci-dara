'use client';

// The Prioritized Findings & Action Plan table. AI supplies severity, the finding + action,
// owner role, and effort; the user edits the assigned owner name and the workflow status inline
// (auto-saved via the server action). Effort is a read-only AI display.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { SeverityChip, EffortBar } from '@/components/dara/reportBits';

export type ReportFinding = {
  id: string;
  severity: string;
  text: string;
  recommendedAction: string;
  requirementRef: string;
  ownerRole: string;
  ownerName: string;
  effortBand: string | null;
  effortEstimate: string;
  status: 'open' | 'in_progress' | 'resolved';
};

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-[#FEE2E2] text-[#991B1B]',
  in_progress: 'bg-[#FEF3C7] text-[#92400E]',
  resolved: 'bg-[#DCFCE7] text-[#166534]'
};

export default function ReportFindings({
  findings,
  updateAction
}: {
  findings: ReportFinding[];
  updateAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  if (findings.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-t5">
        No findings yet — run (or regenerate) the review to populate the action plan.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="w-8 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">#</th>
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Severity</th>
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Finding &amp; Action</th>
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Owner</th>
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Effort</th>
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Status</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => (
            <FindingRow key={f.id} f={f} n={i + 1} updateAction={updateAction} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingRow({
  f,
  n,
  updateAction
}: {
  f: ReportFinding;
  n: number;
  updateAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(f.status);
  const [ownerName, setOwnerName] = useState(f.ownerName);

  const save = (patch: Record<string, string>) => {
    const fd = new FormData();
    fd.set('findingId', f.id);
    for (const [k, v] of Object.entries(patch)) fd.set(k, v);
    startTransition(async () => {
      await updateAction(fd);
      router.refresh();
    });
  };

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-3 py-3 font-mono text-[12px] text-t5">{String(n).padStart(2, '0')}</td>
      <td className="px-3 py-3">
        <SeverityChip severity={f.severity} />
      </td>
      <td className="px-3 py-3">
        <div className="text-[13px] font-semibold text-t1">{f.text}</div>
        {f.recommendedAction && (
          <div className="mt-1 max-w-[46ch] text-[12px] leading-snug text-t4">{f.recommendedAction}</div>
        )}
        {f.requirementRef && (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-t5">Ref: {f.requirementRef}</div>
        )}
      </td>
      <td className="px-3 py-3">
        {f.ownerRole && <div className="text-[12px] font-semibold text-t2">{f.ownerRole}</div>}
        <input
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          onBlur={() => ownerName !== f.ownerName && save({ ownerName })}
          placeholder="Assign…"
          className="mt-0.5 w-[110px] rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-t4 transition-colors hover:border-line focus:border-gold focus:bg-bg focus:outline-none"
        />
      </td>
      <td className="px-3 py-3">
        <EffortBar band={f.effortBand} estimate={f.effortEstimate} />
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center gap-1.5">
          <select
            value={status}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value as ReportFinding['status'];
              setStatus(v);
              save({ status: v });
            }}
            className={`cursor-pointer rounded px-1.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[status]} focus:outline-none focus:ring-1 focus:ring-gold`}
          >
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
          {pending && <Loader2 className="h-3 w-3 animate-spin text-t5" />}
        </span>
      </td>
    </tr>
  );
}
