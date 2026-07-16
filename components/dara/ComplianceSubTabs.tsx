'use client';

// Compliance panel sub-tab switcher.
// Five tabs: Matrix, Writing Plan, Strength Guide, Weakness Register, Evaluation.
//
// Matrix tab: FSEAMatrixPanel when pipeline has run (all 4 sections A-D),
//             legacy ComplianceMatrix otherwise.
// Evaluation tab: FSEAEvaluationPanel when ontology exists, legacy EvaluationPanel otherwise.

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import ComplianceMatrix, { type MatrixRowData } from '@/components/dara/ComplianceMatrix';
import EvaluationPanel, { type EvalRow } from '@/components/dara/EvaluationPanel';
import FSEAEvaluationPanel, { type FSEAEvalOntology, type FSEAEvalRequirement } from '@/components/dara/FSEAEvaluationPanel';
import FSEAMatrixPanel from '@/components/dara/FSEAMatrixPanel';
import StrengthGuide from '@/components/dara/StrengthGuide';
import WeaknessRegister from '@/components/dara/WeaknessRegister';
import WritingPlan from '@/components/dara/WritingPlan';
import { card, cardDashed } from '@/components/dara/theme';
import type {
  P10MatrixRow, P10StrengthRegisterEntry, P10WeaknessRisk, P10AdminChecklist,
  P10WritingSequence, P4Factor, P4Criterion, P4EvalSurface, P4ConstructObject
} from '@/utils/dara/fsea/types';

export interface FseaOutput {
  partial?: boolean;
  error?: string;
  sectionB?: P10StrengthRegisterEntry[];
  sectionC?: P10WeaknessRisk[];
  sectionD?: P10AdminChecklist[];
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
  paragraphWritingSequences?: P10WritingSequence[];
  pageBudget?: { volume: string; pagesMin: number; pagesMax: number }[];
  strengthSummary?: { top5?: { rank: number; soId: string; paragraph: string; impact: string }[] } | null;
  criticalGapAdvisory?: string | null;
  evalOntology?: {
    factors: P4Factor[];
    criteria: P4Criterion[];
    evaluationSurface: P4EvalSurface[];
    constructs: P4ConstructObject[];
  } | null;
}

const TABS = [
  { id: 'matrix',     label: 'Matrix' },
  { id: 'writing',    label: 'Writing Plan' },
  { id: 'strengths',  label: 'Strengths' },
  { id: 'weaknesses', label: 'Risks' },
  { id: 'evaluation', label: 'Evaluation' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function TabBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-1.5 rounded-full bg-surf3 px-1.5 py-0.5 font-mono text-[9px] font-bold text-t4">
      {count}
    </span>
  );
}

export default function ComplianceSubTabs({
  sid,
  matrixRows,
  sectionARows,
  evalRows,
  requirementsCount,
  saveAction,
  setReviewStatusAction,
  saveGoverningFactorsAction,
  fseaOutput,
}: {
  sid: string;
  matrixRows: MatrixRowData[];
  sectionARows?: P10MatrixRow[];
  evalRows: EvalRow[];
  requirementsCount: number;
  saveAction: (fd: FormData) => Promise<{ ok: boolean }>;
  setReviewStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
  saveGoverningFactorsAction?: (fd: FormData) => Promise<{ ok: boolean }>;
  fseaOutput?: FseaOutput | null;
}) {
  const [active, setActive] = useState<TabId>('matrix');

  const sectionB = fseaOutput?.sectionB ?? [];
  const sectionC = fseaOutput?.sectionC ?? [];
  const sectionD = fseaOutput?.sectionD ?? [];
  const writingRows = sectionARows ?? [];
  const pageBudget = fseaOutput?.pageBudget ?? [];
  const sequences = fseaOutput?.paragraphWritingSequences ?? [];
  const top5 = fseaOutput?.strengthSummary?.top5 ?? [];
  const advisory = fseaOutput?.criticalGapAdvisory ?? null;
  const evalOntology = fseaOutput?.evalOntology ?? null;
  const hasFseaMatrix = writingRows.length > 0;
  const hasFseaOntology = evalOntology && (evalOntology.factors?.length ?? 0) > 0;

  // Build requirement rows for FSEAEvaluationPanel from Section A data
  const fseaEvalRequirements: FSEAEvalRequirement[] = writingRows.map(row => ({
    id: row.reqId,
    reqId: row.reqId,
    paragraphId: row.paragraphId,
    requirement: row.requirement,
    proposalResponseObligation: row.proposalResponseObligation,
    evaluationCriterion: row.evaluationCriterion ?? '',
    governingCriteriaIds: row.evaluationCriterion ? [row.evaluationCriterion] : [],
    pageSignal: row.pageSignal ?? '',
    priority: row.priority ?? 'medium',
    strengthGate: row.strengthGate ?? null,
  }));

  return (
    <div className="space-y-3">
      {/* Pipeline error/partial banner */}
      {fseaOutput?.partial && fseaOutput.error && (
        <div className="rounded-[10px] border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[12px] text-[#7F1D1D]">
          <span className="font-semibold">Pipeline incomplete:</span> {fseaOutput.error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-line overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`relative -mb-px flex-shrink-0 px-3.5 py-2 text-[12px] font-semibold transition-colors ${
              active === tab.id
                ? 'border-b-2 border-navy text-navy'
                : 'text-t4 hover:text-t1'
            }`}
          >
            {tab.label}
            {tab.id === 'strengths' && <TabBadge count={sectionB.length} />}
            {tab.id === 'weaknesses' && <TabBadge count={sectionC.length} />}
            {tab.id === 'writing' && <TabBadge count={writingRows.length} />}
          </button>
        ))}
      </div>

      {/* Matrix — FSEA 4-section panel when pipeline has run, legacy table otherwise */}
      {active === 'matrix' && (
        hasFseaMatrix ? (
          <FSEAMatrixPanel
            sectionA={writingRows}
            sectionB={sectionB}
            sectionC={sectionC}
            sectionD={sectionD}
            executiveSummary={fseaOutput?.executiveSummary}
            solId={sid}
          />
        ) : requirementsCount === 0 ? (
          <div className={`${cardDashed} flex flex-col items-center justify-center px-6 py-10 text-center`}>
            <Inbox className="h-8 w-8 text-t5" />
            <p className="mt-3 text-[13px] text-t4">
              No requirements yet. Generate from the solicitation above.
            </p>
          </div>
        ) : (
          <div className={`${card} p-4`}>
            <ComplianceMatrix
              solId={sid}
              rows={matrixRows}
              saveAction={saveAction}
              setReviewStatusAction={setReviewStatusAction}
            />
          </div>
        )
      )}

      {/* Writing Plan */}
      {active === 'writing' && (
        <WritingPlan
          sectionA={writingRows}
          paragraphWritingSequences={sequences}
          pageBudget={pageBudget}
          executiveSummary={fseaOutput?.executiveSummary}
        />
      )}

      {/* Strength Guide */}
      {active === 'strengths' && (
        <StrengthGuide
          sectionB={sectionB}
          criticalGapAdvisory={advisory}
          top5={top5}
          solId={sid}
        />
      )}

      {/* Weakness Register */}
      {active === 'weaknesses' && (
        <WeaknessRegister sectionC={sectionC} />
      )}

      {/* Evaluation — FSEA ontology view or legacy panel */}
      {active === 'evaluation' && (
        hasFseaOntology ? (
          <FSEAEvaluationPanel
            ontology={evalOntology as FSEAEvalOntology}
            requirements={fseaEvalRequirements}
          />
        ) : (
          <EvaluationPanel
            rows={evalRows}
            solId={sid}
            saveGoverningFactorsAction={saveGoverningFactorsAction}
          />
        )
      )}
    </div>
  );
}
