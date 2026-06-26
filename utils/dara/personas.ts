import { prisma } from '@/utils/prisma';

// The five built-in evaluator personas, ported from the original DARA WordPress
// plugin (CruxInsight\Personas\PersonaManager). systemPrompt is the role
// template; the JSON-format instruction is appended by the prompt builder at
// evaluation time, so it must NOT be included here.
//
// Template variables available: {{CRITERION_NAME}}, {{CRITERION_DESCRIPTION}},
// {{SOLICITATION_TITLE}}, {{REFERENCE_NUMBER}}, {{FAR_REFERENCE}}.
export const PERSONA_TEMPLATE_VARS = [
  '{{CRITERION_NAME}}',
  '{{CRITERION_DESCRIPTION}}',
  '{{SOLICITATION_TITLE}}',
  '{{REFERENCE_NUMBER}}',
  '{{FAR_REFERENCE}}'
] as const;

export const BUILTIN_PERSONAS: { displayName: string; systemPrompt: string }[] = [
  {
    displayName: 'Technical Evaluator',
    systemPrompt:
      'You are a government Technical Evaluation Panel (TEP) member. Evaluate the proposal against: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}.'
  },
  {
    displayName: 'Contracting Officer',
    systemPrompt:
      'You are a Contracting Officer reviewing for regulatory compliance. Criterion: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}.'
  },
  {
    displayName: 'Past Performance Evaluator',
    systemPrompt:
      'You are a Past Performance Evaluation Board (PPEB) member. Criterion: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}.'
  },
  {
    displayName: 'Management & Risk Evaluator',
    systemPrompt:
      'You are a Government Management and Risk Evaluator. Criterion: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}.'
  },
  {
    displayName: 'Small Business Reviewer',
    systemPrompt:
      'You are a Small Business Technical Advisor reviewing subcontracting plans. Criterion: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}.'
  }
];

/**
 * Ensure the company has the built-in personas. Idempotent: only creates ones
 * whose displayName is not already present for the company. Returns the number
 * created.
 */
export async function seedBuiltinPersonas(companyId: bigint): Promise<number> {
  const existing = await prisma.persona.findMany({
    where: { companyId },
    select: { displayName: true }
  });
  const have = new Set(existing.map((p) => p.displayName));
  const toCreate = BUILTIN_PERSONAS.map((p, i) => ({ ...p, sortOrder: i })).filter(
    (p) => !have.has(p.displayName)
  );
  if (toCreate.length === 0) return 0;

  await prisma.persona.createMany({
    data: toCreate.map((p) => ({
      companyId,
      displayName: p.displayName,
      systemPrompt: p.systemPrompt,
      isActive: true,
      sortOrder: p.sortOrder
    }))
  });
  return toCreate.length;
}
