'use client';

// Writing Plan — Section A of the FSEA output reorganized as a paragraph-by-paragraph
// writing instrument. Shows each critical paragraph with its page budget, internal writing
// sequence, and the full matrix of requirements in the sequence they should be drafted.

import { useState } from 'react';
import { FileText, ChevronDown, ChevronRight, BookOpen, Clock, ArrowRight } from 'lucide-react';
import { card, eyebrow } from '@/components/dara/theme';
import type { P10MatrixRow, P10WritingSequence } from '@/utils/dara/fsea/types';

export interface WritingPlanProps {
  sectionA: P10MatrixRow[];
  paragraphWritingSequences: P10WritingSequence[];
  pageBudget: { volume: string; pagesMin: number; pagesMax: number }[];
  executiveSummary?: {
    requirementsActionable?: number;
    strengthOpportunities?: number;
    criticalActions?: string[];
    highestLeverageAction?: string;
  } | null;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  lead:          { bg: 'bg-navy/10', text: 'text-navy', label: 'Lead statement' },
  high:          { bg: 'bg-[#FEF3C7]', text: 'text-[#92400E]', label: 'High' },
  medium:        { bg: 'bg-surf3', text: 'text-t3', label: 'Medium' },
  low:           { bg: 'bg-surf3', text: 'text-t5', label: 'Low' },
  checklist_only:{ bg: 'bg-surf3', text: 'text-t5', label: 'Checklist' },
};

function MatrixRow({ row }: { row: P10MatrixRow }) {
  const [open, setOpen] = useState(false);
  const priority = PRIORITY_COLORS[row.priority ?? 'medium'] ?? PRIORITY_COLORS.medium;

  return (
    <div className="border-b border-line/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surf2 transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0 text-t5">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{row.reqId}</span>
            <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${priority.bg} ${priority.text}`}>
              {row.pageSignal ?? priority.label}
            </span>
            {row.strengthGate && (
              <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#166534]">
                {row.strengthGate}
              </span>
            )}
            {row.evaluationCriterion && (
              <span className="rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[9px] text-navy">
                {row.evaluationCriterion}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] font-medium text-t2">{row.requirement}</p>
          {!open && row.proposalResponseObligation && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-t4">{row.proposalResponseObligation}</p>
          )}
        </div>
      </button>

      {open && row.proposalResponseObligation && (
        <div className="border-t border-line/40 bg-surf/50 px-4 pb-4 pt-3 ml-7">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Proposal response obligation</p>
          <p className="text-[12.5px] leading-relaxed text-t1">{row.proposalResponseObligation}</p>
          {row.crossReference && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-t4">
              <ArrowRight className="h-3 w-3" />
              <span>Cross-reference: {row.crossReference}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParagraphCard({
  paragraphId,
  rows,
  sequence,
  budget,
}: {
  paragraphId: string;
  rows: P10MatrixRow[];
  sequence?: P10WritingSequence;
  budget?: { pagesMin: number; pagesMax: number };
}) {
  const [open, setOpen] = useState(true);
  const highCount = rows.filter(r => r.priority === 'lead' || r.priority === 'high').length;

  return (
    <div className={`${card} overflow-hidden`}>
      {/* Paragraph header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surf2 transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0 text-t4">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-navy">
              <FileText className="h-2.5 w-2.5" />
              {paragraphId}
            </span>
            {budget && (
              <span className="inline-flex items-center gap-1 rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">
                <Clock className="h-2.5 w-2.5" />
                {budget.pagesMin}–{budget.pagesMax} pages
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-mono text-[11px] text-t4">{rows.length} requirements</span>
            {highCount > 0 && (
              <span className="font-mono text-[11px] text-[#92400E]">{highCount} high priority</span>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-line">
          {/* Writing sequence */}
          {sequence && sequence.sequence.length > 0 && (
            <div className="border-b border-line bg-surf/50 px-4 py-3">
              <p className="mb-2 font-mono text-[9px] uppercase tracking-wide text-t5">Writing sequence</p>
              <ol className="space-y-1">
                {sequence.sequence.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11.5px] text-t3">
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-surf3 font-mono text-[9px] font-bold text-t4 mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Requirement rows in sequence order */}
          <div>
            {[...rows]
              .sort((a, b) => (a.writingSequenceOrder ?? 999) - (b.writingSequenceOrder ?? 999))
              .map(row => <MatrixRow key={row.reqId} row={row} />)
            }
          </div>
        </div>
      )}
    </div>
  );
}

export default function WritingPlan({
  sectionA,
  paragraphWritingSequences,
  pageBudget,
  executiveSummary,
}: WritingPlanProps) {
  if (!sectionA || sectionA.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line bg-surf px-6 py-12 text-center">
        <FileText className="h-8 w-8 text-t5" />
        <p className="mt-3 text-[13px] text-t4">
          No writing plan yet. Run the pipeline to generate the Evaluation Matrix and Writing Plan.
        </p>
      </div>
    );
  }

  // Group rows by paragraph
  const byParagraph = sectionA.reduce<Record<string, P10MatrixRow[]>>((acc, row) => {
    const p = row.paragraphId ?? 'Other';
    if (!acc[p]) acc[p] = [];
    acc[p].push(row);
    return acc;
  }, {});

  const seqByParagraph = new Map(
    (paragraphWritingSequences ?? []).map(s => [s.paragraphId, s])
  );
  const budgetByParagraph = new Map(
    (pageBudget ?? []).map(b => [b.volume, b])
  );

  const totalPagesMin = (pageBudget ?? []).reduce((s, b) => s + (b.pagesMin ?? 0), 0);
  const totalPagesMax = (pageBudget ?? []).reduce((s, b) => s + (b.pagesMax ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className={`${card} flex flex-wrap items-center gap-6 px-5 py-3`}>
        <div>
          <p className={eyebrow}>Actionable requirements</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{sectionA.length}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <p className={eyebrow}>Paragraphs</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{Object.keys(byParagraph).length}</p>
        </div>
        {totalPagesMin > 0 && (
          <>
            <div className="h-8 w-px bg-line" />
            <div>
              <p className={eyebrow}>Total page budget</p>
              <p className="mt-0.5 text-[22px] font-bold text-t1">
                {totalPagesMin}–{totalPagesMax}
                <span className="ml-1 text-[13px] font-normal text-t4">pages</span>
              </p>
            </div>
          </>
        )}
      </div>

      {/* Executive summary critical actions */}
      {executiveSummary?.highestLeverageAction && (
        <div className="flex gap-3 rounded-[10px] border border-navy/20 bg-navy/5 px-4 py-3">
          <BookOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-navy" />
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wide text-navy">Highest-leverage action before drafting</p>
            <p className="mt-1 text-[12.5px] text-t1">{executiveSummary.highestLeverageAction}</p>
          </div>
        </div>
      )}

      {executiveSummary?.criticalActions && executiveSummary.criticalActions.length > 0 && (
        <div className={`${card} px-4 py-3`}>
          <p className="mb-2 font-mono text-[9px] uppercase tracking-wide text-t5">Critical actions before drafting</p>
          <ol className="space-y-1.5">
            {executiveSummary.criticalActions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-t2">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-surf3 font-mono text-[9px] font-bold text-t4 mt-0.5">
                  {i + 1}
                </span>
                {action}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Paragraph cards */}
      <div className="space-y-3">
        {Object.entries(byParagraph).map(([paragraphId, rows]) => (
          <ParagraphCard
            key={paragraphId}
            paragraphId={paragraphId}
            rows={rows}
            sequence={seqByParagraph.get(paragraphId)}
            budget={budgetByParagraph.get(paragraphId)}
          />
        ))}
      </div>
    </div>
  );
}
