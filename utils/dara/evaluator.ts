import { prisma } from '@/utils/prisma';
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
    .filter((f) => f.extractionStatus === 'complete' && (f.extractedText ?? '').trim() !== '')
    .map((f) => `=== ${f.originalFilename} ===\n\n${f.extractedText}`)
    .join('\n\n');
}

async function fail(evaluationId: bigint, message: string): Promise<EvalSummary> {
  await prisma.evaluation.update({
    where: { id: evaluationId },
    data: { status: 'failed', errorMessage: message.slice(0, 500) }
  });
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
  const evaluation = await prisma.evaluation.findFirst({
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
  if (!evaluation) {
    return { ok: false, results: 0, errors: 0, error: 'Evaluation not found.' };
  }

  await prisma.evaluation.update({
    where: { id: evaluationId },
    data: { status: 'running' }
  });

  const persona = await prisma.persona.findFirst({
    where: { id: evaluation.personaId, companyId }
  });
  if (!persona) return fail(evaluationId, 'Persona not found.');

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return fail(evaluationId, 'Company not found.');

  const { provider, model, apiKey } = resolveCompanyAI(company);
  if (!apiKey) {
    return fail(evaluationId, `No API key configured for provider "${provider}".`);
  }

  const documentText = concatDocs(evaluation.response.files);
  if (documentText.trim() === '') {
    return fail(
      evaluationId,
      'No extracted proposal text. Upload offeror documents and ensure extraction completed.'
    );
  }
  const solText = concatDocs(evaluation.solicitation.solDocs);

  const criteria = evaluation.solicitation.criteria;
  if (criteria.length === 0) {
    return fail(evaluationId, 'No criteria defined for this solicitation.');
  }

  let results = 0;
  let errors = 0;

  for (const criterion of criteria) {
    const system = buildSystemPrompt(persona, criterion, evaluation.solicitation);
    const user = buildUserPrompt(criterion, documentText, solText);

    try {
      const ai = await complete(provider, system, user, model, apiKey);
      const parsed = parseResult(ai.text, criterion.criterionType);
      if (!parsed) {
        errors++;
        continue;
      }
      await prisma.result.upsert({
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
      });
      results++;
    } catch {
      errors++;
    }
  }

  await prisma.evaluation.update({
    where: { id: evaluationId },
    data: {
      status: results > 0 ? 'complete' : 'failed',
      completedAt: new Date(),
      errorMessage: results === 0 ? 'All criteria failed to evaluate.' : null
    }
  });

  return { ok: results > 0, results, errors };
}
