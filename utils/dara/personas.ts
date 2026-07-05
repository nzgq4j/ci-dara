import type { TenantTx } from '@/utils/prisma';

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
 * Render a set of personas into a reviewer-lens guidance block for injection into the review
 * prompts (passes + direct). Each persona's free-text systemPrompt is the user's tweak knob —
 * this is how results get steered without touching the hardcoded prompt. Legacy per-criterion
 * templates are tidied: solicitation vars are filled, and sentences that reference the (now
 * absent) single criterion/FAR — or still carry a leftover `{{...}}` token — are dropped, so
 * the block reads as a clean list of perspectives. Returns '' when there's nothing to apply.
 */
export function renderPersonaGuidance(
  personas: { displayName: string; systemPrompt: string }[],
  ctx: { title?: string; solNumber?: string }
): string {
  const SENT = String.fromCharCode(0);
  const items = personas
    .map((p) => {
      const filled = p.systemPrompt
        .split('{{SOLICITATION_TITLE}}')
        .join(ctx.title ?? '')
        .split('{{REFERENCE_NUMBER}}')
        .join(ctx.solNumber ?? '')
        .replace(/\{\{[^}]*\}\}/g, SENT); // sentinel-mark any leftover legacy var (criterion/FAR)
      const text = filled
        .split(/(?<=[.!?])\s+/) // by sentence
        .map((seg) => seg.replace(/\s+/g, ' ').trim())
        .filter((seg) => seg && !seg.includes(SENT) && !/^(Solicitation|FAR|Criterion)\s*:/i.test(seg))
        .join(' ')
        .replace(/\s+([.,;:])/g, '$1')
        .trim();
      return { name: p.displayName.trim(), text };
    })
    .filter((p) => p.text);
  if (items.length === 0) return '';
  return items.map((p) => `- ${p.name}: ${p.text}`).join('\n');
}

/**
 * Ensure the company has the built-in personas. Idempotent: only creates ones
 * whose displayName is not already present for the company. Returns the number
 * created.
 *
 * Takes the active tenant transaction (`tx` from withTenant) so the caller owns
 * the tenant context — RLS scopes these reads/writes to the GUC'd company.
 */
export async function seedBuiltinPersonas(tx: TenantTx, companyId: bigint): Promise<number> {
  const existing = await tx.persona.findMany({
    where: { companyId },
    select: { displayName: true }
  });
  const have = new Set(existing.map((p) => p.displayName));
  const toCreate = BUILTIN_PERSONAS.map((p, i) => ({ ...p, sortOrder: i })).filter(
    (p) => !have.has(p.displayName)
  );
  if (toCreate.length === 0) return 0;

  await tx.persona.createMany({
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
