// Pass 1 — candidate selection from the ParseResult (deterministic; no spaCy re-run, no LLM).
//
// Reads `deduplicated_candidates[]` (or `modal_candidates[]` fallback) and obligation-bearing
// `tables[]`, and returns one RequirementCandidate per pre-identified obligation. This step CANNOT
// invent obligations — it only reshapes what the Modal parser already found.

import type { ParseResult, ModalCandidate } from '@/utils/dara/parse-result';
import { buildSectionClassMap, buildPageClassMap, sectionPathOf } from './section-classifier';
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

// Split a source_text that contains multiple bullet-prefixed obligations into individual items.
// Returns the original single string when it doesn't look like a multi-bullet list.
// Bullet patterns: • – * at line start, or numbered "1." / "(1)" items on separate lines.
const BULLET_SPLIT_RE = /\n\s*(?:[•\-–*]|\d+[.)]\s|\([a-z\d]\)\s)/;
function splitBullets(text: string): string[] {
  if (!BULLET_SPLIT_RE.test(text)) return [text];
  const lines = text.split(/\n/);
  const items: string[] = [];
  let current = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[•\-–*]|\d+[.)]\s|\([a-z\d]\)\s/.test(trimmed)) {
      if (current.trim()) items.push(current.trim());
      current = trimmed.replace(/^[•\-–*]\s*/, '');
    } else {
      current = current ? `${current} ${trimmed}` : trimmed;
    }
  }
  if (current.trim()) items.push(current.trim());
  // Only split when we found at least 2 distinct bullets; otherwise return original.
  return items.length >= 2 ? items : [text];
}

export function buildCandidates(result: ParseResult): RequirementCandidate[] {
  const sectionClass = buildSectionClassMap(result.sections);
  const pageClass = buildPageClassMap(result); // fallback when sections[] is empty
  const sections = result.sections ?? [];
  const hasSections = sections.length > 0;

  // Resolve UCF type: prefer section-id classification, fall back to page-level when no sections.
  const resolveUcf = (sectionId: string | null | undefined, pageNumber: number | null): UCFSectionType => {
    if (sectionId) return sectionClass.get(sectionId) || 'OTHER';
    if (!hasSections && pageNumber != null) return pageClass.get(pageNumber) || 'OTHER';
    return 'OTHER';
  };

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
    const page = pageByPara.get(c.paragraph_id) ?? null;
    const ucf = resolveUcf(c.section_id, page);
    const subj = resolveSubject(c, ucf);

    // Split multi-obligation bullets: when a single candidate's source_text contains multiple
    // bullet-prefixed lines (•, –, *, or numbered items), emit one sub-candidate per bullet so
    // the classify pass can assess each obligation independently. This catches Section L lists
    // like "• All pages shall be numbered. • Tables shall be at least 9-point font." that the
    // Modal parser collapses into one sentence.
    const bullets = splitBullets(c.source_text);
    if (bullets.length > 1) {
      bullets.forEach((bullet, bi) => {
        out.push({
          candidateId: `${c.candidate_id}-b${bi}`,
          sourceText: bullet,
          modalVerb: c.modal_verb,
          modalClass: c.modal_class,
          subject: subj.subject,
          subjectInferred: subj.inferred,
          verbPhrase: c.verb_phrase,
          object: null,
          svoConfidence: conf(c.svo_confidence),
          ucfSectionType: ucf,
          sectionPath: sectionPathOf(sections, c.section_id),
          sectionId: c.section_id,
          paragraphId: c.paragraph_id,
          sentenceId: `${c.sentence_id}-b${bi}`,
          pageNumber: page,
          isPassive: !!c.is_passive,
          isTableDerived: false,
          isCdrl: false,
          conditionalTriggerIds: triggersBySent.get(c.sentence_id) ?? [],
          ibrFlagIds: ibrBySent.get(c.sentence_id) ?? [],
          duplicateSourceIds: []
        });
      });
      continue;
    }

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
      pageNumber: page,
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
  //
  // Modal-verb gate relaxation: the parser's is_obligation_bearing flag and row.modal_verbs_found are
  // derived from grammar signals, which miss two important table types in federal solicitations:
  //
  //   1. SUBMISSION-STRUCTURE tables (Section L) — "Part / Required Documentation / Format / Page
  //      Limitation" tables define volume structure requirements with no modal verbs. Every row is a
  //      discrete requirement: what to submit, in what format, with what page limit.
  //
  //   2. RATING-SCALE tables (Section M) — "Technical Ratings / Description" or "Factor / Rating /
  //      Definition" tables define evaluation criteria with no "shall". Each row (Outstanding, Good,
  //      Acceptable, etc.) is a grading standard the offeror must target.
  //
  // Both types are identified by header-pattern matching and included regardless of modal-verb content.

  // Detect a submission-structure table by its headers.
  const isSubmissionTable = (headers: string[]): boolean => {
    const joined = headers.join(' ').toLowerCase();
    return /page.?limit|documentation|required.doc|submission|format.*page|part.*documentation/i.test(joined);
  };

  // Detect a rating-scale or evaluation-definition table by its headers.
  const isRatingTable = (headers: string[]): boolean => {
    const joined = headers.join(' ').toLowerCase();
    return /technical.?rating|rating.*description|evaluation.*factor.*rating|adjectival|outstanding|definitions.*strength|rating.*scale/i.test(joined);
  };

  for (const tbl of result.tables ?? []) {
    const ucf: UCFSectionType = resolveUcf(tbl.section_id, tbl.page_number ?? null) !== 'OTHER'
      ? resolveUcf(tbl.section_id, tbl.page_number ?? null)
      : tbl.is_cdrl ? 'CDRL' : 'OTHER';

    const headers = tbl.headers ?? [];
    const submissionTable = isSubmissionTable(headers);
    const ratingTable = isRatingTable(headers);

    // Determine whether to include this table at all.
    // Include when: is_obligation_bearing OR is a submission/rating table in an L/M context.
    const inSectionLM = ucf === 'SECTION_L' || ucf === 'SECTION_M';
    const includeTable = tbl.is_obligation_bearing || ((submissionTable || ratingTable) && inSectionLM);
    if (!includeTable && !tbl.is_cdrl) continue;

    // Determine the UCF override for special table types.
    const effectiveUcf: UCFSectionType = ratingTable
      ? 'SECTION_M'
      : submissionTable
        ? 'SECTION_L'
        : ucf;

    for (const row of tbl.rows ?? []) {
      const text = (row.reconstructed_text || '').trim();
      if (!text) continue;

      const hasModal = (row.modal_verbs_found?.length ?? 0) > 0;
      // Row gate: pass if it has a modal verb, is a CDRL, is a submission-structure row,
      // or is a rating-scale row (all rows matter regardless of grammar).
      const includeRow = hasModal || tbl.is_cdrl || submissionTable || ratingTable;
      if (!includeRow) continue;

      const rowId = `${tbl.table_id}-r${row.row_index}`;
      out.push({
        candidateId: rowId,
        sourceText: text,
        modalVerb: row.modal_verbs_found?.[0] ?? 'shall',
        modalClass: 'MANDATORY',
        subject: effectiveUcf === 'SECTION_M' ? 'Government' : 'Contractor',
        subjectInferred: true,
        verbPhrase: null,
        object: null,
        svoConfidence: hasModal ? 'MEDIUM' : 'LOW',
        ucfSectionType: effectiveUcf,
        sectionPath: sectionPathOf(sections, tbl.section_id),
        sectionId: tbl.section_id,
        paragraphId: tbl.table_id,
        sentenceId: rowId,
        pageNumber: tbl.page_number ?? null,
        isPassive: false,
        isTableDerived: true,
        isCdrl: tbl.is_cdrl,
        tableHeaders: headers,
        conditionalTriggerIds: [],
        ibrFlagIds: row.ibr_flags ?? [],
        duplicateSourceIds: []
      });
    }
  }

  return out;
}
