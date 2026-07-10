'use client';

// Compliance matrix — filterable, searchable, inline-editable requirement table.
// Filter chips (All / Compliant / Partial / Missing) with live counts, a search box, status
// chips, row tinting by status, and inline auto-save of Response Location / Status / Notes
// (on blur / change) via the saveMatrixRow server action. Colors use the design's readable
// severity palette (D5).

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Check } from 'lucide-react';
import RequirementDetail, { type RequirementDetailData } from '@/components/dara/RequirementDetail';

export type MatrixRowData = {
  id: string;
  name: string;
  citation: string;
  complianceStatus: string;
  proposalRef: string;
  notes: string;
  isNew?: boolean;
  isAmended?: boolean;
  version?: number;
  // Full requirement detail for the click-to-open modal (source doc + HRLR logic). Optional so a
  // row without it still renders as plain text.
  detail?: RequirementDetailData;
};

const STATUS_META: Record<string, { label: string; chip: string; row: string; glyph: string }> = {
  compliant: { label: 'Compliant', chip: 'bg-[#DCFCE7] text-[#166534]', row: '', glyph: '✓' },
  partial: { label: 'Partial', chip: 'bg-[#FEF3C7] text-[#92400E]', row: 'bg-[#FEF3C7]/25', glyph: '◑' },
  non_compliant: { label: 'Missing', chip: 'bg-[#FEE2E2] text-[#991B1B]', row: 'bg-[#FEE2E2]/40', glyph: '✗' },
  not_assessed: { label: 'Not assessed', chip: 'bg-line text-t4', row: '', glyph: '·' },
  not_applicable: { label: 'N/A', chip: 'bg-line text-t4', row: '', glyph: '–' }
};

const STATUS_OPTIONS = ['compliant', 'partial', 'non_compliant', 'not_assessed', 'not_applicable'];

// The clickable filter chips, in mockup order.
const FILTERS: { key: string; label: string; match: (s: string) => boolean; chip: string }[] = [
  { key: 'all', label: 'All', match: () => true, chip: 'bg-navy text-white' },
  { key: 'compliant', label: 'Compliant', match: (s) => s === 'compliant', chip: 'bg-[#DCFCE7] text-[#166534]' },
  { key: 'partial', label: 'Partial', match: (s) => s === 'partial', chip: 'bg-[#FEF3C7] text-[#92400E]' },
  { key: 'non_compliant', label: 'Missing', match: (s) => s === 'non_compliant', chip: 'bg-[#FEE2E2] text-[#991B1B]' }
];

export default function ComplianceMatrix({
  solId,
  rows,
  saveAction
}: {
  solId: string;
  rows: MatrixRowData[];
  saveAction: (fd: FormData) => Promise<{ ok: boolean }>;
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const f of FILTERS) if (f.key !== 'all') c[f.key] = rows.filter((r) => f.match(r.complianceStatus)).length;
    return c;
  }, [rows]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    const f = FILTERS.find((x) => x.key === filter)!;
    if (!f.match(r.complianceStatus)) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.citation.toLowerCase().includes(q) ||
      r.proposalRef.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-3">
      {/* Filters + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  active ? f.chip : 'border border-line bg-surf text-t4 hover:text-t1'
                }`}
              >
                {f.label} <span className={active ? 'opacity-80' : 'text-t5'}>{counts[f.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-t5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requirements…"
            className="w-56 rounded-md border border-line bg-bg py-1.5 pl-8 pr-2.5 text-[12px] text-t2 placeholder:text-t5 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-line">
        <div className="min-w-[920px]">
          <div className="grid grid-cols-[36px_minmax(0,1.4fr)_96px_minmax(0,0.9fr)_130px_minmax(0,1fr)] items-center gap-3 bg-surf2 px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">
            <span>#</span>
            <span>Requirement</span>
            <span>Source</span>
            <span>Response Location</span>
            <span>Status</span>
            <span>Notes</span>
          </div>
          {visible.map((r, i) => (
            <MatrixRow key={r.id} solId={solId} row={r} index={i + 1} saveAction={saveAction} />
          ))}
          {visible.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-t5">
              No requirements match this filter{q ? ' / search' : ''}.
            </div>
          )}
        </div>
      </div>
      <div className="px-1 text-[11px] text-t5">
        Showing {visible.length} of {rows.length} requirement{rows.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function MatrixRow({
  solId,
  row,
  index,
  saveAction
}: {
  solId: string;
  row: MatrixRowData;
  index: number;
  saveAction: (fd: FormData) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(row.complianceStatus);
  const [proposalRef, setProposalRef] = useState(row.proposalRef);
  const [notes, setNotes] = useState(row.notes);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const meta = STATUS_META[status] ?? STATUS_META.not_assessed;

  const save = (next: { status?: string; proposalRef?: string; notes?: string }) => {
    const fd = new FormData();
    fd.set('solId', solId);
    fd.set('requirementId', row.id);
    fd.set('complianceStatus', next.status ?? status);
    fd.set('proposalRef', next.proposalRef ?? proposalRef);
    fd.set('notes', next.notes ?? notes);
    startTransition(async () => {
      const res = await saveAction(fd);
      if (res?.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
        router.refresh();
      }
    });
  };

  return (
    <div
      className={`grid grid-cols-[36px_minmax(0,1.4fr)_96px_minmax(0,0.9fr)_130px_minmax(0,1fr)] items-start gap-3 border-t border-line px-4 py-2.5 ${meta.row}`}
    >
      <span className="pt-1 font-mono text-[11px] text-t5">{index}</span>

      <div className="min-w-0">
        {row.detail ? (
          <RequirementDetail detail={row.detail}>
            <span className="text-[12.5px] leading-snug text-t2 hover:underline">{row.name}</span>
          </RequirementDetail>
        ) : (
          <div className="text-[12.5px] leading-snug text-t2">{row.name}</div>
        )}
        <div className="mt-0.5 flex items-center gap-1.5">
          {row.isNew && (
            <span className="rounded bg-[#DCFCE7] px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-[#166534]">new</span>
          )}
          {row.isAmended && (
            <span className="rounded bg-[#FEF3C7] px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-[#92400E]">
              amended v{row.version}
            </span>
          )}
        </div>
      </div>

      <span className="inline-flex w-fit items-center rounded bg-surf3 px-1.5 py-0.5 font-mono text-[10px] text-t3">
        {row.citation || '—'}
      </span>

      <input
        value={proposalRef}
        onChange={(e) => setProposalRef(e.target.value)}
        onBlur={() => proposalRef !== row.proposalRef && save({ proposalRef })}
        placeholder="Not assigned"
        className={`w-full rounded border px-2 py-1 text-[11.5px] text-t2 outline-none transition-colors focus:border-gold ${
          proposalRef ? 'border-line bg-bg' : 'border-dashed border-line bg-transparent placeholder:text-t5'
        }`}
      />

      <select
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          save({ status: e.target.value });
        }}
        className={`w-full cursor-pointer rounded border-0 px-2 py-1 text-[11px] font-semibold outline-none ${meta.chip}`}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s} className="bg-surf text-t1">
            {STATUS_META[s].glyph} {STATUS_META[s].label}
          </option>
        ))}
      </select>

      <div className="relative">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== row.notes && save({ notes })}
          placeholder="Add a note…"
          className="w-full rounded border border-line bg-bg px-2 py-1 pr-6 text-[11.5px] text-t2 outline-none focus:border-gold"
        />
        {pending && <Loader2 className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-t5" />}
        {saved && !pending && <Check className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#166534]" />}
      </div>
    </div>
  );
}
