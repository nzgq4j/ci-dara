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

// Output-token budget for a single evaluation factor's structured result. Enough for a
// full holistic assessment (review summary + rationale + strengths/weaknesses/compliance/
// suggested changes) but bounded so generation stays fast — the rich calls are the run's
// bottleneck. regenerateResult uses the same budget.
const EVAL_MAX_TOKENS = 5000;

// Evaluation factors are assessed concurrently (each is its own LLM call), so a review
// with many factors finishes in one round instead of a slow sequential crawl. Kept
// modest to respect provider rate limits.
const FACTOR_CONCURRENCY = 5;

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

// The pass/fail compliance sweep checks the compliance requirements (the bulk) in small
// batches. Batches are kept modest so each call finishes fast and its JSON never truncates
// — a 40-item / 16k-token batch was overrunning the function limit AND truncating past the
// parser, which silently graded nothing. The holistic review (below) runs one rich call per
// evaluation factor, not batched.
// The full proposal + RFP are re-sent with every batch, so fewer/larger batches mean fewer
// re-sends (cheaper and faster) — the output is one lean line per requirement, so 30 items
// fit comfortably under the token cap. (Smaller batches only multiply the document cost.)
const BATCH_SIZE_COMPLIANCE = 30;
const BATCH_MAX_TOKENS = 8000;
// Grade this many 30-requirement batches CONCURRENTLY per round. The LLM call is the
// bottleneck, so a sequential sweep of a 150+ requirement matrix crawled across many cron
// ticks; running a few batches in parallel cuts wall-clock ~Nx (matches FACTOR_CONCURRENCY).
const COMPLIANCE_CONCURRENCY = 4;
// Don't START a batch unless this much of the deadline remains. The deadline is only
// checked between batches, so without this a single call can overrun the function's hard
// limit and be killed mid-write — the "quiet timeout" where progress is lost.
const BATCH_BUDGET_MS = 90_000;

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

  // One rich call per evaluation factor — the holistic, structured assessment. Factors
  // run CONCURRENTLY (in bounded chunks) so a many-factor review finishes in one round;
  // LLM calls are OUTSIDE any transaction, and each chunk's results persist together.
  for (let i = 0; i < todo.length; i += FACTOR_CONCURRENCY) {
    if (Date.now() > deadlineMs) break;
    const chunk = todo.slice(i, i + FACTOR_CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map(async (factor) => {
        const pc = toPromptCriterion(factor); // isScored → scored_factor schema
        const system = buildSystemPrompt(persona, pc, evaluation.solicitation);
        const user = buildUserPrompt(pc, documentText, solText);
        try {
          const ai = await complete(provider, system, user, model, apiKey, EVAL_MAX_TOKENS);
          const parsed = parseResult(ai.text, pc.criterionType);
          return parsed ? { factor, parsed, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut } : null;
        } catch {
          return null;
        }
      })
    );
    await withTenant(companyId, async (tx) => {
      for (const o of outcomes) {
        if (!o) {
          errors++;
          continue;
        }
        await tx.result.upsert({
          where: {
            evaluationId_requirementId_personaId: {
              evaluationId,
              requirementId: o.factor.id,
              personaId: persona.id
            }
          },
          create: {
            evaluationId,
            companyId,
            requirementId: o.factor.id,
            personaId: persona.id,
            ...aiFields(o.parsed, model, o.tokenIn, o.tokenOut)
          },
          update: aiFields(o.parsed, model, o.tokenIn, o.tokenOut)
        });
        newResults++;
        done++;
      }
    });
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
  // Normalize case/whitespace before matching — LLMs return "Compliant", "non-compliant",
  // trailing spaces, etc., and an exact-token check would drop those to the fallback.
  const v = (d ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (v === 'compliant') return 'compliant';
  if (v === 'non_compliant') return 'non_compliant';
  if (v === 'unable_to_determine') return 'partial';
  // Any other/blank determination → 'partial' (a terminal, human-reviewable state), NEVER
  // not_assessed: a row the sweep has graded must leave the ungraded pool. Writing it back to
  // not_assessed left it permanently ungraded, which stalled the resumable sweep and spun the
  // background compliance-check job forever (see runComplianceJob in passes.ts).
  return 'partial';
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
      // Only the pass/fail compliance requirements are graded against the proposal, and only
      // the ones not yet assessed — so a re-run resumes where the last one stopped instead of
      // re-grading everything. Scored factors get the holistic review; administrative are N/A.
      where: {
        solicitationId: review.solicitationId,
        companyId,
        removedAt: null,
        disposition: 'compliance',
        complianceStatus: 'not_assessed'
      },
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

  return finishSweep(
    loaded.requirements.length,
    await sweepRequirements(companyId, loaded.requirements, documentText, solText, provider, model, apiKey, deadlineMs)
  );
}

// Translate a sweep result into a user-facing summary: full success, a clear
// grade-the-rest prompt when the budget ran out partway, or the actual failure reason
// when nothing was graded — never a silent "0 checked".
function finishSweep(total: number, res: { checked: number; error?: string }): SweepSummary {
  const remaining = total - res.checked;
  if (res.checked === 0) {
    return { ok: false, checked: 0, error: res.error ?? 'No requirements were graded. Check the AI provider/model and try again.' };
  }
  if (remaining > 0) {
    return {
      ok: false,
      checked: res.checked,
      error: `Graded ${res.checked} of ${total} requirements. ${remaining} still to grade — click Run compliance check again to continue.`
    };
  }
  return { ok: true, checked: res.checked };
}

// Shared sweep loop: lean pass/fail determinations over `requirements` against
// `documentText`, writing each requirement's complianceStatus. Idempotent, time-boxed, and
// resumable — it grades as many as fit before the budget runs out and reports the rest.
async function sweepRequirements(
  companyId: bigint,
  requirements: { id: bigint; name: string; description: string | null; farReference: string }[],
  documentText: string,
  solText: string,
  provider: string,
  model: string,
  apiKey: string,
  deadlineMs: number
): Promise<{ checked: number; error?: string }> {
  let checked = 0;
  let lastError: string | undefined;

  // Slice into 30-item batches once, then grade COMPLIANCE_CONCURRENCY batches per round with
  // their LLM calls in flight together (the slow part). Results are persisted after each round.
  const batches: (typeof requirements)[] = [];
  for (let i = 0; i < requirements.length; i += BATCH_SIZE_COMPLIANCE) {
    batches.push(requirements.slice(i, i + BATCH_SIZE_COMPLIANCE));
  }

  for (let i = 0; i < batches.length; i += COMPLIANCE_CONCURRENCY) {
    // Only start a round if a batch can finish before the function is killed. Otherwise stop
    // and let the caller report partial progress — the sweep is resumable (re-run grades the
    // rest; already-graded requirements are skipped by the caller).
    if (deadlineMs - Date.now() < BATCH_BUDGET_MS) break;
    const round = batches.slice(i, i + COMPLIANCE_CONCURRENCY);

    const graded = await Promise.all(
      round.map(async (batch) => {
        const user = buildBatchUserPrompt(
          batch.map((r) => ({ id: r.id.toString(), name: r.name, description: r.description, isScored: false, farReference: r.farReference })),
          documentText,
          solText,
          true
        );
        try {
          const ai = await complete(provider, COMPLIANCE_SYSTEM, user, model, apiKey, BATCH_MAX_TOKENS);
          const { items } = parseBatchResults(ai.text);
          if (items.length === 0) {
            return { batch, items: [], error: 'The AI returned no parseable determinations — the model may be truncating output. Try a stronger platform model (e.g. Sonnet).' };
          }
          return { batch, items, error: undefined as string | undefined };
        } catch (e) {
          return { batch, items: [], error: e instanceof Error ? e.message.slice(0, 300) : 'AI request failed.' };
        }
      })
    );

    // Persist each batch's determinations (short transactions, one per batch).
    for (const g of graded) {
      if (g.error) lastError = g.error; // keep going so one bad batch doesn't abort the rest
      if (g.items.length === 0) continue;
      const byId = new Map(g.items.map((it) => [it.requirementId, it]));
      await withTenant(companyId, async (tx) => {
        for (const r of g.batch) {
          const it = byId.get(r.id.toString());
          if (!it) continue;
          await tx.requirement.update({
            where: { id: r.id },
            data: {
              complianceStatus: mapDetermination(it.aiDetermination),
              // Record where the proposal addresses it (don't wipe a manual entry).
              ...(it.proposalRef ? { proposalRef: it.proposalRef } : {})
            }
          });
          checked++;
        }
      });
    }
  }
  return { checked, error: lastError };
}

/**
 * Standalone compliance check for the Compliance tab: sweeps the administrative
 * (non-scored) requirements against the solicitation's CURRENT proposal draft
 * (docType='proposal'), independent of any color-team review. Idempotent + time-boxed.
 */
export async function runComplianceCheck(
  solicitationId: bigint,
  companyId: bigint,
  deadlineMs = Infinity
): Promise<SweepSummary> {
  const loaded = await withTenant(companyId, async (tx) => {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    // Grade only the not-yet-assessed compliance requirements so a re-run resumes the
    // remainder instead of starting over (209 items can't finish in one function budget).
    const requirements = await tx.requirement.findMany({
      where: { solicitationId, companyId, removedAt: null, disposition: 'compliance', complianceStatus: 'not_assessed' },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    // Whether ANY compliance requirements exist at all (to distinguish "all done" from "none").
    const totalCompliance = await tx.requirement.count({
      where: { solicitationId, companyId, removedAt: null, disposition: 'compliance' }
    });
    const solDocs = await tx.solDocument.findMany({ where: { solicitationId, companyId } });
    return { company, requirements, totalCompliance, solDocs };
  });

  if (!loaded.company) return { ok: false, checked: 0, error: 'Company not found.' };
  if (loaded.totalCompliance === 0) {
    return { ok: false, checked: 0, error: 'No pass/fail compliance requirements to check. Generate the matrix — the shred classifies each requirement as Scored, Compliance, or Administrative.' };
  }
  if (loaded.requirements.length === 0) {
    // Compliance rows exist but all are already graded — nothing to do.
    return { ok: true, checked: 0 };
  }
  const documentText = concatDocs(loaded.solDocs.filter((d) => d.docType === 'proposal'));
  if (documentText.trim() === '') {
    return { ok: false, checked: 0, error: 'No proposal draft. Upload your proposal on the Documents tab.' };
  }
  const solText = concatDocs(loaded.solDocs.filter((d) => d.docType === 'rfp'));

  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(loaded.company, platform);
  if (!apiKey) return { ok: false, checked: 0, error: `No API key configured for provider "${provider}".` };

  return finishSweep(
    loaded.requirements.length,
    await sweepRequirements(companyId, loaded.requirements, documentText, solText, provider, model, apiKey, deadlineMs)
  );
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
