'use client';

// Evaluation sub-panel for the Compliance tab.
//
// Shows Section M evaluation factors as collapsible cards with their linked Section L
// instructions underneath. Instructions with no factor link appear in an "Unlinked
// Instructions" bucket at the bottom and can be dragged onto any factor card to assign
// the link. The assignment saves immediately via saveGoverningFactorsAction, which
// updates the governingFactors column on the requirement row.
//
// Drag-and-drop uses the HTML5 drag API — no library dependency. Draggable instruction
// rows carry their requirement id; droppable factor cards accept the drop and call the
// save action with the new factor label appended to the instruction's governing_factors.

import { useMemo, useState, useTransition, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, AlertCircle, BookOpen, ClipboardList, GripVertical, Loader2, Check, X } from 'lucide-react';
import { card, eyebrow } from '@/components/dara/theme';
import RequirementDetail, { type RequirementDetailData } from '@/components/dara/RequirementDetail';

export interface EvalRow {
  id: string;
  name: string;
  citation: string;
  source: string;
  disposition: string;
  governingFactors: string[];
  notes: string;
  detail?: RequirementDetailData;
}

// ── design tokens ─────────────────────────────────────────────────────────────

const FACTOR_CHIP = 'inline-flex items-center rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-navy';
const INST_CHIP   = 'inline-flex items-center rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#92400E]';

function CitationBadge({ text }: { text: string }) {
  if (!text) return null;
  return <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{text}</span>;
}

// ── DraggableInstruction ───────────────────────────────────────────────────────

function DraggableInstruction({
  inst,
  onRemove,
  saving,
  saved,
}: {
  inst: EvalRow;
  onRemove?: () => void;
  saving?: boolean;
  saved?: boolean;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', inst.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group flex cursor-grab items-start gap-3 px-4 py-2.5 pl-10 active:cursor-grabbing"
    >
      <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-t5 opacity-0 transition-opacity group-hover:opacity-100" />
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
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {saving && <Loader2 className="h-3 w-3 animate-spin text-t5" />}
        {saved && !saving && <Check className="h-3 w-3 text-[#166534]" />}
        {onRemove && !saving && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove factor link"
            className="rounded p-0.5 text-t5 opacity-0 transition-opacity hover:text-[#991B1B] group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── FactorDropZone ─────────────────────────────────────────────────────────────

function FactorDropZone({
  factorLabel,
  factorId,
  factor,
  instructions,
  solId,
  saveAction,
  onAssign,
  onUnassign,
}: {
  factorLabel: string;
  factorId: string | null; // null = synthetic factor
  factor: EvalRow | null;
  instructions: EvalRow[];
  solId: string;
  saveAction?: (fd: FormData) => Promise<{ ok: boolean }>;
  onAssign: (instId: string, factorLabel: string) => void;
  onUnassign: (instId: string, factorLabel: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  };
  const handleDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const instId = e.dataTransfer.getData('text/plain');
    if (!instId || !saveAction) return;
    // Optimistically register assignment so UI updates immediately.
    onAssign(instId, factorLabel);
    setSavingId(instId);
    // Find the instruction's current governing_factors from the DOM data-gf attribute.
    const instEl = document.querySelector(`[data-inst-id="${instId}"]`);
    const currentGf: string[] = instEl
      ? JSON.parse(instEl.getAttribute('data-gf') || '[]')
      : [];
    const newGf = Array.from(new Set([...currentGf, factorLabel]));
    const fd = new FormData();
    fd.set('requirementId', instId);
    fd.set('solId', solId);
    fd.set('governingFactors', JSON.stringify(newGf));
    startTransition(async () => {
      const res = await saveAction(fd);
      setSavingId(null);
      if (res?.ok) {
        setSavedId(instId);
        setTimeout(() => setSavedId(null), 1500);
        router.refresh();
      }
    });
  }, [factorLabel, saveAction, solId, onAssign, router]);

  const handleUnassign = useCallback((inst: EvalRow) => {
    if (!saveAction) return;
    onUnassign(inst.id, factorLabel);
    setSavingId(inst.id);
    const newGf = inst.governingFactors.filter((f) => f !== factorLabel);
    const fd = new FormData();
    fd.set('requirementId', inst.id);
    fd.set('solId', solId);
    fd.set('governingFactors', JSON.stringify(newGf));
    startTransition(async () => {
      const res = await saveAction(fd);
      setSavingId(null);
      if (res?.ok) {
        setSavedId(inst.id);
        setTimeout(() => setSavedId(null), 1500);
        router.refresh();
      }
    });
  }, [factorLabel, saveAction, solId, onUnassign, router]);

  const isSynthetic = factorId === null && factor === null;
  const isUnlinked = factorId === 'unlinked';

  return (
    <div
      className={`${card} overflow-hidden transition-colors ${dragOver && !isUnlinked ? 'ring-2 ring-navy/30 ring-offset-1' : ''}`}
      onDragEnter={!isUnlinked ? handleDragEnter : undefined}
      onDragLeave={!isUnlinked ? handleDragLeave : undefined}
      onDragOver={!isUnlinked ? handleDragOver : undefined}
      onDrop={!isUnlinked ? handleDrop : undefined}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${dragOver && !isUnlinked ? 'bg-navy/5' : 'hover:bg-surf2'}`}
      >
        <span className="mt-0.5 flex-shrink-0 text-t4">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isUnlinked ? (
              <span className="inline-flex items-center gap-1 rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-t4">
                <AlertCircle className="h-2.5 w-2.5" />
                No factor link
              </span>
            ) : (
              <>
                <span className={FACTOR_CHIP}>
                  <BookOpen className="mr-1 h-2.5 w-2.5" />
                  Section M
                </span>
                {isSynthetic && (
                  <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#92400E]">
                    inferred
                  </span>
                )}
                {factor && <CitationBadge text={factor.citation} />}
              </>
            )}
          </div>
          <p className="mt-1 text-[13px] font-semibold text-t1">{factorLabel}</p>
          {factor?.detail?.description && (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-t4">
              {factor.detail.description}
            </p>
          )}
          {isSynthetic && (
            <p className="mt-0.5 text-[11px] text-t5">
              Factor identified from instruction linkage — not extracted as a standalone evaluation criterion
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
          <span className="font-mono text-[11px] text-t5">
            {instructions.length} instruction{instructions.length === 1 ? '' : 's'}
          </span>
          {!isUnlinked && dragOver && (
            <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-navy">
              Drop to assign
            </span>
          )}
          {!isUnlinked && !dragOver && saveAction && (
            <span className="font-mono text-[9px] text-t5">drag instructions here</span>
          )}
        </div>
      </button>

      {/* Instructions */}
      {open && (
        <div className="divide-y divide-line/60 border-t border-line">
          {instructions.map((inst) => (
            <div
              key={inst.id}
              data-inst-id={inst.id}
              data-gf={JSON.stringify(inst.governingFactors)}
            >
              <DraggableInstruction
                inst={inst}
                saving={savingId === inst.id}
                saved={savedId === inst.id}
                onRemove={!isUnlinked && saveAction ? () => handleUnassign(inst) : undefined}
              />
            </div>
          ))}
          {instructions.length === 0 && !isUnlinked && (
            <div className={`px-4 py-4 pl-10 text-[11.5px] text-t5 ${dragOver ? 'bg-navy/5' : ''}`}>
              {dragOver
                ? 'Release to assign this instruction to this factor'
                : saveAction
                  ? 'No instructions linked. Drag Section L instructions here to assign them.'
                  : 'No Section L instructions linked to this factor.'}
            </div>
          )}
          {instructions.length === 0 && isUnlinked && (
            <div className="px-4 py-3 pl-10 text-[11.5px] text-t5">
              All instructions are linked to a factor.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── EvaluationPanel ───────────────────────────────────────────────────────────

export default function EvaluationPanel({
  rows,
  solId,
  saveGoverningFactorsAction,
}: {
  rows: EvalRow[];
  solId?: string;
  saveGoverningFactorsAction?: (fd: FormData) => Promise<{ ok: boolean }>;
}) {
  // Local override map: { [requirementId]: string[] } for optimistic UI before server confirms.
  const [localGf, setLocalGf] = useState<Record<string, string[]>>({});

  const handleAssign = useCallback((instId: string, factorLabel: string) => {
    setLocalGf((prev) => {
      const current = prev[instId] ?? rows.find((r) => r.id === instId)?.governingFactors ?? [];
      return { ...prev, [instId]: Array.from(new Set([...current, factorLabel])) };
    });
  }, [rows]);

  const handleUnassign = useCallback((instId: string, factorLabel: string) => {
    setLocalGf((prev) => {
      const current = prev[instId] ?? rows.find((r) => r.id === instId)?.governingFactors ?? [];
      return { ...prev, [instId]: current.filter((f) => f !== factorLabel) };
    });
  }, [rows]);

  // Merge server-side governingFactors with local overrides.
  const effectiveRows = useMemo(() =>
    rows.map((r) => localGf[r.id] ? { ...r, governingFactors: localGf[r.id] } : r),
    [rows, localGf]
  );

  const { factors, instructionsByFactor, unlinked, syntheticFactors } = useMemo(() => {
    const evalFactors = effectiveRows.filter((r) => r.source === 'evaluation_factor');
    const instructions = effectiveRows.filter((r) => r.source === 'instruction');

    const factorByLabel = new Map<string, EvalRow>();
    for (const f of evalFactors) {
      factorByLabel.set(f.name.trim().toLowerCase(), f);
      if (f.citation) factorByLabel.set(f.citation.trim().toLowerCase(), f);
    }

    const resolve = (label: string): EvalRow | undefined => {
      const key = label.trim().toLowerCase();
      if (factorByLabel.has(key)) return factorByLabel.get(key);
      let found: EvalRow | undefined;
      factorByLabel.forEach((v, k) => {
        if (!found && (k.includes(key) || key.includes(k))) found = v;
      });
      return found;
    };

    const instByFactorId = new Map<string, EvalRow[]>();
    const instBySyntheticLabel = new Map<string, EvalRow[]>();
    const linkedInstIds = new Set<string>();

    for (const inst of instructions) {
      if (!inst.governingFactors || inst.governingFactors.length === 0) continue;
      for (const gfLabel of inst.governingFactors) {
        const factor = resolve(gfLabel);
        if (factor) {
          const bucket = instByFactorId.get(factor.id) ?? [];
          if (!bucket.find((x) => x.id === inst.id)) bucket.push(inst);
          instByFactorId.set(factor.id, bucket);
        } else {
          const label = gfLabel.trim();
          const bucket = instBySyntheticLabel.get(label) ?? [];
          if (!bucket.find((x) => x.id === inst.id)) bucket.push(inst);
          instBySyntheticLabel.set(label, bucket);
        }
        linkedInstIds.add(inst.id);
      }
    }

    const unlinkedInstructions = instructions.filter((i) => !linkedInstIds.has(i.id));
    const syntheticFactorEntries: { label: string; instructions: EvalRow[] }[] = [];
    instBySyntheticLabel.forEach((insts, label) => {
      syntheticFactorEntries.push({ label, instructions: insts });
    });

    return { factors: evalFactors, instructionsByFactor: instByFactorId, unlinked: unlinkedInstructions, syntheticFactors: syntheticFactorEntries };
  }, [effectiveRows]);

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

  const instructionCount = effectiveRows.filter((r) => r.source === 'instruction').length;
  const linkedCount = instructionCount - unlinked.length;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className={`${card} flex flex-wrap items-center gap-6 px-5 py-3`}>
        <div>
          <p className={eyebrow}>Evaluation factors</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{factors.length + syntheticFactors.length}</p>
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
            {linkedCount}
            <span className="ml-1 text-[13px] font-normal text-t4">/ {instructionCount}</span>
          </p>
        </div>
        {unlinked.length > 0 && (
          <>
            <div className="h-8 w-px bg-line" />
            <div className="flex items-center gap-1.5 text-[12px] text-[#92400E]">
              <AlertCircle className="h-3.5 w-3.5" />
              {unlinked.length} unlinked — drag to a factor below
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[11px] text-t4">
        <span className="flex items-center gap-1.5">
          <span className={FACTOR_CHIP}><BookOpen className="mr-1 h-2.5 w-2.5" />Section M</span>
          Evaluation factor
        </span>
        <span className="text-t5">·</span>
        <span className="flex items-center gap-1.5">
          <span className={INST_CHIP}><ClipboardList className="mr-1 h-2.5 w-2.5" />Sec L</span>
          Proposal instruction
        </span>
        {saveGoverningFactorsAction && (
          <>
            <span className="text-t5">·</span>
            <span className="flex items-center gap-1.5">
              <GripVertical className="h-3 w-3 text-t5" />
              Drag instructions to assign them to a factor
            </span>
          </>
        )}
      </div>

      {/* Factor cards — droppable */}
      <div className="space-y-3">
        {factors.length === 0 && syntheticFactors.length === 0 && (
          <div className={`${card} px-5 py-4 text-[12.5px] text-t4`}>
            No Section M evaluation factors found. The shred may not have identified any factors
            in this solicitation, or the base RFP has not been processed yet.
          </div>
        )}
        {factors.map((f) => (
          <FactorDropZone
            key={f.id}
            factorLabel={f.name}
            factorId={f.id}
            factor={f}
            instructions={instructionsByFactor.get(f.id) ?? []}
            solId={solId ?? ''}
            saveAction={saveGoverningFactorsAction}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
          />
        ))}
        {syntheticFactors.map(({ label, instructions: insts }) => (
          <FactorDropZone
            key={label}
            factorLabel={label}
            factorId={null}
            factor={null}
            instructions={insts}
            solId={solId ?? ''}
            saveAction={saveGoverningFactorsAction}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
          />
        ))}

        {/* Unlinked bucket — draggable source, not a drop target */}
        {unlinked.length > 0 && (
          <FactorDropZone
            factorLabel="Unlinked Instructions"
            factorId="unlinked"
            factor={null}
            instructions={unlinked}
            solId={solId ?? ''}
            saveAction={undefined}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
          />
        )}
      </div>
    </div>
  );
}
