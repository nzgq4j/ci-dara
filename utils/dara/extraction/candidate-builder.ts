// Pass 1 — candidate selection from the ParseResult (deterministic; no spaCy re-run, no LLM).
//
// Reads `deduplicated_candidates[]` (or `modal_candidates[]` fallback) and obligation-bearing
// `tables[]`, and returns one RequirementCandidate per pre-identified obligation. This step CANNOT
// invent obligations — it only reshapes what the Modal parser already found.

import type { ParseResult, ModalCandidate } from '@/utils/dara/parse-result';
import { buildSectionClassMap, sectionPathOf } from './section-classifier';
import type { RequirementCandidate, UCFSectionType, Confidence } from './types';

function conf(v: string | null | undefined): Confidence {
  return v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' ? v : 'MEDIUM';
}

// Passive-voice subject resolution (spec §Pass 1): parent_paragraph_text → section_context → default
// by UCF section. Both parser fields are often null (the current Modal build hardcodes them), so the
// default path carries most cases; flagged via subject_inferred.
function resolveSubject(c: ModalCandidate, ucf: UCFSectionType): { subject: string; inferred: boolean } {
  if (c.subject && !c.subject_inferred) return { subject: c.subject, inferred: false };
  if (c.parent_paragraph_text) return { subject: c.subject ?? 'Contractor', inferred: true };
  if (c.section_context) return { subject: c.subject ?? 'Contractor', inferred: true };
  const govSection = ucf === 'OTHER' || ucf === 'BACKGROUND';
  return { subject: c.subject ?? (govSection ? 'Government' : 'Contractor'), inferred: true };
}

export function buildCandidates(result: ParseResult): RequirementCandidate[] {
  const sectionClass = buildSectionClassMap(result.sections);
  const sections = result.sections ?? [];

  // paragraph_id → page_number, for candidates that carry no page directly.
  const pageByPara = new Map<string, number | null>();
  for (const p of result.paragraphs ?? []) pageByPara.set(p.paragraph_id, p.page_number ?? null);

  // Index triggers / IbR flags by sentence_id so each candidate can carry its own ids.
  const triggersBySent = new Map<string, string[]>();
  for (const t of result.conditional_triggers ?? []) {
    const arr = triggersBySent.get(t.sentence_id) ?? [];
    arr.push(t.trigger_id);
    triggersBySent.set(t.sentence_id, arr);
  }
  const ibrBySent = new Map<string, string[]>();
  for (const f of result.ibr_flags ?? []) {
    if (!f.sentence_id) continue;
    const arr = ibrBySent.get(f.sentence_id) ?? [];
    arr.push(f.flag_id);
    ibrBySent.set(f.sentence_id, arr);
  }

  const out: RequirementCandidate[] = [];

  // Sentence-derived candidates (prefer the deduplicated list when the parser produced one).
  const modalCandidates = result.deduplicated_candidates?.length
    ? result.deduplicated_candidates
    : result.modal_candidates ?? [];

  for (const c of modalCandidates) {
    const ucf = (c.section_id && sectionClass.get(c.section_id)) || 'OTHER';
    const subj = resolveSubject(c, ucf);
    out.push({
      candidateId: c.candidate_id,
      sourceText: c.source_text,
      modalVerb: c.modal_verb,
      modalClass: c.modal_class,
      subject: subj.subject,
      subjectInferred: subj.inferred,
      verbPhrase: c.verb_phrase,
      object: c.object,
      svoConfidence: conf(c.svo_confidence),
      ucfSectionType: ucf,
      sectionPath: sectionPathOf(sections, c.section_id),
      sectionId: c.section_id,
      paragraphId: c.paragraph_id,
      sentenceId: c.sentence_id,
      pageNumber: pageByPara.get(c.paragraph_id) ?? null,
      isPassive: !!c.is_passive,
      isTableDerived: false,
      isCdrl: false,
      conditionalTriggerIds: triggersBySent.get(c.sentence_id) ?? [],
      ibrFlagIds: ibrBySent.get(c.sentence_id) ?? [],
      duplicateSourceIds: c.duplicate_source_ids ?? []
    });
  }

  // Table-derived candidates: one per obligation-bearing row. CDRL rows already carry any DID IbR flags
  // in row.ibr_flags (the Modal parser scans reconstructed_text), so no extra flag is synthesized here.
  for (const tbl of result.tables ?? []) {
    if (!tbl.is_obligation_bearing) continue;
    const ucf: UCFSectionType = (tbl.section_id && sectionClass.get(tbl.section_id)) || (tbl.is_cdrl ? 'CDRL' : 'OTHER');
    for (const row of tbl.rows ?? []) {
      const text = (row.reconstructed_text || '').trim();
      if (!text || !(row.modal_verbs_found?.length || tbl.is_cdrl)) continue;
      const rowId = `${tbl.table_id}-r${row.row_index}`;
      out.push({
        candidateId: rowId,
        sourceText: text,
        modalVerb: row.modal_verbs_found?.[0] ?? 'shall',
        modalClass: 'MANDATORY',
        subject: 'Contractor',
        subjectInferred: true,
        verbPhrase: null,
        object: null,
        svoConfidence: 'MEDIUM',
        ucfSectionType: ucf,
        sectionPath: sectionPathOf(sections, tbl.section_id),
        sectionId: tbl.section_id,
        paragraphId: tbl.table_id,
        sentenceId: rowId,
        pageNumber: tbl.page_number ?? null,
        isPassive: false,
        isTableDerived: true,
        isCdrl: tbl.is_cdrl,
        tableHeaders: tbl.headers,
        conditionalTriggerIds: [],
        ibrFlagIds: row.ibr_flags ?? [],
        duplicateSourceIds: []
      });
    }
  }

  return out;
}
