// Pass 3 — incorporation-by-reference traversal (deterministic; no LLM).
//
// Reads `ibr_flags[]` from the ParseResult and resolves each citation against the local clause library
// at the solicitation's as-of date. A resolved clause becomes a requirement whose text IS the library
// plain text (authoritative → verbatim-verified, no LLM needed, fully reproducible). The clause text is
// then scanned for further FAR/DFARS citations and traversed depth-first to a max depth of 3, with a
// visited-set to bound reference loops. Unresolved citations become a FLAGGED placeholder — never
// silently omitted.
//
// DEVIATION from spec §6.5: the spec would run Pass-1 candidate-building + LLM classification on the
// clause text to decompose it into sub-obligations. The Modal parser does not run spaCy on library
// clause text (there are no modal_candidates for it), so we record one requirement per resolved clause
// (its verbatim library text) instead of LLM-decomposing it. This keeps Pass 3 fully deterministic;
// deeper clause decomposition would require spaCy over the clause text (future Modal work).

import type { ParseResult, IbrFlag } from '@/utils/dara/parse-result';
import type { ExtractedRequirement } from './types';
import { deriveReviewStatus } from './types';
import { resolveClauseVersion, normalizeCitation } from './clause-library';

const MAX_DEPTH = 3;

// Clause-number extractor (52.xxx-x = FAR, 252.xxx-x = DFARS) for nested-citation discovery.
const CLAUSE_NUM = /\b(\d{2,3}\.\d{3}-\d+)\b/g;

function classifyCitation(sentence: string): 'DIRECT' | 'FLOWDOWN' | 'INFORMATIONAL' {
  const s = (sentence || '').toLowerCase();
  if (/flow ?down|include in (all )?subcontracts|insert .*subcontract/.test(s)) return 'FLOWDOWN';
  if (/in accordance with|shall comply with|as required by|subject to the requirements of|pursuant to/.test(s)) return 'DIRECT';
  return 'INFORMATIONAL';
}

function citationTypeFromNumber(num: string): 'FAR' | 'DFARS' {
  return num.startsWith('252.') || num.startsWith('2') && num.split('.')[0].length === 3 ? 'DFARS' : 'FAR';
}

function farRef(citationText: string): string {
  const m = citationText.match(/(\d{2,3}\.\d{3}-\d+)/);
  return m ? m[1] : '';
}

export async function traverseIbr(
  result: ParseResult,
  asOf: Date
): Promise<ExtractedRequirement[]> {
  const sentenceById = new Map<string, string>();
  for (const s of result.sentences ?? []) sentenceById.set(s.sentence_id, s.text);

  const out: ExtractedRequirement[] = [];
  const visited = new Set<string>(); // normalized identifiers already emitted

  const emitResolved = (
    citationType: string,
    citationText: string,
    plainText: string,
    versionDate: string,
    chain: string[],
    depth: number,
    ibrFlagIds: string[],
    kind: string
  ): ExtractedRequirement => ({
    candidateId: `ibr-${normalizeCitation(citationType, citationText).identifier}`.replace(/\s+/g, '_'),
    title: `Incorporated clause ${citationText}`.slice(0, 300),
    description: plainText,
    normalizedMeaning: `Comply with the requirements of ${citationText} (${kind}).`,
    source: 'far_clause',
    disposition: 'compliance',
    citation: citationText,
    farReference: farRef(citationText),
    sourceAnchor: null,
    sectionId: null,
    pageNumber: null,
    parentCandidateId: null,
    confidence: 'HIGH',
    verbatimVerified: true,
    reviewStatus: deriveReviewStatus('HIGH', true, []),
    flags: [`ibr:${kind}`, `ibr_version:${versionDate}`],
    conditionalTriggerIds: [],
    conditions: [],
    ibrFlags: ibrFlagIds,
    citationChain: chain,
    traversalDepth: depth,
    versionResolved: true,
    passOrigin: 3
  });

  const emitUnavailable = (
    citationType: string,
    citationText: string,
    chain: string[],
    depth: number,
    ibrFlagIds: string[]
  ): ExtractedRequirement => ({
    candidateId: `ibr-${normalizeCitation(citationType, citationText).identifier}`.replace(/\s+/g, '_'),
    title: `Unavailable clause ${citationText}`.slice(0, 300),
    description: `Obligations under ${citationText} require traversal — not yet in the clause library.`,
    normalizedMeaning: `Obligations under ${citationText} could not be resolved from the clause library.`,
    source: 'far_clause',
    disposition: 'compliance',
    citation: citationText,
    farReference: farRef(citationText),
    sourceAnchor: null,
    sectionId: null,
    pageNumber: null,
    parentCandidateId: null,
    confidence: 'LOW',
    verbatimVerified: false,
    reviewStatus: 'flagged',
    flags: ['ibr:UNAVAILABLE'],
    conditionalTriggerIds: [],
    conditions: [],
    ibrFlags: ibrFlagIds,
    citationChain: chain,
    traversalDepth: depth,
    versionResolved: false,
    passOrigin: 3
  });

  // Depth-first traversal of one citation.
  const walk = async (
    citationType: string,
    citationText: string,
    chain: string[],
    depth: number,
    ibrFlagIds: string[],
    sentence: string
  ): Promise<void> => {
    const key = normalizeCitation(citationType, citationText).identifier;
    if (visited.has(key)) return;
    visited.add(key);

    const kind = classifyCitation(sentence);
    const resolved = await resolveClauseVersion(citationType, citationText, asOf);
    if (!resolved) {
      out.push(emitUnavailable(citationType, citationText, [...chain, citationText], depth, ibrFlagIds));
      return;
    }
    out.push(emitResolved(citationType, citationText, resolved.plainText, resolved.effectiveDate, [...chain, citationText], depth, ibrFlagIds, kind));

    if (depth >= MAX_DEPTH) return;
    // Discover nested citations in the resolved clause text and recurse.
    const nested = new Set<string>();
    let m: RegExpExecArray | null;
    CLAUSE_NUM.lastIndex = 0;
    while ((m = CLAUSE_NUM.exec(resolved.plainText)) !== null) nested.add(m[1]);
    for (const num of Array.from(nested)) {
      const nType = citationTypeFromNumber(num);
      const nText = `${nType} ${num}`;
      if (visited.has(normalizeCitation(nType, nText).identifier)) continue;
      await walk(nType, nText, [...chain, citationText], depth + 1, [], '');
    }
  };

  // Deterministic order: by flag_id.
  const flags = [...(result.ibr_flags ?? [])].sort((a, b) => (a.flag_id < b.flag_id ? -1 : a.flag_id > b.flag_id ? 1 : 0));
  // Group flags by normalized citation so one clause is traversed once but carries all its flag ids.
  const byCitation = new Map<string, { type: string; text: string; flagIds: string[]; sentence: string }>();
  for (const f of flags as IbrFlag[]) {
    if (f.traversal_status !== 'PENDING') continue;
    const norm = normalizeCitation(f.citation_type, f.citation_text).identifier;
    const sentence = f.sentence_id ? sentenceById.get(f.sentence_id) ?? '' : '';
    const entry = byCitation.get(norm) ?? { type: f.citation_type, text: f.citation_text, flagIds: [], sentence };
    entry.flagIds.push(f.flag_id);
    if (!entry.sentence && sentence) entry.sentence = sentence;
    byCitation.set(norm, entry);
  }

  for (const entry of Array.from(byCitation.values())) {
    await walk(entry.type, entry.text, [], 1, entry.flagIds, entry.sentence);
  }

  return out;
}
