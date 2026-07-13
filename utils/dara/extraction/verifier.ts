// Pass 1 verification — verbatimVerified by STRING COMPARISON ONLY (never the LLM).
//
// Tier 1: locate source_text in the sentence identified by sentence_id.
// Tier 2: fuzzy token-overlap scan of the paragraphs (>= 0.85) when the sentence lookup misses.
// Table-derived candidates are verbatim from the table by construction → verified.

import type { ParseResult } from '@/utils/dara/parse-result';
import type { AnnotatedCandidate, VerifiedCandidate } from './types';

const FUZZY_THRESHOLD = 0.85;

function normalize(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .replace(/[­​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

// Deterministic token-overlap ratio (intersection over the needle's token count).
function overlapRatio(needle: string, haystack: string): number {
  const nt = tokens(needle);
  if (nt.length === 0) return 0;
  const hs = new Set(tokens(haystack));
  let hit = 0;
  for (const t of nt) if (hs.has(t)) hit++;
  return hit / nt.length;
}

export function verifyAgainstParseResult(
  candidates: AnnotatedCandidate[],
  result: ParseResult
): VerifiedCandidate[] {
  const sentenceById = new Map<string, string>();
  for (const s of result.sentences ?? []) sentenceById.set(s.sentence_id, s.text);

  const paragraphs = (result.paragraphs ?? []).map((p) => p.text).filter(Boolean);

  return candidates.map((c) => {
    // Table rows are copied verbatim from the parsed table — trust by construction.
    if (c.isTableDerived) return { ...c, verbatimVerified: true };

    const needle = normalize(c.sourceText);
    if (!needle) return { ...c, verbatimVerified: false };

    // Tier 1: the sentence the candidate came from.
    const sent = sentenceById.get(c.sentenceId);
    if (sent) {
      const hay = normalize(sent);
      if (hay.includes(needle) || needle.includes(hay) || overlapRatio(c.sourceText, sent) >= FUZZY_THRESHOLD) {
        return { ...c, verbatimVerified: true };
      }
    }

    // Tier 2: fuzzy scan across paragraphs.
    for (const p of paragraphs) {
      const hay = normalize(p);
      if (hay.includes(needle) || overlapRatio(c.sourceText, p) >= FUZZY_THRESHOLD) {
        return { ...c, verbatimVerified: true };
      }
    }

    return { ...c, verbatimVerified: false };
  });
}
