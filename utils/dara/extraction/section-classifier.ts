// Pass 0 — UCF section classification.
//
// Builds Map<section_id, UCFSectionType> from ParseResult.sections, with children inheriting their
// parent's type via parent_section_id.
//
// DEVIATION from the spec's "no keyword matching against heading text": the spec assumes a pdfplumber
// font-size heading classifier that does NOT exist in modal/app.py — for PDFs `sections[]` is empty
// (only the DOCX path populates it). Pure structural position therefore cannot distinguish Section L
// from Section M. This is a HINT layer only: the authoritative per-candidate source is assigned by the
// temperature=0 LLM classify pass (classify-prompt.ts). So we use a small, deterministic heading-text
// heuristic here as a useful prior, and let the LLM correct it. When `sections[]` is empty (typical
// PDF), the map is empty and every candidate starts UCF=OTHER until the LLM classifies it.
//
// FALLBACK: when sections[] is empty, buildPageClassMap() scans raw paragraph/sentence text for
// header-like phrases to produce a page-level UCF map. This is a coarser approximation but prevents
// all candidates from landing as UCF=OTHER when the Modal parser found no section structure.

import type { Section, ParseResult } from '@/utils/dara/parse-result';
import type { UCFSectionType } from './types';

const HEADING_RULES: { re: RegExp; type: UCFSectionType }[] = [
  { re: /\bsection\s+l\b|instructions?\s+to\s+offerors?|proposal\s+preparation|instructions,?\s+conditions/i, type: 'SECTION_L' },
  { re: /\bsection\s+m\b|evaluation\s+factors?|basis\s+for\s+award|evaluation\s+criteria/i, type: 'SECTION_M' },
  { re: /statement\s+of\s+work|performance\s+work\s+statement|statement\s+of\s+objectives|\bS\.?O\.?W\b|\bP\.?W\.?S\b|\bS\.?O\.?O\b/i, type: 'SOW_PWS' },
  { re: /\bCDRL\b|contract\s+data\s+requirements|data\s+item\s+description|\bDID\b/i, type: 'CDRL' },
  { re: /\bsection\s+[i]\b|\bFAR\b|\bDFARS\b|contract\s+clauses|provisions|representations?\s+and\s+certifications?/i, type: 'FAR_CLAUSE' },
  { re: /background|introduction|\bscope\b|definitions|acronyms|table\s+of\s+contents/i, type: 'BACKGROUND' }
];

// Patterns that, when found at the START of a paragraph/heading, signal a section boundary.
// More permissive than HEADING_RULES — used for the page-level fallback scan.
const PAGE_SECTION_SIGNALS: { re: RegExp; type: UCFSectionType }[] = [
  { re: /^\s*(?:section\s+l|iv[.\s]*instructions|instructions\s+to\s+offerors?|proposal\s+prep|how\s+to\s+prepare)/i, type: 'SECTION_L' },
  { re: /^\s*(?:section\s+m|v[.\s]*evaluation|evaluation\s+factors?|evaluation\s+criteria|basis\s+for\s+award)/i, type: 'SECTION_M' },
  { re: /^\s*(?:statement\s+of\s+work|performance\s+work|sow|pws|soo)/i, type: 'SOW_PWS' },
  { re: /^\s*(?:section\s+[ij]|clauses|provisions|far\s+clauses|contract\s+clauses)/i, type: 'FAR_CLAUSE' },
  { re: /^\s*(?:background|introduction|scope|purpose|general)/i, type: 'BACKGROUND' }
];

function classifyHeading(text: string): UCFSectionType | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const rule of HEADING_RULES) if (rule.re.test(t)) return rule.type;
  return null;
}

function classifyPageSignal(text: string): UCFSectionType | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const rule of PAGE_SECTION_SIGNALS) if (rule.re.test(t)) return rule.type;
  return null;
}

/**
 * Deterministic UCF-type map keyed by section_id. Top-level sections classify by heading heuristic;
 * children inherit their parent's type unless their own heading matches a more specific rule.
 */
export function buildSectionClassMap(sections: Section[] | undefined | null): Map<string, UCFSectionType> {
  const map = new Map<string, UCFSectionType>();
  if (!Array.isArray(sections) || sections.length === 0) return map;

  const byId = new Map<string, Section>();
  for (const s of sections) if (s?.section_id) byId.set(s.section_id, s);

  const resolve = (s: Section, guard: Set<string>): UCFSectionType => {
    if (map.has(s.section_id)) return map.get(s.section_id)!;
    // Own heading wins when it matches a rule.
    const own = classifyHeading(s.heading_text);
    if (own) {
      map.set(s.section_id, own);
      return own;
    }
    // Otherwise inherit the parent's type (cycle-guarded).
    const parentId = s.parent_section_id;
    if (parentId && byId.has(parentId) && !guard.has(parentId)) {
      guard.add(s.section_id);
      const inherited = resolve(byId.get(parentId)!, guard);
      map.set(s.section_id, inherited);
      return inherited;
    }
    map.set(s.section_id, 'OTHER');
    return 'OTHER';
  };

  for (const s of sections) if (s?.section_id) resolve(s, new Set([s.section_id]));
  return map;
}

/**
 * Fallback for PDFs with no section structure (sections[] is empty).
 * Scans paragraphs for header-like text to build a page → UCFSectionType map.
 * Returns Map<pageNumber, UCFSectionType>. Candidates on that page inherit the type
 * of the last header signal found on or before their page.
 */
export function buildPageClassMap(result: ParseResult): Map<number, UCFSectionType> {
  const pageMap = new Map<number, UCFSectionType>();
  if ((result.sections ?? []).length > 0) return pageMap; // only used when sections is empty

  // Walk paragraphs in order; carry the current UCF type forward page by page.
  const paragraphs = result.paragraphs ?? [];
  let currentType: UCFSectionType = 'OTHER';
  let lastPage = -1;

  for (const para of paragraphs) {
    const page = para.page_number ?? 1;
    const text = (para.text || '').trim();
    if (!text) continue;

    const signal = classifyPageSignal(text);
    if (signal) currentType = signal;

    // Record the type for this page whenever we first see it or the type changes.
    if (page !== lastPage) {
      pageMap.set(page, currentType);
      lastPage = page;
    } else if (signal) {
      // Type changed mid-page — update the current page entry.
      pageMap.set(page, currentType);
    }
  }

  return pageMap;
}

/** Breadcrumb of enclosing headings for a section_id (e.g. "L Instructions > L.4 Volume II"). */
export function sectionPathOf(sections: Section[] | undefined | null, sectionId: string | null): string {
  if (!sectionId || !Array.isArray(sections)) return '';
  const byId = new Map<string, Section>();
  for (const s of sections) if (s?.section_id) byId.set(s.section_id, s);
  const parts: string[] = [];
  const guard = new Set<string>();
  let cur = byId.get(sectionId) ?? null;
  while (cur && !guard.has(cur.section_id)) {
    guard.add(cur.section_id);
    const label = [cur.source_numbering, cur.heading_text].filter(Boolean).join(' ').trim();
    if (label) parts.unshift(label);
    cur = cur.parent_section_id ? byId.get(cur.parent_section_id) ?? null : null;
  }
  return parts.join(' > ');
}
import type { UCFSectionType } from './types';

const HEADING_RULES: { re: RegExp; type: UCFSectionType }[] = [
  { re: /\bsection\s+l\b|instructions?\s+to\s+offerors?|proposal\s+preparation|instructions,?\s+conditions/i, type: 'SECTION_L' },
  { re: /\bsection\s+m\b|evaluation\s+factors?|basis\s+for\s+award|evaluation\s+criteria/i, type: 'SECTION_M' },
  { re: /statement\s+of\s+work|performance\s+work\s+statement|statement\s+of\s+objectives|\bS\.?O\.?W\b|\bP\.?W\.?S\b|\bS\.?O\.?O\b/i, type: 'SOW_PWS' },
  { re: /\bCDRL\b|contract\s+data\s+requirements|data\s+item\s+description|\bDID\b/i, type: 'CDRL' },
  { re: /\bsection\s+[i]\b|\bFAR\b|\bDFARS\b|contract\s+clauses|provisions|representations?\s+and\s+certifications?/i, type: 'FAR_CLAUSE' },
  { re: /background|introduction|\bscope\b|definitions|acronyms|table\s+of\s+contents/i, type: 'BACKGROUND' }
];

function classifyHeading(text: string): UCFSectionType | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const rule of HEADING_RULES) if (rule.re.test(t)) return rule.type;
  return null;
}

/**
 * Deterministic UCF-type map keyed by section_id. Top-level sections classify by heading heuristic;
 * children inherit their parent's type unless their own heading matches a more specific rule.
 */
export function buildSectionClassMap(sections: Section[] | undefined | null): Map<string, UCFSectionType> {
  const map = new Map<string, UCFSectionType>();
  if (!Array.isArray(sections) || sections.length === 0) return map;

  const byId = new Map<string, Section>();
  for (const s of sections) if (s?.section_id) byId.set(s.section_id, s);

  const resolve = (s: Section, guard: Set<string>): UCFSectionType => {
    if (map.has(s.section_id)) return map.get(s.section_id)!;
    // Own heading wins when it matches a rule.
    const own = classifyHeading(s.heading_text);
    if (own) {
      map.set(s.section_id, own);
      return own;
    }
    // Otherwise inherit the parent's type (cycle-guarded).
    const parentId = s.parent_section_id;
    if (parentId && byId.has(parentId) && !guard.has(parentId)) {
      guard.add(s.section_id);
      const inherited = resolve(byId.get(parentId)!, guard);
      map.set(s.section_id, inherited);
      return inherited;
    }
    map.set(s.section_id, 'OTHER');
    return 'OTHER';
  };

  for (const s of sections) if (s?.section_id) resolve(s, new Set([s.section_id]));
  return map;
}

/** Breadcrumb of enclosing headings for a section_id (e.g. "L Instructions > L.4 Volume II"). */
export function sectionPathOf(sections: Section[] | undefined | null, sectionId: string | null): string {
  if (!sectionId || !Array.isArray(sections)) return '';
  const byId = new Map<string, Section>();
  for (const s of sections) if (s?.section_id) byId.set(s.section_id, s);
  const parts: string[] = [];
  const guard = new Set<string>();
  let cur = byId.get(sectionId) ?? null;
  while (cur && !guard.has(cur.section_id)) {
    guard.add(cur.section_id);
    const label = [cur.source_numbering, cur.heading_text].filter(Boolean).join(' ').trim();
    if (label) parts.unshift(label);
    cur = cur.parent_section_id ? byId.get(cur.parent_section_id) ?? null : null;
  }
  return parts.join(' > ');
}
