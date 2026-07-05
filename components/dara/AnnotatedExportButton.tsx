'use client';

// Downloads the annotated response .docx (proposal draft with the review's findings as inline
// Word comments). Fetches the /annotated route so we can show a pending state and surface the
// route's friendly error (e.g. "run the review first") instead of navigating at a raw response.
// Used on the Analysis Report toolbar (no reviewId) and per color-team review card (with one).

import { useState, useTransition } from 'react';
import { MessageSquareText, Loader2 } from 'lucide-react';

export default function AnnotatedExportButton({
  solId,
  reviewId,
  label = 'Annotated .docx',
  className
}: {
  solId: string;
  reviewId?: string;
  label?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');

  const run = () => {
    setErr('');
    start(async () => {
      try {
        const qs = reviewId ? `?reviewId=${reviewId}` : '';
        const res = await fetch(`/app/solicitations/${solId}/annotated${qs}`, { cache: 'no-store' });
        if (!res.ok) {
          setErr((await res.text().catch(() => '')) || 'Could not build the document.');
          return;
        }
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const name = cd.match(/filename="([^"]+)"/)?.[1] || 'annotated_response.docx';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setErr('Could not build the document.');
      }
    });
  };

  const cls =
    className ??
    'inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-t3 transition-colors hover:border-navy/30 hover:text-t1 disabled:opacity-50';

  return (
    <>
      <button type="button" onClick={run} disabled={pending} className={cls} title="Export the response with review comments (Word .docx)">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
        {pending ? 'Annotating…' : label}
      </button>
      {err && <span className="text-[11px] text-[#991B1B]">{err}</span>}
    </>
  );
}
