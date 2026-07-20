// Auto-verification for administrative / format review findings.
//
// The compliance_format review pass flags administrative and format gaps (missing form, absent
// section, over-limit volume, submission-mechanic misses). Many of those are actually satisfied in
// the proposal draft — the pass just flags conservatively. This step re-checks each such finding
// STRICTLY against the draft text and reports which ones are demonstrably satisfied, so they can be
// auto-resolved. Anything it cannot confirm from the text is left for the user to acknowledge.
//
// It is deliberately conservative (temperature 0, evidence required) — a false "satisfied" would
// hide a real compliance gap, so when in doubt it says not-satisfied.

import { complete } from '@/utils/dara/providers';

export interface FindingVerdict {
  satisfied: boolean;
  evidence: string;
}

// Pull the first JSON object out of a model response (handles ```json fences / prose wrappers).
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : '{}';
}

/**
 * Verify administrative/format findings against the proposal draft. Returns a map from the
 * finding's index (its position in `findings`) to a verdict. Missing entries = not verified
 * (treat as not satisfied). Best-effort: any failure yields an empty map (nothing auto-resolved).
 */
export async function verifyAdminFindings(
  findings: { text: string; requirementRef: string }[],
  proposalText: string,
  provider: string,
  model: string,
  apiKey: string
): Promise<{ verdicts: Map<number, FindingVerdict>; tokenIn: number; tokenOut: number }> {
  const verdicts = new Map<number, FindingVerdict>();
  if (findings.length === 0 || proposalText.trim() === '' || !apiKey) {
    return { verdicts, tokenIn: 0, tokenOut: 0 };
  }

  const system =
    'You are auditing administrative and format compliance findings against a proposal draft. ' +
    'For each finding (an alleged administrative/format gap), decide STRICTLY from the proposal ' +
    'draft text whether the item the finding complains about is ALREADY satisfied in the draft. ' +
    'Mark satisfied=true ONLY when the draft gives clear textual evidence of compliance. If the ' +
    'text does not clearly show it is satisfied — including format attributes that simply cannot ' +
    'be seen in extracted text (exact font, margins, spacing) — mark satisfied=false so a human ' +
    'confirms it manually. Never guess; a wrong "satisfied" hides a real gap.';

  const user =
    `PROPOSAL DRAFT (extracted text):\n${proposalText.slice(0, 60000)}\n\n` +
    `FINDINGS (each is an alleged administrative/format gap; classify by its index):\n` +
    findings.map((f, i) => `[${i}] ${f.text}${f.requirementRef ? ` (ref: ${f.requirementRef})` : ''}`).join('\n') +
    `\n\nReturn ONLY JSON of the form: ` +
    `{"verdicts":[{"index":<finding index>,"satisfied":<true|false>,"evidence":"<short quote or location from the draft, or empty>"}]}`;

  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, 4000, 0);
  } catch {
    return { verdicts, tokenIn: 0, tokenOut: 0 };
  }

  try {
    const parsed = JSON.parse(extractJson(ai.text)) as { verdicts?: { index?: number; satisfied?: boolean; evidence?: string }[] };
    for (const v of parsed.verdicts ?? []) {
      if (typeof v?.index === 'number' && v.index >= 0 && v.index < findings.length) {
        verdicts.set(v.index, { satisfied: v.satisfied === true, evidence: String(v.evidence ?? '').slice(0, 300) });
      }
    }
  } catch {
    /* best-effort — leave everything for manual acknowledgment */
  }

  return { verdicts, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut };
}
