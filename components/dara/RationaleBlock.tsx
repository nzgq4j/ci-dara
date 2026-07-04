import { FileSearch } from 'lucide-react';

// Formats the assessment narrative (the rationale): an intro sentence followed by
// the model's "(1) TOPIC: …  (2) TOPIC: …" findings, rendered as a numbered list
// with the topic emphasized. Falls back to a plain paragraph when there are no
// numbered markers.
function parseNumbered(text: string): { intro: string; items: string[] } {
  const trimmed = text.trim();
  const firstMarker = trimmed.search(/\(\s*1\s*\)/);
  if (firstMarker === -1) return { intro: trimmed, items: [] };
  const intro = trimmed.slice(0, firstMarker).trim();
  const items = trimmed
    .slice(firstMarker)
    .split(/(?=\(\s*\d+\s*\))/)
    .map((s) => s.replace(/^\(\s*\d+\s*\)\s*/, '').trim())
    .filter(Boolean);
  return { intro, items };
}

function Item({ text }: { text: string }) {
  // Bold a short leading "TOPIC:" label when present.
  const m = text.match(/^([^:]{1,70}):\s*([\s\S]+)$/);
  if (!m) return <span>{text}</span>;
  return (
    <span>
      <span className="font-semibold text-t2">{m[1]}:</span> {m[2]}
    </span>
  );
}

export default function RationaleBlock({ rationale }: { rationale: string | null }) {
  if (!rationale || !rationale.trim()) return null;
  const { intro, items } = parseNumbered(rationale);

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-surf p-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
        <FileSearch className="h-3.5 w-3.5" />
        Assessment
      </div>
      {intro && (
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-t3">{intro}</p>
      )}
      {items.length > 0 && (
        <ol className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-t3">
              <span className="mt-px font-mono text-[11px] font-bold text-navy">
                {i + 1}.
              </span>
              <Item text={it} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
