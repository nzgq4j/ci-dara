import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildSystemPrompt, buildUserPrompt, parseResult } from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';

export interface EvalSummary {
  ok: boolean;
  results: number;
  errors: number;
  error?: string;
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
            criteria: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
            solDocs: true
          }
        },
        response: { include: { files: true } }
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

  const { provider, model, apiKey } = resolveCompanyAI(company);
  if (!apiKey) {
    return fail(evaluationId, companyId, `No API key configured for provider "${provider}".`);
  }

  const documentText = concatDocs(evaluation.response.files);
  if (documentText.trim() === '') {
    return fail(
      evaluationId,
      companyId,
      'No extracted proposal text. Upload offeror documents and ensure extraction completed.'
    );
  }
  const solText = concatDocs(evaluation.solicitation.solDocs);

  const criteria = evaluation.solicitation.criteria;
  if (criteria.length === 0) {
    return fail(evaluationId, companyId, 'No criteria defined for this solicitation.');
  }

  let results = 0;
  let errors = 0;

  for (const criterion of criteria) {
    const system = buildSystemPrompt(persona, criterion, evaluation.solicitation);
    const user = buildUserPrompt(criterion, documentText, solText);

    try {
      // LLM call OUTSIDE any transaction — this is the slow network hop.
      const ai = await complete(provider, system, user, model, apiKey);
      const parsed = parseResult(ai.text, criterion.criterionType);
      if (!parsed) {
        errors++;
        continue;
      }
      // Persist this criterion's result in its own short tenant burst, so partial
      // progress survives a later criterion failing.
      await withTenant(companyId, (tx) =>
        tx.result.upsert({
          where: {
            evaluationId_criterionId_personaId: {
              evaluationId,
              criterionId: criterion.id,
              personaId: persona.id
            }
          },
          create: {
            evaluationId,
            companyId,
            criterionId: criterion.id,
            personaId: persona.id,
            aiDetermination: parsed.aiDetermination,
            aiScore: parsed.aiScore,
            aiRationale: parsed.aiRationale,
            aiConfidence: parsed.aiConfidence,
            modelId: model,
            tokenIn: ai.tokenIn,
            tokenOut: ai.tokenOut
          },
          update: {
            aiDetermination: parsed.aiDetermination,
            aiScore: parsed.aiScore,
            aiRationale: parsed.aiRationale,
            aiConfidence: parsed.aiConfidence,
            modelId: model,
            tokenIn: ai.tokenIn,
            tokenOut: ai.tokenOut
          }
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
