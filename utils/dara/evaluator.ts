import { Prisma } from '@prisma/client';
import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseResult,
  buildBatchUserPrompt,
  parseBatchResults,
  type ParsedResult,
  type PromptCriterion
} from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';

// Output-token budget for a single criterion's structured result. The response now
// carries the review summary + rationale + strengths/weaknesses/compliance/suggested
// changes; the old 4096 default truncated the JSON mid-object (parse fails → the
// criterion errors), so give it generous headroom (safe across Anthropic/OpenAI/Google).
const EVAL_MAX_TOKENS = 8000;

// Convert a read-side JSON value (or null) into Prisma's write input.
function jsonIn(
  v: Prisma.JsonValue | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

// The AI-derived columns shared by create / update / regenerate. JSON columns are
// cast for Prisma's input type; a null review becomes a SQL NULL.
function aiFields(parsed: ParsedResult, model: string, tokenIn: number, tokenOut: number) {
  return {
    aiDetermination: parsed.aiDetermination,
    aiScore: parsed.aiScore,
    aiRationale: parsed.aiRationale,
    aiConfidence: parsed.aiConfidence,
    aiStrengths: parsed.strengths as unknown as Prisma.InputJsonValue,
    aiWeaknesses: parsed.weaknesses as unknown as Prisma.InputJsonValue,
    aiCompliance: parsed.compliance,
    aiSuggestedChanges: parsed.suggestedChanges as unknown as Prisma.InputJsonValue,
    aiReview: parsed.review
      ? (parsed.review as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    modelId: model,
    tokenIn,
    tokenOut
  };
}

export interface EvalSummary {
  ok: boolean;
  results: number;
  errors: number;
  done?: number; // evaluation factors with a result after this run (incl. prior)
  total?: number; // total evaluation factors (scored requirements)
  error?: string;
}

export interface SweepSummary {
  ok: boolean;
  checked: number;
  error?: string;
}

// The pass/fail compliance sweep checks the administrative requirements (the bulk) in
// big batches — each item is a one-line determination, so they pack cheaply. The
// holistic review (below) runs one rich call per evaluation factor, not batched.
const BATCH_SIZE_COMPLIANCE = 40;
const BATCH_MAX_TOKENS = 16000;

// Adapt a Requirement row to the prompt builder's criterion shape. Scored Section M
// factors use the 0-100 scoring schema; everything else uses the determination
// schema. The string also drives parseResult's branch.
interface PromptReq {
  name: string;
  description: string | null;
  isScored: boolean;
  farReference: string;
}
function toPromptCriterion(r: PromptReq): PromptCriterion {
  return {
    name: r.name,
    description: r.description,
    criterionType: r.isScored ? 'scored_factor' : 'requirement',
    farReference: r.farReference
  };
}

interface DocFile {
  originalFilename: string;
  extractedText: string | null;
  extractionStatus: string;
}

function concatDocs(files: DocFile[]): string {
  return files
    .filter((f) => f.extractionStatus === 'complete')
    // Decrypt CUI at the point of use (DARA-009); tolerate legacy plaintext rows.
    .map((f) => ({ name: f.originalFilename, text: decryptField(f.extractedText) }))
    .filter((d) => d.text.trim() !== '')
    .map((d) => `=== ${d.name} ===\n\n${d.text}`)
    .join('\n\n');
}

async function fail(
  evaluationId: bigint,
  companyId: bigint,
  message: string
): Promise<EvalSummary> {
  await withTenant(companyId, (tx) =>
    tx.evaluation.update({
      where: { id: evaluationId },
      data: { status: 'failed', errorMessage: message.slice(0, 500) }
    })
  );
  return { ok: false, results: 0, errors: 0, error: message };
}

/**
 * Run a single evaluation (one review × one persona): a HOLISTIC review of the
 * proposal against the solicitation's EVALUATION FACTORS (the scored requirements).
 * Each factor gets the full structured assessment — review summary (how/what/measured
 * against), rationale, strengths, weaknesses, compliance commentary, suggested changes,
 * and a score/rating — from this persona's perspective. The administrative / pass-fail
 * requirements are NOT scored here; they go through runComplianceSweep into the matrix.
 * Time-boxed (deadlineMs) and resumable (skips factors that already have a result).
 */
export async function runEvaluation(
  evaluationId: bigint,
  companyId: bigint,
  deadlineMs = Infinity
): Promise<EvalSummary> {
  // Burst A: load everything (evaluation factors only), the already-done factors, and
  // mark the run started. No LLM calls inside the transaction.
  const loaded = await withTenant(companyId, async (tx) => {
    const evaluation = await tx.evaluation.findFirst({
      where: { id: evaluationId, companyId },
      include: {
        solicitation: {
          include: {
            // Holistic review covers the scored evaluation factors only.
            requirements: {
              where: { removedAt: null, isScored: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
            },
            solDocs: true
          }
        },
        review: { include: { documents: true } }
      }
    });
    if (!evaluation) return null;
    await tx.evaluation.update({ where: { id: evaluationId }, data: { status: 'running' } });
    const persona = await tx.persona.findFirst({ where: { id: evaluation.personaId, companyId } });
    const company = await tx.company.findUnique({ where: { id: companyId } });
    const existing = await tx.result.findMany({
      where: { evaluationId, companyId },
      select: { requirementId: true }
    });
    return {
      evaluation,
      persona,
      company,
      doneIds: new Set(existing.map((e) => e.requirementId.toString()))
    };
  });

  if (!loaded) return { ok: false, results: 0, errors: 0, error: 'Evaluation not found.' };
  const { evaluation, persona, company, doneIds } = loaded;
  if (!persona) return fail(evaluationId, companyId, 'Persona not found.');
  if (!company) return fail(evaluationId, companyId, 'Company not found.');

  const platform = company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(company, platform);
  if (!apiKey) return fail(evaluationId, companyId, `No API key configured for provider "${provider}".`);

  const documentText = concatDocs(evaluation.review.documents);
  if (documentText.trim() === '') {
    return fail(
      evaluationId,
      companyId,
      'No proposal snapshot for this review. Capture a draft snapshot and ensure extraction completed.'
    );
  }
  // RFP-typed docs are the authoritative reference; proposal docs are the working draft.
  const solText = concatDocs(evaluation.solicitation.solDocs.filter((d) => d.docType === 'rfp'));

  const factors = evaluation.solicitation.requirements;
  const total = factors.length;

  // No scored evaluation factors — the review is purely a compliance matter (handled by
  // the sweep). Nothing to assess richly here; complete cleanly.
  if (total === 0) {
    await withTenant(companyId, (tx) =>
      tx.evaluation.update({
        where: { id: evaluationId },
        data: { status: 'complete', completedAt: new Date(), errorMessage: null }
      })
    );
    return { ok: true, results: 0, errors: 0, done: 0, total: 0 };
  }

  const todo = factors.filter((r) => !doneIds.has(r.id.toString()));
  let newResults = 0;
  let errors = 0;
  let done = doneIds.size;

  // One rich call per evaluation factor — the holistic, structured assessment.
  for (const factor of todo) {
    if (Date.now() > deadlineMs) break;
    const pc = toPromptCriterion(factor); // isScored → scored_factor schema
    const system = buildSystemPrompt(persona, pc, evaluation.solicitation);
    const user = buildUserPrompt(pc, documentText, solText);
    try {
      // LLM call OUTSIDE any transaction — the slow network hop.
      const ai = await complete(provider, system, user, model, apiKey, EVAL_MAX_TOKENS);
      const parsed = parseResult(ai.text, pc.criterionType);
      if (!parsed) {
        errors++;
        continue;
      }
      await withTenant(companyId, (tx) =>
        tx.result.upsert({
          where: {
            evaluationId_requirementId_personaId: {
              evaluationId,
              requirementId: factor.id,
              personaId: persona.id
            }
          },
          create: {
            evaluationId,
            companyId,
            requirementId: factor.id,
            personaId: persona.id,
            ...aiFields(parsed, model, ai.tokenIn, ai.tokenOut)
          },
          update: aiFields(parsed, model, ai.tokenIn, ai.tokenOut)
        })
      );
      newResults++;
      done++;
    } catch {
      errors++;
    }
  }

  const allDone = done >= total;
  await withTenant(companyId, (tx) =>
    tx.evaluation.update({
      where: { id: evaluationId },
      data: {
        status: allDone ? 'complete' : 'pending',
        completedAt: allDone ? new Date() : null,
        errorMessage: allDone ? null : `Paused — ${done}/${total} factors assessed; run again to continue.`
      }
    })
  );

  return { ok: newResults > 0 || allDone, results: newResults, errors, done, total };
}

// Objective compliance check — no persona lens; the proposal either satisfies the
// administrative requirement or it does not.
const COMPLIANCE_SYSTEM =
  'You are a government-contracting compliance analyst. You check a proposal against ' +
  'administrative and pass/fail solicitation requirements and return a brief Go/No-Go ' +
  'determination for each. Respond only in the JSON format specified.';

function mapDetermination(d: string | null): 'compliant' | 'partial' | 'non_compliant' | 'not_assessed' {
  if (d === 'compliant') return 'compliant';
  if (d === 'non_compliant') return 'non_compliant';
  if (d === 'unable_to_determine') return 'partial';
  return 'not_assessed';
}

/**
 * Lean pass/fail sweep of the administrative requirements (the non-scored bulk) against
 * a review's frozen proposal snapshot, setting each requirement's complianceStatus — the
 * compliance matrix. Big batches (cheap determinations); time-boxed; idempotent (a
 * re-run overwrites the statuses to reflect the current draft).
 */
export async function runComplianceSweep(
  reviewId: bigint,
  companyId: bigint,
  deadlineMs = Infinity
): Promise<SweepSummary> {
  const loaded = await withTenant(companyId, async (tx) => {
    const review = await tx.review.findFirst({
      where: { id: reviewId, companyId },
      include: { documents: true }
    });
    if (!review) return null;
    const company = await tx.company.findUnique({ where: { id: companyId } });
    const requirements = await tx.requirement.findMany({
      where: { solicitationId: review.solicitationId, companyId, removedAt: null, isScored: false },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    const solDocs = await tx.solDocument.findMany({
      where: { solicitationId: review.solicitationId, companyId }
    });
    return { review, company, requirements, solDocs };
  });

  if (!loaded?.review) return { ok: false, checked: 0, error: 'Review not found.' };
  if (!loaded.company) return { ok: false, checked: 0, error: 'Company not found.' };
  if (loaded.requirements.length === 0) return { ok: true, checked: 0 };

  const documentText = concatDocs(loaded.review.documents);
  if (documentText.trim() === '') return { ok: false, checked: 0, error: 'No proposal snapshot.' };
  const solText = concatDocs(loaded.solDocs.filter((d) => d.docType === 'rfp'));

  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(loaded.company, platform);
  if (!apiKey) return { ok: false, checked: 0, error: `No API key configured for provider "${provider}".` };

  let checked = 0;
  for (let i = 0; i < loaded.requirements.length; i += BATCH_SIZE_COMPLIANCE) {
    if (Date.now() > deadlineMs) break;
    const batch = loaded.requirements.slice(i, i + BATCH_SIZE_COMPLIANCE);
    const user = buildBatchUserPrompt(
      batch.map((r) => ({
        id: r.id.toString(),
        name: r.name,
        description: r.description,
        isScored: false,
        farReference: r.farReference
      })),
      documentText,
      solText,
      true // lean determination schema
    );
    try {
      const ai = await complete(provider, COMPLIANCE_SYSTEM, user, model, apiKey, BATCH_MAX_TOKENS);
      const { items } = parseBatchResults(ai.text);
      const byId = new Map(items.map((it) => [it.requirementId, it]));
      await withTenant(companyId, async (tx) => {
        for (const r of batch) {
          const it = byId.get(r.id.toString());
          if (!it) continue;
          await tx.requirement.update({
            where: { id: r.id },
            data: { complianceStatus: mapDetermination(it.aiDetermination) }
          });
          checked++;
        }
      });
    } catch {
      /* skip a failed batch — a re-run re-sweeps */
    }
  }

  return { ok: true, checked };
}

/**
 * Regenerate a single result (one criterion of one offeror×persona evaluation).
 * Snapshots the current values into the prior-version log, re-runs the criterion,
 * and updates the result in place (incrementing regenCount). The slow LLM call runs
 * outside any transaction.
 */
export async function regenerateResult(
  resultId: bigint,
  companyId: bigint
): Promise<{ ok: boolean; error?: string }> {
  const loaded = await withTenant(companyId, async (tx) => {
    const result = await tx.result.findFirst({ where: { id: resultId, companyId } });
    if (!result) return null;
    const requirement = await tx.requirement.findFirst({
      where: { id: result.requirementId, companyId }
    });
    const persona = await tx.persona.findFirst({
      where: { id: result.personaId, companyId }
    });
    const evaluation = await tx.evaluation.findFirst({
      where: { id: result.evaluationId, companyId },
      include: {
        review: { include: { documents: true } },
        solicitation: { include: { solDocs: true } }
      }
    });
    const company = await tx.company.findUnique({ where: { id: companyId } });
    return { result, requirement, persona, evaluation, company };
  });

  if (!loaded?.result || !loaded.requirement || !loaded.persona || !loaded.evaluation || !loaded.company) {
    return { ok: false, error: 'Result or related data not found.' };
  }
  const { result, requirement, persona, evaluation, company } = loaded;

  const documentText = concatDocs(evaluation.review.documents);
  if (documentText.trim() === '') {
    return { ok: false, error: 'No proposal snapshot for this review to evaluate.' };
  }
  const solText = concatDocs(
    evaluation.solicitation.solDocs.filter((d) => d.docType === 'rfp')
  );

  const platform = company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(company, platform);
  if (!apiKey) return { ok: false, error: `No API key configured for provider "${provider}".` };

  const pc = toPromptCriterion(requirement);
  const system = buildSystemPrompt(persona, pc, evaluation.solicitation);
  const user = buildUserPrompt(pc, documentText, solText);

  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, EVAL_MAX_TOKENS);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'AI request failed.' };
  }
  const parsed = parseResult(ai.text, pc.criterionType);
  if (!parsed) return { ok: false, error: 'Could not parse the AI response.' };

  await withTenant(companyId, async (tx) => {
    // Snapshot the soon-to-be-replaced values into the prior-version log.
    await tx.resultVersion.create({
      data: {
        companyId,
        resultId: result.id,
        version: result.regenCount + 1,
        aiDetermination: result.aiDetermination,
        aiScore: result.aiScore,
        aiRationale: result.aiRationale,
        aiConfidence: result.aiConfidence,
        aiStrengths: jsonIn(result.aiStrengths),
        aiWeaknesses: jsonIn(result.aiWeaknesses),
        aiCompliance: result.aiCompliance,
        aiSuggestedChanges: jsonIn(result.aiSuggestedChanges),
        aiReview: jsonIn(result.aiReview),
        modelId: result.modelId
      }
    });
    await tx.result.update({
      where: { id: result.id },
      data: { ...aiFields(parsed, model, ai.tokenIn, ai.tokenOut), regenCount: result.regenCount + 1 }
    });
  });

  return { ok: true };
}

/** Archive (hide, retain) or restore a single result. Archived results are never deleted. */
export async function setResultArchived(
  resultId: bigint,
  companyId: bigint,
  archived: boolean
): Promise<void> {
  await withTenant(companyId, (tx) =>
    tx.result.updateMany({
      where: { id: resultId, companyId },
      data: { archivedAt: archived ? new Date() : null }
    })
  );
}
