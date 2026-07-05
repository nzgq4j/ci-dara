'use client';

// Report toolbar — Export PDF (browser print), Export XLSX (client-side findings export), and
// Regenerate (re-runs the review through the async worker).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, RefreshCw, Loader2 } from 'lucide-react';
import type { ReportFinding } from '@/components/dara/ReportFindings';

export default function ReportToolbar({
  solId,
  title,
  findings,
  regenerateAction,
  regenerateLabel
}: {
  solId: string;
  title: string;
  findings: ReportFinding[];
  regenerateAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  regenerateLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const exportXlsx = () => {
    // An HTML table with an .xls extension opens natively in Excel — no dependency needed.
    const rows = findings
      .map(
        (f, i) =>
          `<tr><td>${i + 1}</td><td>${esc(f.severity)}</td><td>${esc(f.text)}</td><td>${esc(
            f.recommendedAction
          )}</td><td>${esc(f.requirementRef)}</td><td>${esc(f.ownerRole)} ${esc(f.ownerName)}</td><td>${esc(
            f.effortBand ?? ''
          )} ${esc(f.effortEstimate)}</td><td>${esc(f.status)}</td></tr>`
      )
      .join('');
    const html =
      `<table border="1"><thead><tr><th>#</th><th>Severity</th><th>Finding</th><th>Action</th>` +
      `<th>Ref</th><th>Owner</th><th>Effort</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    const blob = new Blob([`﻿${html}`], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'analysis-report'}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const regenerate = () => {
    setError(null);
    const fd = new FormData();
    fd.set('solId', solId);
    startTransition(async () => {
      const res = await regenerateAction(fd);
      if (!res.ok) setError(res.error ?? 'Could not start the review.');
      else router.refresh();
    });
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {error && <span className="text-[12px] text-[#991B1B]">{error}</span>}
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-t3 transition-colors hover:border-navy/30 hover:text-t1"
      >
        <Download className="h-4 w-4" /> Export PDF
      </button>
      <button
        type="button"
        onClick={exportXlsx}
        className="inline-flex items-center gap-2 rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-navy/90"
      >
        <FileSpreadsheet className="h-4 w-4" /> Export XLSX
      </button>
      <button
        type="button"
        onClick={regenerate}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-t3 transition-colors hover:border-navy/30 hover:text-t1 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {regenerateLabel}
      </button>
    </div>
  );
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
