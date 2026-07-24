'use client';

// Compliance matrix — filterable, searchable, inline-editable requirement table.
// Filter chips (All / Compliant / Partial / Missing) with live counts, a search box, status
// chips, row tinting by status, and inline auto-save of Response Location / Status / Notes
// (on blur / change) via the saveMatrixRow server action. Colors use the design's readable
// severity palette (D5).

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Check, ChevronDown, ChevronRight, CornerDownRight } from 'lucide-react';
import RequirementDetail, { type RequirementDetailData } from '@/components/dara/RequirementDetail';

// Section grouping for the matrix, in display order. Every requirement falls into exactly one
// disposition; administrative-compliance items (security, training, background checks, IT/cyber
// compliance, registrations — the standard flow-downs) sit in their own bucket so they don't
// clutter the substantive requirements. `defaultCollapsed` folds the boilerplate away by default.
const DISPOSITION_GROUPS: { key: string; label: string; sub: string; defaultCollapsed: boolean }[] = [
  { key: 'scored', label: 'Scored', sub: 'Evaluated under a Section M factor', defaultCollapsed: false },
  { key: 'compliance', label: 'Compliance', sub: 'Must be met or addressed — not scored', defaultCollapsed: false },
  { key: 'administrative', label: 'Administrative Compliance', sub: 'Standard flow-downs & submission mechanics', defaultCollapsed: true }
];

export type MatrixRowData = {
  id: string;
  name: string;
  citation: string;
  // Source distinguishes an evaluation_factor row (the scored parent) from the obligations under it.
  source?: string;
  // Disposition drives the matrix's section grouping (Scored / Compliance / Administrative Compliance).
  disposition?: string;
  // Section M factor name(s) this obligation is evaluated under — the L/PWS→M roll-up link.
  governingFactors?: string[];
  complianceStatus: string;
  proposalRef: string;
  notes: string;
  isNew?: boolean;
  isAmended?: boolean;
  version?: number;
  // Parse-QA review state — drives the "flagged" badge + the Needs-review filter.
  reviewStatus?: string;
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
  saveAction,
  setReviewStatusAction
}: {
  solId: string;
  rows: MatrixRowData[];
  saveAction: (fd: FormData) => Promise<{ ok: boolean }>;
  // Optional: sets a requirement's parse-QA review status from the detail modal.
  setReviewStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
}) {
  const [filter, setFilter] = useState('all');
  const [needsReview, setNeedsReview] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    () => Object.fromEntries(DISPOSITION_GROUPS.filter((g) => g.defaultCollapsed).map((g) => [g.key, true]))
  );
  // Which Scored factors are expanded to show their roll-up (the obligations evaluated under them).
  const [expandedFactors, setExpandedFactors] = useState<Record<string, boolean>>({});

  // The roll-up: every requirement evaluated under each Section M factor, keyed by lower-cased factor
  // name. Built from ALL rows (not just the filtered view) so a factor's evaluated scope is complete.
  const governedByFactor = useMemo(() => {
    const m = new Map<string, MatrixRowData[]>();
    for (const r of rows) {
      if (r.source === 'evaluation_factor') continue; // a factor is not evaluated under itself
      for (const gf of r.governingFactors ?? []) {
        const k = gf.trim().toLowerCase();
        if (!k) continue;
        const bucket = m.get(k);
        if (bucket) bucket.push(r);
        else m.set(k, [r]);
      }
    }
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const f of FILTERS) if (f.key !== 'all') c[f.key] = rows.filter((r) => f.match(r.complianceStatus)).length;
    return c;
  }, [rows]);
  const flaggedCount = useMemo(() => rows.filter((r) => r.reviewStatus === 'flagged').length, [rows]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    const f = FILTERS.find((x) => x.key === filter)!;
    if (!f.match(r.complianceStatus)) return false;
    if (needsReview && r.reviewStatus !== 'flagged') return false;
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
        <div className="flex items-center gap-2">
          {flaggedCount > 0 && (
            <button
              type="button"
              onClick={() => setNeedsReview((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                needsReview ? 'bg-[#FEF3C7] text-[#92400E]' : 'border border-line bg-surf text-t4 hover:text-t1'
              }`}
              title="Show only requirements the shred flagged for review"
            >
              Needs review <span className={needsReview ? 'opacity-80' : 'text-t5'}>{flaggedCount}</span>
            </button>
          )}
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
          {(() => {
            // Bucket visible rows by disposition; anything unknown falls into 'compliance'.
            const byGroup: Record<string, MatrixRowData[]> = {};
            for (const r of visible) {
              const key = DISPOSITION_GROUPS.some((g) => g.key === r.disposition) ? (r.disposition as string) : 'compliance';
              (byGroup[key] ??= []).push(r);
            }
            let running = 0;
            return DISPOSITION_GROUPS.map((g) => {
              const groupRows = byGroup[g.key] ?? [];
              if (groupRows.length === 0) return null;
              const isCollapsed = collapsed[g.key];
              return (
                <div key={g.key}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                    className="flex w-full items-center gap-2 border-t border-line bg-surf px-4 py-2 text-left hover:bg-surf2"
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-t4" /> : <ChevronDown className="h-3.5 w-3.5 text-t4" />}
                    <span className="text-[12px] font-semibold text-t2">{g.label}</span>
                    <span className="rounded-full bg-surf3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-t4">{groupRows.length}</span>
                    <span className="ml-1 truncate text-[11px] text-t5">{g.sub}</span>
                  </button>
                  {!isCollapsed && groupRows.map((r) => {
                    running += 1;
                    const isFactor = g.key === 'scored' && r.source === 'evaluation_factor';
                    const governed = isFactor ? (governedByFactor.get(r.name.trim().toLowerCase()) ?? []) : [];
                    const isOpen = isFactor && !!expandedFactors[r.id];
                    return (
                      <div key={r.id}>
                        <MatrixRow
                          solId={solId}
                          row={r}
                          index={running}
                          saveAction={saveAction}
                          setReviewStatusAction={setReviewStatusAction}
                          governedCount={isFactor ? governed.length : undefined}
                          expanded={isOpen}
                          onToggleExpand={isFactor && governed.length > 0 ? () => setExpandedFactors((s) => ({ ...s, [r.id]: !s[r.id] })) : undefined}
                        />
                        {isOpen && governed.length > 0 && (
                          <div className="border-t border-line bg-surf2/30">
                            <div className="px-4 py-1.5 pl-12 font-mono text-[10px] uppercase tracking-wide text-t5">
                              Evaluated under this factor · {governed.length} obligation{governed.length === 1 ? '' : 's'}
                            </div>
                            {governed.map((gr) => (
                              <GovernedChildRow key={gr.id} row={gr} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
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
  saveAction,
  setReviewStatusAction,
  governedCount,
  expanded,
  onToggleExpand
}: {
  solId: string;
  row: MatrixRowData;
  index: number;
  saveAction: (fd: FormData) => Promise<{ ok: boolean }>;
  setReviewStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
  // When this row is a Section M factor, its governing-obligation count + expand control (the roll-up).
  governedCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
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

  const setReview = (reviewStatus: string) => {
    if (!setReviewStatusAction) return;
    const fd = new FormData();
    fd.set('solId', solId);
    fd.set('requirementId', row.id);
    fd.set('reviewStatus', reviewStatus);
    startTransition(async () => {
      const res = await setReviewStatusAction(fd);
      if (res?.ok) router.refresh();
    });
  };

  return (
    <div
      className={`grid grid-cols-[36px_minmax(0,1.4fr)_96px_minmax(0,0.9fr)_130px_minmax(0,1fr)] items-start gap-3 border-t border-line px-4 py-2.5 ${meta.row}`}
    >
      <span className="pt-1 font-mono text-[11px] text-t5">{index}</span>

      <div className="min-w-0">
        {row.detail ? (
          <RequirementDetail
            detail={row.detail}
            onSetReviewStatus={setReviewStatusAction ? setReview : undefined}
          >
            <span className="text-[12.5px] leading-snug text-t2 hover:underline">{row.name}</span>
          </RequirementDetail>
        ) : (
          <div className="text-[12.5px] leading-snug text-t2">{row.name}</div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {row.reviewStatus === 'flagged' && (
            <span className="rounded bg-[#FEF3C7] px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-[#92400E]">flagged</span>
          )}
          {row.isNew && (
            <span className="rounded bg-[#DCFCE7] px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-[#166534]">new</span>
          )}
          {row.isAmended && (
            <span className="rounded bg-[#FEF3C7] px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-[#92400E]">
              amended v{row.version}
            </span>
          )}
          {/* Roll-up link: which Section M factor(s) this obligation is evaluated under. */}
          {row.source !== 'evaluation_factor' && (row.governingFactors?.length ?? 0) > 0 &&
            row.governingFactors!.map((gf) => (
              <span key={gf} className="inline-flex items-center rounded bg-navy/10 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wide text-navy">
                evaluated under: {gf}
              </span>
            ))}
        </div>
        {/* When this row is a Section M factor: the expand control revealing its roll-up. */}
        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-1 inline-flex items-center gap-1 rounded text-[11px] font-semibold text-navy hover:underline"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? 'Hide' : 'Show'} {governedCount} evaluated obligation{governedCount === 1 ? '' : 's'}
          </button>
        )}
        {governedCount === 0 && row.source === 'evaluation_factor' && (
          <span className="mt-1 block text-[10.5px] text-t5">No obligations linked to this factor yet</span>
        )}
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

// A read-only nested row shown under an expanded Section M factor: one obligation evaluated under it.
// This is the visual roll-up — the scored factor's rating is built from these. Editing still happens on
// the obligation's own row in the Compliance group; here it's a reference view of the evaluated scope.
function GovernedChildRow({ row }: { row: MatrixRowData }) {
  const meta = STATUS_META[row.complianceStatus] ?? STATUS_META.not_assessed;
  return (
    <div className="grid grid-cols-[36px_minmax(0,1.4fr)_96px_minmax(0,0.9fr)_130px_minmax(0,1fr)] items-start gap-3 border-t border-line/50 px-4 py-2 pl-12">
      <span className="pt-0.5 text-t5">
        <CornerDownRight className="h-3 w-3" />
      </span>
      <div className="min-w-0">
        {row.detail ? (
          <RequirementDetail detail={row.detail}>
            <span className="text-[12px] leading-snug text-t3 hover:underline">{row.name}</span>
          </RequirementDetail>
        ) : (
          <div className="text-[12px] leading-snug text-t3">{row.name}</div>
        )}
      </div>
      <span className="inline-flex w-fit items-center rounded bg-surf3 px-1.5 py-0.5 font-mono text-[10px] text-t4">
        {row.citation || '—'}
      </span>
      <span className="truncate text-[11px] text-t5">{row.proposalRef || '—'}</span>
      <span className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.chip}`}>
        {meta.glyph} {meta.label}
      </span>
      <span className="text-[11px] text-t5">{row.notes || ''}</span>
    </div>
  );
}
