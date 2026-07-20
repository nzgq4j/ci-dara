'use client';

// Compliance panel sub-tab switcher.
// Two tabs, both driven directly by dara_requirements rows produced by the shred (runShred):
//   Matrix     — every requirement candidate the shred classified (source / disposition / citation).
//   Evaluation — the Section M evaluation factors (source='evaluation_factor') and the L→M links
//                (each requirement's governingFactors) the shred assigned.
// No secondary pipeline panels, no output blob — the matrix IS the deliverable.

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import ComplianceMatrix, { type MatrixRowData } from '@/components/dara/ComplianceMatrix';
import EvaluationPanel, { type EvalRow } from '@/components/dara/EvaluationPanel';
import { card, cardDashed } from '@/components/dara/theme';

const TABS = [
  { id: 'matrix', label: 'Matrix' },
  { id: 'evaluation', label: 'Evaluation' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ComplianceSubTabs({
  sid,
  matrixRows,
  evalRows,
  requirementsCount,
  saveAction,
  setReviewStatusAction,
  saveGoverningFactorsAction,
}: {
  sid: string;
  matrixRows: MatrixRowData[];
  evalRows: EvalRow[];
  requirementsCount: number;
  saveAction: (fd: FormData) => Promise<{ ok: boolean }>;
  setReviewStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
  saveGoverningFactorsAction?: (fd: FormData) => Promise<{ ok: boolean }>;
}) {
  const [active, setActive] = useState<TabId>('matrix');

  return (
    <div className="space-y-3">
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
          </button>
        ))}
      </div>

      {/* Matrix */}
      {active === 'matrix' && (
        requirementsCount === 0 ? (
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

      {/* Evaluation — Section M factors + L→M links */}
      {active === 'evaluation' && (
        <EvaluationPanel
          rows={evalRows}
          solId={sid}
          saveGoverningFactorsAction={saveGoverningFactorsAction}
        />
      )}
    </div>
  );
}
