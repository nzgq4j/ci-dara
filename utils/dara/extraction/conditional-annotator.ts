// Pass 2 — conditional annotation from the ParseResult (deterministic; no re-detection).
//
// Matches `conditional_triggers[]` to Pass-1 candidates and ATTACHES each as a ConditionAnnotation.
// A nested exception stack (UNLESS/EXCEPT) links each exception to the condition it modifies via
// parent_condition_id.
//
// IMPORTANT (fix, 2026-07-13): this pass ANNOTATES ONLY — it never spawns a new requirement. An earlier
// version created a requirement for every trigger that didn't exact-match a candidate, which produced
// hundreds of generic "Conditional obligation (IF)" junk rows. Matching now falls back from exact
// sentence_id to same-paragraph, and any trigger that still matches nothing is simply dropped (logged),
// not turned into a row.

import type { ParseResult, ConditionalTrigger } from '@/utils/dara/parse-result';
import type { ClassifiedCandidate, AnnotatedCandidate, ConditionAnnotation } from './types';

// Deterministic ordering for the exception stack: by sentence_id (document order).
function orderTriggers(triggers: ConditionalTrigger[]): ConditionalTrigger[] {
  return [...triggers].sort((a, b) => (a.sentence_id < b.sentence_id ? -1 : a.sentence_id > b.sentence_id ? 1 : 0));
}

export function annotateConditionals(
  classified: ClassifiedCandidate[],
  result: ParseResult
): AnnotatedCandidate[] {
  const triggers = orderTriggers(result.conditional_triggers ?? []);

  // Stack-based parent linking for nested exceptions.
  const parentOf = new Map<string, string | null>();
  const stack: string[] = [];
  for (const t of triggers) {
    if (t.condition_type === 'UNLESS' || t.condition_type === 'EXCEPT') {
      parentOf.set(t.trigger_id, stack.length ? stack[stack.length - 1] : null);
    } else {
      parentOf.set(t.trigger_id, null);
      stack.push(t.trigger_id);
    }
  }

  const toAnnotation = (t: ConditionalTrigger): ConditionAnnotation => ({
    triggerId: t.trigger_id,
    conditionType: t.condition_type,
    triggerText: t.trigger_text,
    scopeText: t.scope_text,
    confidence: t.condition_confidence,
    parentConditionId: parentOf.get(t.trigger_id) ?? null
  });

  // sentence_id → paragraph_id, so a trigger can fall back to annotating same-paragraph candidates.
  const paraBySentence = new Map<string, string>();
  for (const s of result.sentences ?? []) paraBySentence.set(s.sentence_id, s.paragraph_id);

  // Candidate indexes for matching.
  const bySentence = new Map<string, ClassifiedCandidate[]>();
  const byParagraph = new Map<string, ClassifiedCandidate[]>();
  for (const c of classified) {
    const s = bySentence.get(c.sentenceId) ?? [];
    s.push(c);
    bySentence.set(c.sentenceId, s);
    const p = byParagraph.get(c.paragraphId) ?? [];
    p.push(c);
    byParagraph.set(c.paragraphId, p);
  }

  const annotatedById = new Map<string, ConditionAnnotation[]>();
  let dropped = 0;
  for (const t of triggers) {
    let hits = bySentence.get(t.sentence_id);
    if (!hits || hits.length === 0) {
      const para = paraBySentence.get(t.sentence_id);
      hits = para ? byParagraph.get(para) : undefined;
    }
    if (!hits || hits.length === 0) {
      dropped++;
      continue;
    }
    for (const c of hits) {
      const arr = annotatedById.get(c.candidateId) ?? [];
      arr.push(toAnnotation(t));
      annotatedById.set(c.candidateId, arr);
    }
  }
  if (dropped > 0) console.warn(`[shred] Pass 2: ${dropped} conditional trigger(s) matched no requirement — dropped (not turned into rows)`);

  return classified.map((c) => ({ ...c, conditions: annotatedById.get(c.candidateId) ?? [] }));
}
