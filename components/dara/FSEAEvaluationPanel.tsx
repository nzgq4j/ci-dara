'use client';

// FSEA Evaluation Panel — replaces the old EvaluationPanel for solicitations that have
// been processed by the 10-pass FSEA pipeline.
//
// Reads from the evaluation ontology stored in fseaOutput.evalOntology:
//   - factors: P4Factor[] — the named evaluation factors (F1, F2, etc.)
//   - criteria: P4Criterion[] — the evaluative criteria within each factor (F1-C1, F1-C2...)
//   - evaluationSurface: P4EvalSurface[] — the critical paragraphs mapped to factors
//   - constructs: P4ConstructObject[] — verbatim Strength/Weakness/Deficiency definitions
//
// Links requirements to criteria via hrlr.governingCriteriaIds (['F1-C1', 'F1-C2']).
// This is the authoritative linkage written by Pass 5; it reflects the actual evaluation
// model rather than AI-inferred string labels.

import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, ClipboardList, AlertCircle, Target, ShieldCheck } from 'lucide-react';
import { card, eyebrow } from '@/components/dara/theme';
import type { P4Factor, P4Criterion, P4EvalSurface, P4ConstructObject } from '@/utils/dara/fsea/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FSEAEvalOntology {
  factors: P4Factor[];
  criteria: P4Criterion[];
  evaluationSurface: P4EvalSurface[];
  constructs: P4ConstructObject[];
}

export interface FSEAEvalRequirement {
  id: string;
  reqId: string;
  paragraphId: string;
  requirement: string;
  proposalResponseObligation: string;
  evaluationCriterion: string;       // single criterion ID e.g. 'F1-C1'
  governingCriteriaIds: string[];    // all linked criterion IDs
  pageSignal: string;
  priority: string;
  strengthGate: string | null;
}

export interface FSEAEvaluationPanelProps {
  ontology: FSEAEvalOntology;
  requirements: FSEAEvalRequirement[];
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const FACTOR_CHIP = 'inline-flex items-center rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-navy';
const CRITERION_CHIP = 'inline-flex items-center rounded bg-[#EDE9FE] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#5B21B6]';
const REQ_CHIP = 'inline-flex items-center rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#92400E]';

function CitationBadge({ text }: { text: string }) {
  if (!text) return null;
  return <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">{text}</span>;
}

// ── Criterion card — shows one evaluative criterion with linked requirements ───

function CriterionCard({
  criterion,
  requirements,
}: {
  criterion: P4Criterion;
  requirements: FSEAEvalRequirement[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="ml-4 rounded-lg border border-line/60 bg-surf overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surf2 transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0 text-t5">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={CRITERION_CHIP}>
              <Target className="mr-1 h-2.5 w-2.5" />
              {criterion.id}
            </span>
            <CitationBadge text={criterion.source} />
          </div>
          <p className="mt-1 text-[12px] font-medium text-t1 leading-snug">{criterion.text}</p>
        </div>
        <span className="flex-shrink-0 font-mono text-[10px] text-t5">
          {requirements.length} req{requirements.length !== 1 ? 's' : ''}
        </span>
      </button>

      {open && (
        <div className="border-t border-line/40 divide-y divide-line/30">
          {requirements.length === 0 ? (
            <div className="px-4 py-3 text-[11.5px] text-t5 italic">
              No requirements linked to this criterion.
            </div>
          ) : (
            requirements.map(req => (
              <ReqRow key={req.id} req={req} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Requirement row under a criterion ─────────────────────────────────────────

function ReqRow({ req }: { req: FSEAEvalRequirement }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 px-3 py-2.5 pl-8 text-left hover:bg-surf2 transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0 text-t5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className={`mt-0.5 flex-shrink-0 ${REQ_CHIP}`}>
          <ClipboardList className="mr-1 h-2.5 w-2.5" />
          {req.reqId}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <CitationBadge text={req.paragraphId} />
            {req.strengthGate && (
              <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#166534]">
                {req.strengthGate}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-t2 leading-snug">{req.requirement}</p>
          {!open && req.pageSignal && (
            <p className="mt-0.5 text-[10px] text-t5">{req.pageSignal}</p>
          )}
        </div>
      </button>

      {open && req.proposalResponseObligation && (
        <div className="border-t border-line/30 bg-surf/80 px-4 pb-3 pt-2.5 pl-16">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Proposal response obligation</p>
          <p className="text-[12px] leading-relaxed text-t1">{req.proposalResponseObligation}</p>
        </div>
      )}
    </div>
  );
}

// ── Factor card — top-level grouping ──────────────────────────────────────────

function FactorCard({
  factor,
  criteria,
  requirementsByCriterion,
}: {
  factor: P4Factor;
  criteria: P4Criterion[];
  requirementsByCriterion: Map<string, FSEAEvalRequirement[]>;
}) {
  const [open, setOpen] = useState(true);
  const totalReqs = criteria.reduce((n, c) => n + (requirementsByCriterion.get(c.id)?.length ?? 0), 0);

  return (
    <div className={`${card} overflow-hidden`}>
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
            <span className={FACTOR_CHIP}>
              <BookOpen className="mr-1 h-2.5 w-2.5" />
              {factor.id}
            </span>
            <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4 capitalize">
              {factor.ratingMethod}
            </span>
            <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4">
              #{factor.orderOfImportance}
            </span>
          </div>
          <p className="mt-1 text-[13px] font-semibold text-t1">{factor.name}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="font-mono text-[11px] text-t5">{criteria.length} criteria</p>
          <p className="font-mono text-[10px] text-t5">{totalReqs} requirements</p>
        </div>
      </button>

      {open && (
        <div className="border-t border-line space-y-2 p-3">
          {criteria.length === 0 ? (
            <p className="px-2 text-[12px] text-t5 italic">No evaluation criteria extracted for this factor.</p>
          ) : (
            criteria.map(c => (
              <CriterionCard
                key={c.id}
                criterion={c}
                requirements={requirementsByCriterion.get(c.id) ?? []}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Construct definitions ──────────────────────────────────────────────────────

function ConstructCard({ construct }: { construct: P4ConstructObject }) {
  const colors: Record<string, { bg: string; text: string }> = {
    Strength:   { bg: 'bg-[#DCFCE7]', text: 'text-[#166534]' },
    Weakness:   { bg: 'bg-[#FEF3C7]', text: 'text-[#92400E]' },
    Deficiency: { bg: 'bg-[#FEE2E2]', text: 'text-[#991B1B]' },
  };
  const color = colors[construct.name] ?? { bg: 'bg-surf3', text: 'text-t3' };

  return (
    <div className="rounded-lg border border-line/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-t4" />
        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${color.bg} ${color.text}`}>
          {construct.name}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] text-t2 leading-snug">{construct.definition}</p>
      {construct.scoringEffect && (
        <p className="mt-1 text-[11px] text-t4">{construct.scoringEffect}</p>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function FSEAEvaluationPanel({
  ontology,
  requirements,
}: FSEAEvaluationPanelProps) {

  const { requirementsByCriterion, criteriaByFactor, unlinked } = useMemo(() => {
    // Index criteria by ID
    const criteriaById = new Map(ontology.criteria.map(c => [c.id, c]));

    // Map requirements to their governing criteria
    const reqsByCrit = new Map<string, FSEAEvalRequirement[]>();
    const linkedIds = new Set<string>();

    for (const req of requirements) {
      const ids = req.governingCriteriaIds ?? [];
      // Also check the single evaluationCriterion field
      const allIds = Array.from(new Set([...ids, req.evaluationCriterion].filter(Boolean)));

      for (const criterionId of allIds) {
        if (!criterionId) continue;
        const bucket = reqsByCrit.get(criterionId) ?? [];
        if (!bucket.find(r => r.id === req.id)) bucket.push(req);
        reqsByCrit.set(criterionId, bucket);
        linkedIds.add(req.id);
      }
    }

    // Group criteria by factor
    const critByFactor = new Map<string, P4Criterion[]>();
    for (const c of ontology.criteria) {
      const bucket = critByFactor.get(c.factorId) ?? [];
      bucket.push(c);
      critByFactor.set(c.factorId, bucket);
    }

    const unlinkedReqs = requirements.filter(r => !linkedIds.has(r.id));

    return {
      requirementsByCriterion: reqsByCrit,
      criteriaByFactor: critByFactor,
      unlinked: unlinkedReqs,
    };
  }, [ontology, requirements]);

  if (!ontology.factors || ontology.factors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line bg-surf px-6 py-12 text-center">
        <BookOpen className="h-8 w-8 text-t5" />
        <p className="mt-3 text-[13px] text-t4">
          No evaluation ontology found. Run the pipeline to extract evaluation factors and criteria.
        </p>
      </div>
    );
  }

  const linkedCount = requirements.length - unlinked.length;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className={`${card} flex flex-wrap items-center gap-6 px-5 py-3`}>
        <div>
          <p className={eyebrow}>Evaluation factors</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{ontology.factors.length}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <p className={eyebrow}>Evaluation criteria</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{ontology.criteria.length}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <p className={eyebrow}>Requirements linked</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">
            {linkedCount}
            <span className="ml-1 text-[13px] font-normal text-t4">/ {requirements.length}</span>
          </p>
        </div>
        {unlinked.length > 0 && (
          <>
            <div className="h-8 w-px bg-line" />
            <div className="flex items-center gap-1.5 text-[12px] text-[#92400E]">
              <AlertCircle className="h-3.5 w-3.5" />
              {unlinked.length} unlinked
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[11px] text-t4">
        <span className="flex items-center gap-1.5">
          <span className={FACTOR_CHIP}><BookOpen className="mr-1 h-2.5 w-2.5" />F1</span>
          Evaluation factor
        </span>
        <span className="text-t5">·</span>
        <span className="flex items-center gap-1.5">
          <span className={CRITERION_CHIP}><Target className="mr-1 h-2.5 w-2.5" />F1-C1</span>
          Evaluation criterion
        </span>
        <span className="text-t5">·</span>
        <span className="flex items-center gap-1.5">
          <span className={REQ_CHIP}><ClipboardList className="mr-1 h-2.5 w-2.5" />2.4.1-01</span>
          Proposal requirement
        </span>
      </div>

      {/* Factor cards */}
      <div className="space-y-3">
        {ontology.factors
          .sort((a, b) => (a.orderOfImportance ?? 99) - (b.orderOfImportance ?? 99))
          .map(factor => (
            <FactorCard
              key={factor.id}
              factor={factor}
              criteria={criteriaByFactor.get(factor.id) ?? []}
              requirementsByCriterion={requirementsByCriterion}
            />
          ))
        }

        {/* Unlinked requirements */}
        {unlinked.length > 0 && (
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center gap-3 px-4 py-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-t5" />
              <div>
                <p className="text-[13px] font-semibold text-t1">Unlinked requirements</p>
                <p className="text-[11.5px] text-t4">These requirements have no criterion assignment from Pass 5.</p>
              </div>
            </div>
            <div className="border-t border-line divide-y divide-line/60">
              {unlinked.map(req => <ReqRow key={req.id} req={req} />)}
            </div>
          </div>
        )}
      </div>

      {/* Evaluative constructs */}
      {ontology.constructs && ontology.constructs.length > 0 && (
        <div className={card}>
          <div className="border-b border-line px-4 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-wide text-t5">
              Evaluative constructs — verbatim from the solicitation
            </p>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {ontology.constructs.map((c, i) => (
              <ConstructCard key={i} construct={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
