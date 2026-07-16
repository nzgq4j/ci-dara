'use client';

// FSEAMatrixPanel — renders all four Pass 10 output matrices in a single panel
// with inner navigation and an executive summary header.
//
// Section A: Master Evaluation Matrix — one row per actionable requirement
// Section B: Strength Opportunity Register
// Section C: Weakness Risk Register
// Section D: Administrative Compliance Checklist
//
// When no FSEA data exists (legacy solicitation), falls back to the plain
// ComplianceMatrix with a notice.

import { useState, useTransition } from 'react';
import {
  LayoutGrid, TrendingUp, ShieldAlert, ClipboardCheck,
  ChevronDown, ChevronRight, CheckCircle2, MinusCircle,
  XCircle, AlertCircle, Loader2, BookOpen
} from 'lucide-react';
import { card, eyebrow } from '@/components/dara/theme';
import type {
  P10MatrixRow, P10StrengthRegisterEntry,
  P10WeaknessRisk, P10AdminChecklist
} from '@/utils/dara/fsea/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FSEAMatrixPanelProps {
  sectionA: P10MatrixRow[];
  sectionB: P10StrengthRegisterEntry[];
  sectionC: P10WeaknessRisk[];
  sectionD: P10AdminChecklist[];
  executiveSummary?: {
    requirementsTotal?: number;
    requirementsActionable?: number;
    requirementsDiscarded?: number;
    strengthOpportunities?: number;
    weaknessRisks?: number;
    crossReferencesResolved?: number;
    regulatoryCitationsRegistered?: number;
    adminComplianceItems?: number;
    pageBudget?: { volume: string; pagesMin: number; pagesMax: number }[];
    criticalActions?: string[];
    highestLeverageAction?: string;
  } | null;
  solId: string;
  saveChecklistStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
}

type SectionId = 'A' | 'B' | 'C' | 'D';

// ── Design tokens ──────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  lead:          { bg: 'bg-navy',        text: 'text-white' },
  high:          { bg: 'bg-[#FEF3C7]',   text: 'text-[#92400E]' },
  medium:        { bg: 'bg-surf3',       text: 'text-t3' },
  low:           { bg: 'bg-surf3',       text: 'text-t5' },
  checklist_only:{ bg: 'bg-surf3',       text: 'text-t5' },
};

const SO_STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  to_be_confirmed: { bg: 'bg-surf3',      text: 'text-t4',       icon: <AlertCircle className="h-3 w-3" /> },
  confirmed:       { bg: 'bg-[#DCFCE7]',  text: 'text-[#166534]', icon: <CheckCircle2 className="h-3 w-3" /> },
  partial:         { bg: 'bg-[#FEF3C7]',  text: 'text-[#92400E]', icon: <MinusCircle className="h-3 w-3" /> },
  absent:          { bg: 'bg-[#FEE2E2]',  text: 'text-[#991B1B]', icon: <XCircle className="h-3 w-3" /> },
};

const AC_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  to_be_confirmed: { bg: 'bg-surf3',      text: 'text-t4',        label: 'To confirm' },
  confirmed:       { bg: 'bg-[#DCFCE7]',  text: 'text-[#166534]', label: 'Confirmed'  },
  na:              { bg: 'bg-surf3',       text: 'text-t5',        label: 'N/A'        },
};

// ── Section A — Master Evaluation Matrix ──────────────────────────────────────

function SectionARow({ row }: { row: P10MatrixRow }) {
  const [open, setOpen] = useState(false);
  const priority = PRIORITY_COLORS[row.priority ?? 'medium'] ?? PRIORITY_COLORS.medium;

  return (
    <div className="border-b border-line/50 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surf2 transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0 text-t5">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{row.reqId}</span>
            <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{row.paragraphId}</span>
            {row.evaluationCriterion && (
              <span className="rounded bg-[#EDE9FE] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#5B21B6]">
                {row.evaluationCriterion}
              </span>
            )}
            {row.strengthGate && (
              <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#166534]">
                {row.strengthGate}
              </span>
            )}
            <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${priority.bg} ${priority.text}`}>
              {row.pageSignal ?? row.priority}
            </span>
          </div>
          <p className="text-[12.5px] font-medium text-t1 leading-snug">{row.requirement}</p>
        </div>
      </button>
      {open && (
        <div className="border-t border-line/40 bg-surf/60 px-4 pb-4 pt-3 ml-7 space-y-3">
          <div>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Proposal response obligation</p>
            <p className="text-[12.5px] leading-relaxed text-t1">{row.proposalResponseObligation}</p>
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] text-t4">
            {row.crossReference && (
              <span>Cross-ref: <span className="font-semibold text-t2">{row.crossReference}</span></span>
            )}
            {row.pageBudgetMin != null && (
              <span>Page budget: <span className="font-semibold text-t2">{row.pageBudgetMin}–{row.pageBudgetMax} pages</span></span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionA({ rows }: { rows: P10MatrixRow[] }) {
  const [filter, setFilter] = useState<string>('all');
  const paragraphs = Array.from(new Set(rows.map(r => r.paragraphId ?? 'Other'))).sort();

  const filtered = filter === 'all' ? rows : rows.filter(r => r.paragraphId === filter);

  return (
    <div className="space-y-3">
      {/* Paragraph filter */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            filter === 'all' ? 'bg-navy text-white' : 'bg-surf3 text-t4 hover:bg-surf2 hover:text-t1'
          }`}
        >
          All ({rows.length})
        </button>
        {paragraphs.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setFilter(p)}
            className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              filter === p ? 'bg-navy text-white' : 'bg-surf3 text-t4 hover:bg-surf2 hover:text-t1'
            }`}
          >
            {p} ({rows.filter(r => r.paragraphId === p).length})
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-[9px] font-mono uppercase tracking-wide text-t5 border-b border-line">
        <span>Requirement</span>
        <span>Criterion</span>
        <span>Strength</span>
        <span>Signal</span>
      </div>

      <div className={card}>
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-t5">No requirements for this paragraph.</div>
        ) : (
          [...filtered]
            .sort((a, b) => (a.writingSequenceOrder ?? 999) - (b.writingSequenceOrder ?? 999))
            .map(row => <SectionARow key={row.reqId} row={row} />)
        )}
      </div>
    </div>
  );
}

// ── Section B — Strength Opportunity Register ─────────────────────────────────

function SectionB({
  rows,
  solId,
  saveStatusAction,
}: {
  rows: P10StrengthRegisterEntry[];
  solId: string;
  saveStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
}) {
  const [statuses, setStatuses] = useState<Record<string, P10StrengthRegisterEntry['status']>>(
    () => Object.fromEntries(rows.map(r => [r.soId, r.status ?? 'to_be_confirmed']))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleStatus = (soId: string, status: P10StrengthRegisterEntry['status']) => {
    setStatuses(prev => ({ ...prev, [soId]: status }));
    if (!saveStatusAction) return;
    setSavingId(soId);
    const fd = new FormData();
    fd.set('solId', solId);
    fd.set('soId', soId);
    fd.set('status', status);
    startTransition(async () => {
      await saveStatusAction(fd).catch(() => null);
      setSavingId(null);
    });
  };

  const counts = {
    confirmed: Object.values(statuses).filter(s => s === 'confirmed').length,
    partial:   Object.values(statuses).filter(s => s === 'partial').length,
    absent:    Object.values(statuses).filter(s => s === 'absent').length,
    pending:   Object.values(statuses).filter(s => s === 'to_be_confirmed').length,
  };

  return (
    <div className="space-y-3">
      {/* Status summary */}
      <div className="flex flex-wrap gap-3 text-[11px]">
        {[
          { label: 'Confirmed', count: counts.confirmed, color: 'text-[#166534]' },
          { label: 'Partial',   count: counts.partial,   color: 'text-[#92400E]' },
          { label: 'Absent',    count: counts.absent,    color: 'text-[#991B1B]' },
          { label: 'Pending',   count: counts.pending,   color: 'text-t4' },
        ].map(s => (
          <span key={s.label} className={`font-semibold ${s.color}`}>
            {s.count} {s.label}
          </span>
        ))}
      </div>

      <div className={card}>
        {rows.map((so, i) => {
          const [open, setOpen] = useState(false);
          const status = statuses[so.soId] ?? 'to_be_confirmed';
          const cfg = SO_STATUS_COLORS[status] ?? SO_STATUS_COLORS.to_be_confirmed;

          return (
            <div key={so.soId} className="border-b border-line/50 last:border-0">
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] font-bold text-t3">{so.soId}</span>
                    <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{so.paragraph}</span>
                  </div>
                  <p className="text-[12px] font-medium text-t1">{so.requirement}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {savingId === so.soId && <Loader2 className="h-3.5 w-3.5 animate-spin text-t5" />}
                  <button
                    type="button"
                    onClick={() => setOpen(v => !v)}
                    className="text-t5 hover:text-t2"
                  >
                    {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Status buttons */}
              <div className="flex flex-wrap gap-1 px-4 pb-2.5">
                {(Object.keys(SO_STATUS_COLORS) as P10StrengthRegisterEntry['status'][]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleStatus(so.soId, s)}
                    disabled={savingId === so.soId}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
                      status === s
                        ? `${SO_STATUS_COLORS[s].bg} ${SO_STATUS_COLORS[s].text}`
                        : 'bg-surf3 text-t5 hover:bg-surf2 hover:text-t2'
                    }`}
                  >
                    {SO_STATUS_COLORS[s].icon}
                    {s === 'to_be_confirmed' ? 'Pending' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>

              {open && (
                <div className="border-t border-line/40 bg-surf/60 px-4 pb-4 pt-3 ml-4 space-y-2.5">
                  <div>
                    <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-t5">Threshold (compliance floor)</p>
                    <p className="text-[11.5px] text-t4">{so.threshold}</p>
                  </div>
                  <div>
                    <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-t5">Strength description</p>
                    <p className="text-[12px] text-t1">{so.strengthDescription}</p>
                  </div>
                  <div>
                    <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-t5">Evidence required</p>
                    <p className="text-[12px] text-t2">{so.evidenceRequired}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section C — Weakness Risk Register ────────────────────────────────────────

function SectionC({ rows }: { rows: P10WeaknessRisk[] }) {
  return (
    <div className={card}>
      {rows.map(wr => {
        const [open, setOpen] = useState(false);
        const [mitigated, setMitigated] = useState(false);
        return (
          <div key={wr.wrId} className={`border-b border-line/50 last:border-0 ${mitigated ? 'opacity-60' : ''}`}>
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surf2 transition-colors"
            >
              <ShieldAlert className={`mt-0.5 h-4 w-4 flex-shrink-0 ${mitigated ? 'text-[#166534]' : 'text-[#DC2626]'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{wr.wrId}</span>
                  {mitigated && (
                    <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#166534]">Mitigated</span>
                  )}
                </div>
                <p className="text-[12.5px] font-medium text-t1">{wr.riskDescription}</p>
              </div>
              <span className="flex-shrink-0 text-t5">
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </button>
            {open && (
              <div className="border-t border-line/40 bg-surf/60 px-4 pb-4 pt-3 ml-7 space-y-2.5">
                <div>
                  <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-t5">Trigger</p>
                  <p className="text-[12px] text-t3">{wr.trigger}</p>
                </div>
                <div>
                  <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-t5">Effect</p>
                  <p className="text-[12px] text-[#7F1D1D]">{wr.effect}</p>
                </div>
                <div>
                  <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-t5">Guard action</p>
                  <p className="text-[12px] text-t2">{wr.guardAction}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMitigated(v => !v)}
                  className={`rounded px-3 py-1 text-[11px] font-semibold transition-colors ${
                    mitigated
                      ? 'bg-[#DCFCE7] text-[#166534] hover:bg-[#BBF7D0]'
                      : 'bg-surf3 text-t3 hover:bg-surf2'
                  }`}
                >
                  {mitigated ? 'Mark as open' : 'Mark as mitigated'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Section D — Administrative Compliance Checklist ───────────────────────────

function SectionD({ rows }: { rows: P10AdminChecklist[] }) {
  const [statuses, setStatuses] = useState<Record<string, P10AdminChecklist['status']>>(
    () => Object.fromEntries(rows.map(r => [r.acId, r.status ?? 'to_be_confirmed']))
  );

  const counts = {
    confirmed: Object.values(statuses).filter(s => s === 'confirmed').length,
    pending:   Object.values(statuses).filter(s => s === 'to_be_confirmed').length,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-[11px]">
        <span className="font-semibold text-[#166534]">{counts.confirmed} Confirmed</span>
        <span className="font-semibold text-t4">{counts.pending} Pending</span>
      </div>
      <div className={card}>
        {rows.map(ac => {
          const status = statuses[ac.acId] ?? 'to_be_confirmed';
          const cfg = AC_STATUS_COLORS[status] ?? AC_STATUS_COLORS.to_be_confirmed;
          return (
            <div key={ac.acId} className="flex items-start gap-3 border-b border-line/50 last:border-0 px-4 py-3">
              <button
                type="button"
                onClick={() => setStatuses(prev => ({
                  ...prev,
                  [ac.acId]: status === 'confirmed' ? 'to_be_confirmed' : 'confirmed'
                }))}
                className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                  status === 'confirmed'
                    ? 'bg-[#166534] border-[#166534] text-white'
                    : 'border-line bg-surf hover:border-t3'
                }`}
              >
                {status === 'confirmed' && <CheckCircle2 className="h-3 w-3" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                  <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{ac.acId}</span>
                  <span className="text-[10px] text-t5">{ac.responsible}</span>
                </div>
                <p className="text-[12px] text-t1">{ac.requirement}</p>
                <p className="text-[10.5px] text-t5 mt-0.5">{ac.source}</p>
              </div>
              <span className={`flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Executive Summary ──────────────────────────────────────────────────────────

function ExecSummary({ summary }: { summary: NonNullable<FSEAMatrixPanelProps['executiveSummary']> }) {
  const stats = [
    { label: 'Req candidates', value: summary.requirementsTotal },
    { label: 'Actionable', value: summary.requirementsActionable },
    { label: 'Discarded', value: summary.requirementsDiscarded },
    { label: 'Strength opps', value: summary.strengthOpportunities },
    { label: 'Weakness risks', value: summary.weaknessRisks },
    { label: 'Cross-refs', value: summary.crossReferencesResolved },
    { label: 'Citations', value: summary.regulatoryCitationsRegistered },
    { label: 'Admin items', value: summary.adminComplianceItems },
  ].filter(s => s.value != null && s.value > 0);

  return (
    <div className={`${card} space-y-4 px-5 py-4`}>
      {/* Stats grid */}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {stats.map(s => (
          <div key={s.label}>
            <p className={eyebrow}>{s.label}</p>
            <p className="mt-0.5 text-[20px] font-bold text-t1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Page budget */}
      {summary.pageBudget && summary.pageBudget.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[9px] uppercase tracking-wide text-t5">Page budget</p>
          <div className="flex flex-wrap gap-2">
            {summary.pageBudget.map(b => (
              <span key={b.volume} className="rounded bg-surf3 px-2 py-1 text-[11px]">
                <span className="font-semibold text-t2">{b.volume}</span>
                <span className="ml-1.5 text-t4">{b.pagesMin}–{b.pagesMax} pages</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Highest-leverage action */}
      {summary.highestLeverageAction && (
        <div className="flex gap-3 rounded-lg border border-navy/20 bg-navy/5 px-3 py-2.5">
          <BookOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-navy" />
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wide text-navy">Highest-leverage action</p>
            <p className="mt-0.5 text-[12px] text-t1">{summary.highestLeverageAction}</p>
          </div>
        </div>
      )}

      {/* Critical actions */}
      {summary.criticalActions && summary.criticalActions.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-t5">Critical pre-draft actions</p>
          <ol className="space-y-1">
            {summary.criticalActions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-t2">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-surf3 font-mono text-[9px] font-bold text-t4 mt-0.5">
                  {i + 1}
                </span>
                {a}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Section tab bar ────────────────────────────────────────────────────────────

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'A', label: 'Section A', icon: <LayoutGrid className="h-3.5 w-3.5" />,   desc: 'Evaluation Matrix' },
  { id: 'B', label: 'Section B', icon: <TrendingUp className="h-3.5 w-3.5" />,   desc: 'Strength Register' },
  { id: 'C', label: 'Section C', icon: <ShieldAlert className="h-3.5 w-3.5" />,  desc: 'Weakness Register' },
  { id: 'D', label: 'Section D', icon: <ClipboardCheck className="h-3.5 w-3.5" />, desc: 'Compliance Checklist' },
];

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function FSEAMatrixPanel({
  sectionA,
  sectionB,
  sectionC,
  sectionD,
  executiveSummary,
  solId,
  saveChecklistStatusAction,
}: FSEAMatrixPanelProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('A');

  if (!sectionA || sectionA.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line bg-surf px-6 py-12 text-center">
        <LayoutGrid className="h-8 w-8 text-t5" />
        <p className="mt-3 text-[13px] text-t4">
          No evaluation matrix yet. Run the pipeline to generate all four matrix sections.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Executive summary */}
      {executiveSummary && <ExecSummary summary={executiveSummary} />}

      {/* Section nav */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11.5px] font-semibold transition-colors ${
              activeSection === s.id
                ? 'bg-navy text-white'
                : 'bg-surf3 text-t3 hover:bg-surf2 hover:text-t1'
            }`}
          >
            {s.icon}
            <span>{s.label}</span>
            <span className={`text-[10px] font-normal ${activeSection === s.id ? 'text-white/70' : 'text-t5'}`}>
              {s.desc}
            </span>
          </button>
        ))}
      </div>

      {/* Section content */}
      {activeSection === 'A' && <SectionA rows={sectionA} />}
      {activeSection === 'B' && (
        <SectionB rows={sectionB} solId={solId} saveStatusAction={saveChecklistStatusAction} />
      )}
      {activeSection === 'C' && <SectionC rows={sectionC} />}
      {activeSection === 'D' && <SectionD rows={sectionD} />}
    </div>
  );
}
