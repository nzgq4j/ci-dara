'use client';

// Sub-tab switcher for the Compliance panel.
// Renders two tabs: "Matrix" (the full filterable compliance matrix) and
// "Evaluation Criteria" (the EvaluationPanel factor/instruction breakdown).

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import ComplianceMatrix, { type MatrixRowData } from '@/components/dara/ComplianceMatrix';
import EvaluationPanel, { type EvalRow } from '@/components/dara/EvaluationPanel';
import { card, cardDashed } from '@/components/dara/theme';

const TABS = [
  { id: 'matrix', label: 'Compliance Matrix' },
  { id: 'evaluation', label: 'Evaluation Criteria' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ComplianceSubTabs({
  sid,
  matrixRows,
  evalRows,
  requirementsCount,
  saveAction,
  setReviewStatusAction,
}: {
  sid: string;
  matrixRows: MatrixRowData[];
  evalRows: EvalRow[];
  requirementsCount: number;
  saveAction: (fd: FormData) => Promise<{ ok: boolean }>;
  setReviewStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
}) {
  const [active, setActive] = useState<TabId>('matrix');

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`relative -mb-px px-4 py-2 text-[12.5px] font-semibold transition-colors ${
              active === tab.id
                ? 'border-b-2 border-navy text-navy'
                : 'text-t4 hover:text-t1'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Matrix tab */}
      {active === 'matrix' && (
        requirementsCount === 0 ? (
          <div className={`${cardDashed} flex flex-col items-center justify-center px-6 py-10 text-center`}>
            <Inbox className="h-8 w-8 text-t5" />
            <p className="mt-3 text-[13px] text-t4">
              No requirements yet. Generate them from the solicitation above, or add one manually below.
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

      {/* Evaluation Criteria tab */}
      {active === 'evaluation' && (
        <EvaluationPanel rows={evalRows} />
      )}
    </div>
  );
}
