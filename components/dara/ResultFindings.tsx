import { CheckCircle2, AlertTriangle, ShieldCheck, Lightbulb } from 'lucide-react';

// Renders the structured evaluation findings for one result: strengths,
// weaknesses, compliance, and suggested changes (with rationale). Tolerant of the
// JSON columns being null / oddly shaped. Returns null when there's nothing to show.

function toList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : String((x as any)?.text ?? (x as any)?.item ?? '')))
    .map((s) => s.trim())
    .filter(Boolean);
}

function toChanges(v: unknown): { change: string; rationale: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c: any) =>
      typeof c === 'string'
        ? { change: c.trim(), rationale: '' }
        : { change: String(c?.change ?? '').trim(), rationale: String(c?.rationale ?? '').trim() }
    )
    .filter((c) => c.change);
}

export default function ResultFindings({
  strengths,
  weaknesses,
  compliance,
  suggestedChanges
}: {
  strengths: unknown;
  weaknesses: unknown;
  compliance: string | null;
  suggestedChanges: unknown;
}) {
  const s = toList(strengths);
  const w = toList(weaknesses);
  const changes = toChanges(suggestedChanges);
  const comp = compliance && String(compliance).trim() ? String(compliance).trim() : '';

  if (!s.length && !w.length && !changes.length && !comp) return null;

  return (
    <div className="mt-3 space-y-3">
      {(s.length > 0 || w.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {s.length > 0 && (
            <BulletBlock
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              title="Strengths"
              tone="text-[#166534]"
              items={s}
            />
          )}
          {w.length > 0 && (
            <BulletBlock
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              title="Weaknesses"
              tone="text-[#e0b057]"
              items={w}
            />
          )}
        </div>
      )}

      {comp && (
        <div className="rounded-lg border border-line bg-surf p-3">
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-navy">
            <ShieldCheck className="h-3.5 w-3.5" />
            Compliance
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-t3">{comp}</p>
        </div>
      )}

      {changes.length > 0 && (
        <div className="rounded-lg border border-line bg-surf p-3">
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#b794f6]">
            <Lightbulb className="h-3.5 w-3.5" />
            Suggested changes
          </div>
          <ol className="space-y-2">
            {changes.map((c, i) => (
              <li key={i} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-t2">
                  {i + 1}. {c.change}
                </span>
                {c.rationale && (
                  <div className="mt-0.5 text-t4">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-t5">
                      Why:{' '}
                    </span>
                    {c.rationale}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function BulletBlock({
  icon,
  title,
  tone,
  items
}: {
  icon: React.ReactNode;
  title: string;
  tone: string;
  items: string[];
}) {
  return (
    <div className="rounded-lg border border-line bg-surf p-3">
      <div className={`mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] ${tone}`}>
        {icon}
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-t3">
            <span className={`mt-[3px] ${tone}`}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
