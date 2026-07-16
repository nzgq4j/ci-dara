'use client';

// Weakness Register — Section C of the FSEA pipeline output.
//
// Displays all identified weakness risks with their triggers, effects,
// and guard actions. Read-only — these are pipeline-derived, not editable.
// Users mark each risk as mitigated once they have verified the guard action.

import { useState } from 'react';
import { ShieldAlert, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { card, eyebrow } from '@/components/dara/theme';
import type { P10WeaknessRisk } from '@/utils/dara/fsea/types';

export interface WeaknessRegisterProps {
  sectionC: P10WeaknessRisk[];
}

function WRCard({ wr }: { wr: P10WeaknessRisk }) {
  const [open, setOpen] = useState(false);
  const [mitigated, setMitigated] = useState(false);

  return (
    <div className={`${card} overflow-hidden transition-opacity ${mitigated ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surf2 transition-colors"
      >
        <span className={`mt-0.5 flex-shrink-0 ${mitigated ? 'text-[#166534]' : 'text-[#DC2626]'}`}>
          {mitigated
            ? <ShieldCheck className="h-4 w-4" />
            : <ShieldAlert className="h-4 w-4" />
          }
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{wr.wrId}</span>
            {mitigated && (
              <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#166534]">Mitigated</span>
            )}
          </div>
          <p className="mt-1 text-[13px] font-semibold text-t1">{wr.riskDescription}</p>
          {!open && (
            <p className="mt-0.5 line-clamp-1 text-[11.5px] text-t4">Trigger: {wr.trigger}</p>
          )}
        </div>
        <span className="flex-shrink-0 text-t5">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-line/60 border-t border-line">
          <div className="px-4 py-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Trigger</p>
            <p className="text-[12px] text-t3">{wr.trigger}</p>
          </div>
          <div className="px-4 py-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Effect</p>
            <p className="text-[12px] text-[#7F1D1D]">{wr.effect}</p>
          </div>
          <div className="px-4 py-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Guard action</p>
            <p className="text-[12px] text-t2">{wr.guardAction}</p>
          </div>
          <div className="px-4 py-2.5">
            <button
              type="button"
              onClick={() => setMitigated(v => !v)}
              className={`rounded px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                mitigated
                  ? 'bg-[#DCFCE7] text-[#166534] hover:bg-[#BBF7D0]'
                  : 'bg-surf3 text-t3 hover:bg-surf2'
              }`}
            >
              {mitigated ? 'Mark as open' : 'Mark as mitigated'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WeaknessRegister({ sectionC }: WeaknessRegisterProps) {
  if (!sectionC || sectionC.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line bg-surf px-6 py-12 text-center">
        <ShieldAlert className="h-8 w-8 text-t5" />
        <p className="mt-3 text-[13px] text-t4">
          No weakness risks identified yet. Run the pipeline to generate the Weakness Register.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={`${card} flex flex-wrap items-center gap-6 px-5 py-3`}>
        <div>
          <p className={eyebrow}>Weakness risks identified</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{sectionC.length}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <p className="text-[12px] text-t4 max-w-sm">
          Each risk has a trigger, a rating consequence, and a guard action. Mark risks mitigated after applying the guard action.
        </p>
      </div>

      {/* Risk cards */}
      <div className="space-y-2">
        {sectionC.map(wr => <WRCard key={wr.wrId} wr={wr} />)}
      </div>
    </div>
  );
}
