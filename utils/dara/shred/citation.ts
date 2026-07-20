// Deterministic text + citation helpers for the shred. Pure functions, no DB/LLM.
//
// These enforce two data-QC invariants without any model involvement:
//   1. A requirement's citation is DERIVED from the parser's own section structure — never
//      invented by the LLM, never a leaked parser handle (`cand-…`, `sent-…`, `t123`).
//   2. Requirement text is the parser's verbatim sentence, normalized only enough to survive
//      pdfplumber artifacts (soft hyphens, doubled whitespace) so grounding matches reliably.

import type { ModalCandidate, ParseResult, Section } from '@/utils/dara/parse-result';

// Internal parser id handles that must never surface as a user-facing citation or name.
// Anchored to the Modal parser's ACTUAL id shapes (verified against live data): candidates are
// `cand-sent-para-…`, sentences `sent-para-…`, paragraphs `para-…`; `trigger-`/`t\d` are legacy
// conditional-trigger ids. Deliberately narrow so real content like "F-16", "T-1 Technical", or
// "SO-2" is NOT mistaken for a handle.
const PARSER_HANDLE = /^(cand|sent|para|trigger)-|^t\d/i;

/** True if a string is (or starts as) an internal parser/model id handle, not real content. */
export function isParserHandle(s: string | null | undefined): boolean {
  const t = (s ?? '').trim();
  return t.length > 0 && PARSER_HANDLE.test(t);
}

/**
 * Repair pdfplumber text artifacts so the same sentence read two ways still matches:
 *  - soft hyphen (U+00AD) at a line break: `com­\npliance` → `compliance`
 *  - bare soft hyphens → removed
 *  - Windows/again newlines and doubled spaces collapsed
 * Deliberately conservative: it does NOT change words, only join/whitespace noise.
 */
export function cleanSourceText(input: string): string {
  return (input ?? '')
    .replace(/­\r?\n/g, '')   // soft hyphen + newline → join
    .replace(/­/g, '')         // stray soft hyphen → drop
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** Normalize for a robust, punctuation-insensitive verbatim match (grounding). Lossy — match only. */
export function normalizeForMatch(input: string): string {
  return cleanSourceText(input)
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")   // curly/prime → straight apostrophe
    .replace(/[“”″]/g, '"')          // curly quotes → straight
    .replace(/[‐-―−]/g, '-')          // dashes/minus → hyphen
    .replace(/[^a-z0-9]+/g, ' ')                     // collapse all non-alphanumerics
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does `needle` (a requirement's quoted text) actually appear in `haystack` (the source
 * document text)? Normalized on both sides so pdfplumber artifacts and punctuation don't cause
 * false misses. Short/empty needles are treated as ungrounded. This is the anti-hallucination
 * gate: text that isn't in the document cannot pass.
 */
export function isGrounded(needle: string, normalizedHaystack: string): boolean {
  const n = normalizeForMatch(needle);
  if (n.length < 12) return false; // too short to verify meaningfully
  return normalizedHaystack.includes(n);
}

/** Build the normalized haystack once per document (expensive to recompute per row). */
export function buildHaystack(docText: string): string {
  return normalizeForMatch(docText);
}

export interface DerivedCitation {
  citation: string;       // e.g. "Section L.4.2", "M — Evaluation Factors", "p. 12"
  synthesized: boolean;   // true when we fell back to a non-authoritative marker
}

/**
 * Derive a human, verifiable citation for a candidate from the parser's OWN section structure.
 * Priority: section source-numbering (e.g. "L.4.2") → section heading → page marker. Never the
 * candidate/sentence id. `synthesized=true` marks the page-marker fallback so the UI can show it
 * as approximate.
 */
export function deriveCitation(
  candidate: ModalCandidate,
  sectionsById: Map<string, Section>,
  sentencePage?: number | null
): DerivedCitation {
  const section = candidate.section_id ? sectionsById.get(candidate.section_id) : undefined;

  if (section) {
    const numbering = (section.source_numbering ?? '').trim();
    if (numbering && !isParserHandle(numbering)) {
      return { citation: `Section ${numbering}`.slice(0, 200), synthesized: false };
    }
    const heading = cleanSourceText(section.heading_text ?? '').trim();
    if (heading && !isParserHandle(heading)) {
      return { citation: heading.slice(0, 200), synthesized: false };
    }
  }

  if (typeof sentencePage === 'number' && sentencePage > 0) {
    return { citation: `p. ${sentencePage}`, synthesized: true };
  }
  return { citation: 'Unlocated', synthesized: true };
}

/** Index a parse result's sections by id for O(1) citation derivation. */
export function indexSections(result: ParseResult): Map<string, Section> {
  const m = new Map<string, Section>();
  for (const s of result.sections ?? []) {
    if (s?.section_id) m.set(s.section_id, s);
  }
  return m;
}

/** Page number for a candidate's sentence, via its paragraph, if resolvable. */
export function candidatePage(candidate: ModalCandidate, result: ParseResult): number | null {
  const para = (result.paragraphs ?? []).find(p => p.paragraph_id === candidate.paragraph_id);
  return para?.page_number ?? null;
}
