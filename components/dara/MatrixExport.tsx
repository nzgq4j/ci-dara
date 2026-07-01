'use client';

import { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

type ExportResult = { ok: boolean; filename?: string; mime?: string; content?: string; error?: string };

// Download buttons for the compliance matrix. Calls a server action that returns the file
// content as a string, then triggers a client-side download via a Blob — no route needed.
export default function MatrixExport({
  solId,
  action,
  className = ''
}: {
  solId: string;
  action: (fd: FormData) => Promise<ExportResult>;
  className?: string;
}) {
  const [busy, setBusy] = useState<null | 'csv' | 'doc'>(null);
  const [err, setErr] = useState('');

  const run = (format: 'csv' | 'doc') => async () => {
    setBusy(format);
    setErr('');
    try {
      const fd = new FormData();
      fd.set('solId', solId);
      fd.set('format', format);
      const res = await action(fd);
      if (!res.ok || !res.content) {
        setErr(res.error || 'Export failed.');
        return;
      }
      const blob = new Blob([res.content], { type: res.mime || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || 'compliance_matrix';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr('Export failed.');
    } finally {
      setBusy(null);
    }
  };

  const btn =
    'inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-t3 transition-colors hover:text-t1 disabled:opacity-50';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button type="button" onClick={run('csv')} disabled={busy !== null} className={btn} title="Export as CSV (opens in Excel)">
        {busy === 'csv' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
        Export CSV
      </button>
      <button type="button" onClick={run('doc')} disabled={busy !== null} className={btn} title="Export as Word document">
        {busy === 'doc' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        Export Word
      </button>
      {err && <span className="text-[11px] text-[#e07d7d]">{err}</span>}
    </div>
  );
}
