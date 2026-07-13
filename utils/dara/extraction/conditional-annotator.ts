// Pass 2 — conditional annotation from the ParseResult (deterministic; no re-detection).
//
// Matches `conditional_triggers[]` to Pass-1 candidates by sentence_id, attaching each trigger as a
// ConditionAnnotation. A nested exception stack (UNLESS/EXCEPT) links each exception to the condition
// it modifies via parent_condition_id. Triggers that match no candidate become their own requirement,
// flagged for human review (never silently dropped).

import type { ParseResult, ConditionalTrigger } from '@/utils/dara/parse-result';
import { sectionPathOf } from './section-classifier';
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

  // Stack-based parent linking for nested exceptions. A base condition (IF/WHEN/UPON) opens a scope; an
  // exception (UNLESS/EXCEPT) attaches to the currently-open base condition.
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

  // Candidates by sentence_id for exact matching.
  const bySentence = new Map<string, ClassifiedCandidate[]>();
  for (const c of classified) {
    const arr = bySentence.get(c.sentenceId) ?? [];
    arr.push(c);
    bySentence.set(c.sentenceId, arr);
  }

  const matched = new Set<string>();
  const annotatedById = new Map<string, ConditionAnnotation[]>();
  for (const t of triggers) {
    const hits = bySentence.get(t.sentence_id);
    if (hits && hits.length) {
      matched.add(t.trigger_id);
      for (const c of hits) {
        const arr = annotatedById.get(c.candidateId) ?? [];
        arr.push(toAnnotation(t));
        annotatedById.set(c.candidateId, arr);
      }
    }
  }

  const out: AnnotatedCandidate[] = classified.map((c) => ({
    ...c,
    conditions: annotatedById.get(c.candidateId) ?? []
  }));

  // Unmatched triggers → a flagged requirement of their own.
  for (const t of triggers) {
    if (matched.has(t.trigger_id)) continue;
    out.push({
      candidateId: `cond-${t.trigger_id}`,
      sourceText: t.scope_text || t.trigger_text,
      modalVerb: 'shall',
      modalClass: 'MANDATORY',
      subject: 'Contractor',
      subjectInferred: true,
      verbPhrase: null,
      object: null,
      svoConfidence: 'LOW',
      ucfSectionType: 'OTHER',
      sectionPath: sectionPathOf(result.sections, null),
      sectionId: null,
      paragraphId: '',
      sentenceId: t.sentence_id,
      pageNumber: null,
      isPassive: false,
      isTableDerived: false,
      isCdrl: false,
      conditionalTriggerIds: [t.trigger_id],
      ibrFlagIds: [],
      duplicateSourceIds: [],
      classification: {
        id: `cond-${t.trigger_id}`,
        isRequirement: true,
        source: 'OTHER',
        disposition: 'compliance',
        title: `Conditional obligation (${t.condition_type})`,
        normalizedMeaning: t.scope_text || t.trigger_text,
        parentCandidateId: null,
        confidence: 'LOW'
      },
      conditions: [toAnnotation(t)]
    });
  }

  return out;
}
