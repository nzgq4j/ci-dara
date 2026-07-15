'use client';

// Evaluation sub-panel for the Compliance tab.
//
// Shows a structured breakdown of evaluation criteria drawn exclusively from the shredded
// Section L instructions (source='instruction') and Section M evaluation factors
// (source='evaluation_factor'). Section M factors are the top-level entries; each factor card
// lists the Section L instructions that feed it via their governingFactors linkage.
// Instructions with no factor link are collected in an "Unlinked Instructions" bucket so
// nothing is silently dropped.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, BookOpen, ClipboardList } from 'lucide-react';
import { card, eyebrow, sectionTitle } from '@/components/dara/theme';
import RequirementDetail, { type RequirementDetailData } from '@/components/dara/RequirementDetail';

export interface EvalRow {
  id: string;
  name: string;
  citation: string;
  source: string;           // 'instruction' | 'evaluation_factor'
  disposition: string;      // 'scored' | 'compliance' | 'administrative'
  governingFactors: string[];
  notes: string;
  detail?: RequirementDetailData;
}

// ── helpers ────────────────────────────────────────────────────────────────────

const FACTOR_CHIP = 'inline-flex items-center rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-navy';
const INST_CHIP   = 'inline-flex items-center rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#92400E]';

function CitationBadge({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{text}</span>
  );
}

// ── Factor card ────────────────────────────────────────────────────────────────

function FactorCard({
  factor,
  instructions,
}: {
  factor: EvalRow | null; // null = the "Unlinked Instructions" pseudo-factor
  instructions: EvalRow[];
}) {
  const [open, setOpen] = useState(true);

  const isUnlinked = factor === null;
  const label = isUnlinked ? 'Unlinked Instructions' : factor.name;
  const citation = isUnlinked ? '' : factor.citation;

  return (
    <div className={`${card} overflow-hidden`}>
      {/* Factor header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surf2"
      >
        <span className="mt-0.5 flex-shrink-0 text-t4">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {!isUnlinked && (
              <span className={FACTOR_CHIP}>
                <BookOpen className="mr-1 h-2.5 w-2.5" />
                Section M
              </span>
            )}
            {isUnlinked && (
              <span className="inline-flex items-center gap-1 rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-t4">
                <AlertCircle className="h-2.5 w-2.5" />
                No factor link
              </span>
            )}
            <CitationBadge text={citation} />
          </div>
          <p className="mt-1 text-[13px] font-semibold text-t1">{label}</p>
          {!isUnlinked && factor!.detail?.description && (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-t4">
              {factor!.detail.description}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 text-right">
          <span className="font-mono text-[11px] text-t5">
            {instructions.length} instruction{instructions.length === 1 ? '' : 's'}
          </span>
        </div>
      </button>

      {/* Instructions under this factor */}
      {open && instructions.length > 0 && (
        <div className="border-t border-line divide-y divide-line/60">
          {instructions.map((inst) => (
            <div key={inst.id} className="flex items-start gap-3 px-4 py-2.5 pl-11">
              <span className={`mt-0.5 flex-shrink-0 ${INST_CHIP}`}>
                <ClipboardList className="mr-1 h-2.5 w-2.5" />
                Sec L
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CitationBadge text={inst.citation} />
                </div>
                {inst.detail ? (
                  <RequirementDetail detail={inst.detail}>
                    <span className="mt-0.5 cursor-pointer text-[12.5px] leading-snug text-t2 hover:underline">
                      {inst.name}
                    </span>
                  </RequirementDetail>
                ) : (
                  <p className="mt-0.5 text-[12.5px] leading-snug text-t2">{inst.name}</p>
                )}
                {inst.detail?.description && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-t5">
                    {inst.detail.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && instructions.length === 0 && !isUnlinked && (
        <div className="border-t border-line px-4 py-3 pl-11 text-[11.5px] text-t5">
          No Section L instructions linked to this factor.
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function EvaluationPanel({ rows }: { rows: EvalRow[] }) {
  const { factors, instructionsByFactor, unlinked } = useMemo(() => {
    const evalFactors = rows.filter((r) => r.source === 'evaluation_factor');
    const instructions = rows.filter((r) => r.source === 'instruction');

    // Build a lookup: normalised factor label → EvalRow for the factor itself.
    // The governingFactors strings on instructions may not be an exact key match
    // (they come from the AI), so we do a case-insensitive substring check as fallback.
    const factorByLabel = new Map<string, EvalRow>();
    for (const f of evalFactors) {
      factorByLabel.set(f.name.trim().toLowerCase(), f);
      if (f.citation) factorByLabel.set(f.citation.trim().toLowerCase(), f);
    }

    const resolve = (label: string): EvalRow | undefined => {
      const key = label.trim().toLowerCase();
      if (factorByLabel.has(key)) return factorByLabel.get(key);
      // Substring fallback — "Technical Approach" matches "Factor 1 – Technical Approach"
      let found: EvalRow | undefined;
      factorByLabel.forEach((v, k) => {
        if (!found && (k.includes(key) || key.includes(k))) found = v;
      });
      if (found) return found;
      return undefined;
    };

    // Map each Section M factor to the instructions that govern it.
    const instByFactorId = new Map<string, EvalRow[]>();
    const linkedInstIds = new Set<string>();

    for (const inst of instructions) {
      if (!inst.governingFactors || inst.governingFactors.length === 0) continue;
      for (const gfLabel of inst.governingFactors) {
        const factor = resolve(gfLabel);
        if (!factor) continue;
        const bucket = instByFactorId.get(factor.id) ?? [];
        if (!bucket.find((x) => x.id === inst.id)) bucket.push(inst);
        instByFactorId.set(factor.id, bucket);
        linkedInstIds.add(inst.id);
      }
    }

    const unlinkedInstructions = instructions.filter((i) => !linkedInstIds.has(i.id));

    return {
      factors: evalFactors,
      instructionsByFactor: instByFactorId,
      unlinked: unlinkedInstructions,
    };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line bg-surf px-6 py-12 text-center">
        <BookOpen className="h-8 w-8 text-t5" />
        <p className="mt-3 text-[13px] text-t4">
          No evaluation criteria yet. Generate the compliance matrix from the solicitation first.
        </p>
      </div>
    );
  }

  const factorCount = factors.length;
  const instructionCount = rows.filter((r) => r.source === 'instruction').length;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className={`${card} flex flex-wrap items-center gap-6 px-5 py-3`}>
        <div>
          <p className={eyebrow}>Evaluation factors</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{factorCount}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <p className={eyebrow}>Section L instructions</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{instructionCount}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <p className={eyebrow}>Instructions linked to a factor</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">
            {instructionCount - unlinked.length}
            <span className="ml-1 text-[13px] font-normal text-t4">/ {instructionCount}</span>
          </p>
        </div>
        {unlinked.length > 0 && (
          <>
            <div className="h-8 w-px bg-line" />
            <div className="flex items-center gap-1.5 text-[12px] text-[#92400E]">
              <AlertCircle className="h-3.5 w-3.5" />
              {unlinked.length} instruction{unlinked.length === 1 ? '' : 's'} with no factor link
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[11px] text-t4">
        <span className="flex items-center gap-1.5">
          <span className={FACTOR_CHIP}><BookOpen className="mr-1 h-2.5 w-2.5" />Section M</span>
          Evaluation factor (scored by the Government)
        </span>
        <span className="text-t5">·</span>
        <span className="flex items-center gap-1.5">
          <span className={INST_CHIP}><ClipboardList className="mr-1 h-2.5 w-2.5" />Sec L</span>
          Proposal preparation instruction
        </span>
      </div>

      {/* Factor cards */}
      <div className="space-y-3">
        {factors.length === 0 && (
          <div className={`${card} px-5 py-4 text-[12.5px] text-t4`}>
            No Section M evaluation factors found. The shred may not have identified any factors
            in this solicitation, or the base RFP has not been processed yet.
          </div>
        )}
        {factors.map((f) => (
          <FactorCard
            key={f.id}
            factor={f}
            instructions={instructionsByFactor.get(f.id) ?? []}
          />
        ))}
        {unlinked.length > 0 && (
          <FactorCard factor={null} instructions={unlinked} />
        )}
      </div>
    </div>
  );
}
