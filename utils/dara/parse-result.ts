// ParseResult — the JSON contract returned by the Modal `dara-parser` service
// (pdfplumber / python-docx + spaCy en_core_web_md). Mirrors modal/app.py's output.
//
// Every field is treated as potentially null/absent for backward compatibility: the
// schema/parser can evolve, and older stored parse rows may predate newer fields. The
// consumers (the shred's structured-input path and the platform-admin parse-history UI)
// must never crash on a missing field. This module is pure types + trivial helpers —
// no `@/` or app imports — so it can be shared by the app-free HRLR prompt builder and
// the app-bound Modal client alike.

export interface ParseResult {
  schema_version: '1.0';
  document_id: string;
  doc_type: 'pdf' | 'docx';
  page_count: number | null;
  word_count: number;
  processing_time_ms: number;
  parser_version: string;

  quality_gate_passed: boolean;
  quality_gate_failures: QualityGateFailure[];

  pages: Page[];
  sections: Section[];
  tables: ParsedTable[];
  paragraphs: Paragraph[];
  sentences: Sentence[];
  modal_candidates: ModalCandidate[];
  // Present only on parse results produced after the Modal dedup change (2026-07-13). When present the
  // extraction pipeline reads it in preference to `modal_candidates`; older rows fall back.
  deduplicated_candidates?: ModalCandidate[];
  conditional_triggers: ConditionalTrigger[];
  named_entities: NamedEntity[];
  ibr_flags: IbrFlag[];

  modal_candidate_count: number;
  table_count: number;
  ibr_flag_count: number;
  image_page_count: number;
}

export interface QualityGateFailure {
  gate: 'text_density' | 'structure_detection' | 'encoding_validity' | 'image_layer';
  affected_pages: number[];
  detail: string;
}

export interface Page {
  page_number: number;
  width: number;
  height: number;
  word_count: number;
  has_text_layer: boolean;
  image_only: boolean;
  section_id: string | null;
}

export interface Section {
  section_id: string;
  heading_text: string;
  heading_level: number;
  source_numbering: string | null;
  synthetic_path: string;
  page_start: number;
  page_end: number;
  parent_section_id: string | null;
  font_size: number | null;
  bold: boolean;
}

export interface ParsedTable {
  table_id: string;
  page_number: number | null;
  section_id: string | null;
  bbox: [number, number, number, number] | null;
  headers: string[];
  rows: TableRow[];
  is_cdrl: boolean;
  is_obligation_bearing: boolean;
}

export interface TableRow {
  row_index: number;
  cells: Record<string, string>;
  reconstructed_text: string;
  modal_verbs_found: string[];
  ibr_flags: string[];
}

export interface Paragraph {
  paragraph_id: string;
  section_id: string | null;
  page_number: number | null;
  text: string;
  element_type: 'body' | 'list_item' | 'continuation';
  list_level: number | null;
  parent_paragraph_id: string | null;
  bbox: [number, number, number, number] | null;
}

export interface Sentence {
  sentence_id: string;
  paragraph_id: string;
  section_id: string | null;
  text: string;
  char_start: number;
  char_end: number;
  has_modal_verb: boolean;
  is_passive: boolean;
  is_conditional: boolean;
}

export interface ModalCandidate {
  candidate_id: string;
  sentence_id: string;
  paragraph_id: string;
  section_id: string | null;
  source_text: string;
  modal_verb: string;
  modal_class: 'MANDATORY' | 'PROHIBITION' | 'PERMISSION' | 'PREDICTIVE' | 'AMBIGUOUS';
  subject: string | null;
  subject_inferred: boolean;
  subject_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  verb_phrase: string | null;
  object: string | null;
  is_passive: boolean;
  svo_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  section_context: string | null;
  parent_paragraph_text: string | null;
  // Set by the Modal dedup pass: candidate_ids of near-duplicates merged into this one. Absent on
  // pre-dedup parse results.
  duplicate_source_ids?: string[];
}

export interface ConditionalTrigger {
  trigger_id: string;
  sentence_id: string;
  condition_type: 'IF' | 'WHEN' | 'UPON' | 'UNLESS' | 'EXCEPT' | 'SUPERSEDES';
  trigger_text: string;
  scope_text: string;
  condition_confidence: 'EXPLICIT' | 'INFERRED';
}

export interface NamedEntity {
  entity_id: string;
  sentence_id: string;
  text: string;
  label: string;
  start_char: number;
  end_char: number;
  source: 'statistical' | 'rule_based';
}

export interface IbrFlag {
  flag_id: string;
  sentence_id: string | null;
  table_row_id: string | null;
  citation_text: string;
  citation_type: 'FAR' | 'DFARS' | 'DID' | 'NIST' | 'MIL_STD' | 'OTHER';
  traversal_status: 'PENDING';
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Reconstruct the linear source text of a parsed document by joining its paragraph
 * texts in document order. This is what the HRLR shred anchors verbatim provenance
 * against when it takes the structured path, so it must contain the real body text
 * (it does: pdfplumber page text / python-docx paragraph text). Defensive against a
 * missing/empty `paragraphs` array (returns '').
 */
export function joinParagraphs(result: ParseResult | null | undefined): string {
  const paras = result?.paragraphs;
  if (!Array.isArray(paras) || paras.length === 0) return '';
  return paras
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .filter((t) => t.trim() !== '')
    .join('\n\n');
}

/** Narrow an unknown JSONB value (as stored in `dara_parse_results.result`) to a ParseResult. */
export function asParseResult(value: unknown): ParseResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ParseResult>;
  // Minimal shape check — enough to trust the arrays exist; individual fields stay optional.
  if (!Array.isArray(v.paragraphs)) return null;
  return value as ParseResult;
}
