import { Prisma } from '@prisma/client';
import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseResult,
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
  error?: string;
}

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
 * Run a single evaluation (one response × one persona) across all of the
 * solicitation's criteria. Calls the company's configured AI provider for each
 * criterion and writes/updates Result rows. Updates the evaluation status.
 */
export async function runEvaluation(
  evaluationId: bigint,
  companyId: bigint
): Promise<EvalSummary> {
  // Burst A: load everything and mark the run started, in one tenant transaction.
  // No LLM calls happen inside withTenant — those run between bursts (below).
  const loaded = await withTenant(companyId, async (tx) => {
    const evaluation = await tx.evaluation.findFirst({
      where: { id: evaluationId, companyId },
      include: {
        solicitation: {
          include: {
            requirements: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
            solDocs: true
          }
        },
        review: { include: { documents: true } }
      }
    });
    if (!evaluation) return null;

    await tx.evaluation.update({
      where: { id: evaluationId },
      data: { status: 'running' }
    });

    const persona = await tx.persona.findFirst({
      where: { id: evaluation.personaId, companyId }
    });
    const company = await tx.company.findUnique({ where: { id: companyId } });
    return { evaluation, persona, company };
  });

  if (!loaded) {
    return { ok: false, results: 0, errors: 0, error: 'Evaluation not found.' };
  }
  const { evaluation, persona, company } = loaded;
  if (!persona) return fail(evaluationId, companyId, 'Persona not found.');
  if (!company) return fail(evaluationId, companyId, 'Company not found.');

  // Platform mode draws keys + provider/model from the central platform config.
  const platform = company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(company, platform);
  if (!apiKey) {
    return fail(evaluationId, companyId, `No API key configured for provider "${provider}".`);
  }

  const documentText = concatDocs(evaluation.review.documents);
  if (documentText.trim() === '') {
    return fail(
      evaluationId,
      companyId,
      'No proposal snapshot for this review. Capture a draft snapshot and ensure extraction completed.'
    );
  }
  // The RFP-typed solicitation docs are the authoritative reference; proposal-typed
  // docs are the working draft (snapshotted into the review), so exclude them here.
  const solText = concatDocs(
    evaluation.solicitation.solDocs.filter((d) => d.docType === 'rfp')
  );

  const requirements = evaluation.solicitation.requirements;
  if (requirements.length === 0) {
    return fail(evaluationId, companyId, 'No requirements defined for this solicitation.');
  }

  let results = 0;
  let errors = 0;

  for (const requirement of requirements) {
    const pc = toPromptCriterion(requirement);
    const system = buildSystemPrompt(persona, pc, evaluation.solicitation);
    const user = buildUserPrompt(pc, documentText, solText);

    try {
      // LLM call OUTSIDE any transaction — this is the slow network hop.
      const ai = await complete(provider, system, user, model, apiKey, EVAL_MAX_TOKENS);
      const parsed = parseResult(ai.text, pc.criterionType);
      if (!parsed) {
        errors++;
        continue;
      }
      // Persist this requirement's result in its own short tenant burst, so partial
      // progress survives a later requirement failing.
      await withTenant(companyId, (tx) =>
        tx.result.upsert({
          where: {
            evaluationId_requirementId_personaId: {
              evaluationId,
              requirementId: requirement.id,
              personaId: persona.id
            }
          },
          create: {
            evaluationId,
            companyId,
            requirementId: requirement.id,
            personaId: persona.id,
            ...aiFields(parsed, model, ai.tokenIn, ai.tokenOut)
          },
          update: aiFields(parsed, model, ai.tokenIn, ai.tokenOut)
        })
      );
      results++;
    } catch {
      errors++;
    }
  }

  // Burst C: final status, its own tenant transaction.
  await withTenant(companyId, (tx) =>
    tx.evaluation.update({
      where: { id: evaluationId },
      data: {
        status: results > 0 ? 'complete' : 'failed',
        completedAt: new Date(),
        errorMessage: results === 0 ? 'All criteria failed to evaluate.' : null
      }
    })
  );

  return { ok: results > 0, results, errors };
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
