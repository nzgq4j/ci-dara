import { ClipboardList } from 'lucide-react';

// Renders the "how the review was made" summary (method / what was reviewed /
// measured against) that opens each result. Tolerant of the JSON column shape.
export default function ReviewSummary({ review }: { review: unknown }) {
  const r = review && typeof review === 'object' ? (review as Record<string, any>) : null;
  if (!r) return null;

  const rows: [string, string][] = [
    ['How the review was made', String(r.method ?? '').trim()],
    ['What was reviewed', String(r.reviewed ?? '').trim()],
    [
      'Measured against',
      String(r.measuredAgainst ?? r.measured_against ?? '').trim()
    ]
  ].filter(([, v]) => v) as [string, string][];

  if (rows.length === 0) return null;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-surf p-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
        <ClipboardList className="h-3.5 w-3.5" />
        Review summary
      </div>
      {rows.map(([label, val]) => (
        <div key={label}>
          <div className="font-mono text-[10px] uppercase tracking-wide text-[#6f9bf5]">
            {label}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-t3">
            {val}
          </p>
        </div>
      ))}
    </div>
  );
}
