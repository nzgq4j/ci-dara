// Server-safe presentational bits for the Solicitation Analysis Report (no hooks).
// Severity vocabulary matches the reskin's severity palette (red / orange / amber / blue).

export type SeverityValue = 'critical' | 'high' | 'medium' | 'low';
export type EffortBandValue = 'low' | 'moderate' | 'medium' | 'high';

export const SEVERITY: Record<
  SeverityValue,
  { label: string; text: string; bg: string; bar: string; rank: number }
> = {
  critical: { label: 'Critical', text: '#991B1B', bg: '#FEE2E2', bar: '#991B1B', rank: 3 },
  high: { label: 'High', text: '#C2410C', bg: '#FFEDD5', bar: '#C2410C', rank: 2 },
  medium: { label: 'Medium', text: '#B45309', bg: '#FEF3C7', bar: '#D97706', rank: 1 },
  low: { label: 'Low', text: '#1D4ED8', bg: '#DBEAFE', bar: '#2563EB', rank: 0 }
};

// Effort band → bar fill fraction + rough hours (for the "est. effort remaining" roll-up).
export const EFFORT: Record<EffortBandValue, { label: string; frac: number; hours: number }> = {
  low: { label: 'Low', frac: 0.25, hours: 2 },
  moderate: { label: 'Moderate', frac: 0.5, hours: 6 },
  medium: { label: 'Medium', frac: 0.7, hours: 16 },
  high: { label: 'High', frac: 1, hours: 32 }
};

export function severityRank(s: string): number {
  return SEVERITY[s as SeverityValue]?.rank ?? -1;
}

export function SeverityChip({ severity }: { severity: string }) {
  const s = SEVERITY[severity as SeverityValue] ?? SEVERITY.medium;
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ color: s.text, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  );
}

export function EffortBar({ band, estimate }: { band: string | null; estimate: string }) {
  const e = band ? EFFORT[band as EffortBandValue] : null;
  return (
    <div className="min-w-[92px]">
      <div className="flex items-center justify-between gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-line">
          <div className="h-full rounded bg-navy" style={{ width: `${Math.round((e?.frac ?? 0) * 100)}%` }} />
        </div>
        {e && <span className="shrink-0 text-[11px] font-semibold text-t3">{e.label}</span>}
      </div>
      {estimate && <div className="mt-1 text-[11px] text-t5">{estimate}</div>}
    </div>
  );
}

// Estimate the remaining effort across the open findings, from their bands.
export function estEffortLabel(openBands: (string | null)[]): string {
  const hours = openBands.reduce((sum, b) => sum + (b ? EFFORT[b as EffortBandValue]?.hours ?? 0 : 0), 0);
  if (hours === 0) return '—';
  if (hours < 8) return `~${hours} hrs`;
  const days = hours / 8;
  return days < 1.5 ? `~${hours} hrs` : `~${days % 1 === 0 ? days : days.toFixed(1)} days`;
}

// Stacked severity distribution bar + legend.
export function DistributionBar({
  counts
}: {
  counts: Record<SeverityValue, number>;
}) {
  const order: SeverityValue[] = ['critical', 'high', 'medium', 'low'];
  const total = order.reduce((n, k) => n + counts[k], 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded bg-line">
        {total > 0 &&
          order.map((k) =>
            counts[k] > 0 ? (
              <div
                key={k}
                style={{ width: `${(counts[k] / total) * 100}%`, backgroundColor: SEVERITY[k].bar }}
                title={`${SEVERITY[k].label}: ${counts[k]}`}
              />
            ) : null
          )}
      </div>
      <ul className="mt-3 space-y-1.5">
        {order.map((k) => (
          <li key={k} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SEVERITY[k].bar }} />
            <span className="text-t3">{SEVERITY[k].label}</span>
            <span className="ml-auto font-mono font-semibold text-t2">{counts[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A compact count/stat card (executive-summary strip for Direct mode; also reusable).
export function StatCard({ eyebrow, value, sub }: { eyebrow: string; value: string | number; sub: string }) {
  return (
    <div className="flex-1 rounded-lg border border-line bg-bg p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-t5">{eyebrow}</div>
      <div className="mt-0.5 text-[34px] font-bold leading-none text-t1">{value}</div>
      <div className="mt-2 text-[11px] text-t5">{sub}</div>
    </div>
  );
}

// A compact score card for the executive-summary strip.
export function ScoreCard({
  eyebrow,
  score,
  sub,
  running,
  progress,
  highlight
}: {
  eyebrow: string;
  score: number | null;
  sub: string;
  running?: boolean;
  progress?: number;
  highlight?: boolean;
}) {
  const band = score == null ? '#64748B' : score >= 85 ? '#166534' : score >= 70 ? '#B45309' : '#991B1B';
  return (
    <div
      className={`flex-1 rounded-lg border p-4 ${
        highlight ? 'border-navy/40 bg-navy/[0.05]' : 'border-line bg-bg'
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-t5">{eyebrow}</div>
      {running ? (
        <>
          <div className="mt-1 text-[15px] font-semibold text-navy">In progress</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
            <div className="h-full rounded bg-navy" style={{ width: `${progress ?? 0}%` }} />
          </div>
          <div className="mt-1.5 text-[11px] text-t5">{sub}</div>
        </>
      ) : (
        <>
          <div className="mt-0.5 text-[34px] font-bold leading-none" style={{ color: band }}>
            {score ?? '—'}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
            <div className="h-full rounded" style={{ width: `${score ?? 0}%`, backgroundColor: band }} />
          </div>
          <div className="mt-1.5 text-[11px] text-t5">{sub}</div>
        </>
      )}
    </div>
  );
}
