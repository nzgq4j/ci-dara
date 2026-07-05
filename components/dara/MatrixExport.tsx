'use client';

import { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

type ExportResult = {
  ok: boolean;
  filename?: string;
  mime?: string;
  content?: string;
  encoding?: 'base64';
  error?: string;
};

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
  const [busy, setBusy] = useState<null | 'csv' | 'docx'>(null);
  const [err, setErr] = useState('');

  const run = (format: 'csv' | 'docx') => async () => {
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
      // Binary formats (.docx) come back base64-encoded — decode to bytes; text (CSV) is verbatim.
      const body: BlobPart =
        res.encoding === 'base64'
          ? Uint8Array.from(atob(res.content), (c) => c.charCodeAt(0))
          : res.content;
      const blob = new Blob([body], { type: res.mime || 'text/plain' });
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
      <button type="button" onClick={run('docx')} disabled={busy !== null} className={btn} title="Export as Word (.docx)">
        {busy === 'docx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        Export Word
      </button>
      {err && <span className="text-[11px] text-[#991B1B]">{err}</span>}
    </div>
  );
}
