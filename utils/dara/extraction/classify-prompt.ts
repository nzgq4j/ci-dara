// Pass 1.5 — LLM classification at temperature=0.
//
// The LLM receives pre-identified candidates and classifies ONLY — it can never add a candidate, so
// the row count cannot grow at this step. Determinism note: temperature=0 makes the call as
// reproducible as the provider allows; it is NOT a bit-for-bit guarantee across requests (no LLM
// provider guarantees that), which is why every non-LLM step in this pipeline is deterministic and the
// LLM is confined to classification of a fixed candidate set.

import { complete } from '@/utils/dara/providers';
import { logUsage } from '@/utils/dara/usage';
import type { RequirementCandidate, ClassifiedCandidate, Classification, LlmSource, DbDisposition, Confidence } from './types';
import { ucfSourceToDb } from './types';

export interface ClassifyContext {
  provider: string;
  model: string;
  apiKey: string;
  companyId: bigint;
}

const BATCH_SIZE = 40;
const CLASSIFY_MAX_TOKENS = 8000;

const LLM_SOURCES = new Set<LlmSource>([
  'SECTION_L_INSTRUCTION',
  'SECTION_M_EVALUATION_FACTOR',
  'SOW_PWS_REQUIREMENT',
  'FAR_DFARS_CLAUSE',
  'CDRL_DELIVERABLE',
  'ADMINISTRATIVE',
  'OTHER'
]);
const DISPOSITIONS = new Set<DbDisposition>(['scored', 'compliance', 'administrative']);

const SYSTEM = `You are classifying pre-identified compliance requirement candidates from a government solicitation. These candidates were identified by rule-based modal-verb detection using spaCy's dependency parser.

YOUR ONLY TASKS:
1. For each candidate, determine if it is a genuine compliance obligation (is_requirement: true) or background/definition/scoring methodology (is_requirement: false).
2. Assign the correct source classification.
3. Assign disposition.
4. Generate a 4-8 word title (noun phrase, no modal verbs).
5. Generate normalized_meaning (one active-voice sentence).
6. Identify parent-child relationships within this batch.
7. Assign confidence.

YOU CANNOT ADD CANDIDATES. Return exactly the candidates given, by id.

Return ONLY a JSON array. Each element:
{
  "id": "<candidate_id exactly as given>",
  "is_requirement": true | false,
  "source": "SECTION_L_INSTRUCTION" | "SECTION_M_EVALUATION_FACTOR" | "SOW_PWS_REQUIREMENT" | "FAR_DFARS_CLAUSE" | "CDRL_DELIVERABLE" | "ADMINISTRATIVE" | "OTHER",
  "disposition": "scored" | "compliance" | "administrative",
  "title": "<4-8 word noun phrase>",
  "normalized_meaning": "<one active-voice sentence>",
  "parent_candidate_id": "<id or null>",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`;

function pick<T>(v: any, allowed: Set<T>, fallback: T): T {
  return allowed.has(v as T) ? (v as T) : fallback;
}

/** Balanced-brace salvage: pull every top-level {...} object out of an array body, tolerant of fences
 *  and a truncated tail. Deterministic; no dependency on a valid JSON.parse of the whole payload. */
export function extractArrayObjects(text: string): any[] {
  let t = (text || '').trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* salvage below */
  }
  const from = t.indexOf('[');
  if (from < 0) return [];
  const objs: any[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = from; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          objs.push(JSON.parse(t.slice(start, i + 1)));
        } catch {
          /* skip malformed */
        }
        start = -1;
      }
    }
  }
  return objs;
}

function candidateLine(c: RequirementCandidate): Record<string, unknown> {
  return {
    id: c.candidateId,
    text: c.sourceText,
    modal_verb: c.modalVerb,
    subject: c.subject,
    ucf_section: c.ucfSectionType,
    section_path: c.sectionPath,
    is_table_row: c.isTableDerived,
    is_cdrl: c.isCdrl
  };
}

function defaultClassification(c: RequirementCandidate): Classification {
  // Structural fallback when the LLM omits a candidate: derive source from the UCF section, keep the
  // row (never silently drop), and mark it LOW so it routes to human review.
  const db = ucfSourceToDb(c.ucfSectionType);
  const source: LlmSource =
    db === 'instruction'
      ? 'SECTION_L_INSTRUCTION'
      : db === 'evaluation_factor'
        ? 'SECTION_M_EVALUATION_FACTOR'
        : db === 'far_clause'
          ? 'FAR_DFARS_CLAUSE'
          : db === 'sow_pws'
            ? 'SOW_PWS_REQUIREMENT'
            : 'OTHER';
  return {
    id: c.candidateId,
    isRequirement: true,
    source,
    disposition: db === 'evaluation_factor' ? 'scored' : 'compliance',
    title: c.sourceText.split(/\s+/).slice(0, 8).join(' '),
    normalizedMeaning: c.sourceText,
    parentCandidateId: null,
    confidence: 'LOW'
  };
}

function toClassification(raw: any, c: RequirementCandidate): Classification {
  const source = pick<LlmSource>(raw?.source, LLM_SOURCES, 'OTHER');
  let disposition = pick<DbDisposition>(raw?.disposition, DISPOSITIONS, 'compliance');
  // A non-Section-M row can never be `scored` (scored ⇔ evaluation_factor).
  if (disposition === 'scored' && source !== 'SECTION_M_EVALUATION_FACTOR') disposition = 'compliance';
  const title = String(raw?.title ?? '').trim() || c.sourceText.split(/\s+/).slice(0, 8).join(' ');
  return {
    id: c.candidateId,
    isRequirement: raw?.is_requirement !== false,
    source,
    disposition,
    title: title.slice(0, 300),
    normalizedMeaning: String(raw?.normalized_meaning ?? '').trim() || c.sourceText,
    parentCandidateId: raw?.parent_candidate_id ? String(raw.parent_candidate_id).trim() || null : null,
    confidence: pick<Confidence>(raw?.confidence, new Set<Confidence>(['HIGH', 'MEDIUM', 'LOW']), 'MEDIUM')
  };
}

/** Classify all candidates in deterministic-order batches. Returns every input candidate (a candidate
 *  the LLM omits gets a LOW structural default — the row count never shrinks or grows here). */
export async function classifyCandidates(
  candidates: RequirementCandidate[],
  ctx: ClassifyContext
): Promise<ClassifiedCandidate[]> {
  if (candidates.length === 0) return [];

  const byId = new Map<string, Classification>();

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const user =
      `SECTION CONTEXT: candidates below carry their own ucf_section + section_path.\n\n` +
      `CANDIDATES:\n${JSON.stringify(batch.map(candidateLine), null, 0)}`;
    try {
      const ai = await complete(ctx.provider, SYSTEM, user, ctx.model, ctx.apiKey, CLASSIFY_MAX_TOKENS, 0);
      await logUsage({
        capability: 'shred',
        provider: ctx.provider,
        model: ctx.model,
        companyId: ctx.companyId,
        tokenIn: ai.tokenIn,
        tokenOut: ai.tokenOut
      });
      const rows = extractArrayObjects(ai.text);
      const rowById = new Map<string, any>();
      for (const r of rows) if (r?.id) rowById.set(String(r.id).trim(), r);
      for (const c of batch) {
        const raw = rowById.get(c.candidateId);
        byId.set(c.candidateId, raw ? toClassification(raw, c) : defaultClassification(c));
      }
    } catch (e) {
      await logUsage({ capability: 'shred', provider: ctx.provider, model: ctx.model, companyId: ctx.companyId, ok: false });
      // A failed batch must not drop rows — fall back to the structural default for the whole batch.
      for (const c of batch) byId.set(c.candidateId, defaultClassification(c));
    }
  }

  return candidates.map((c) => ({ ...c, classification: byId.get(c.candidateId) ?? defaultClassification(c) }));
}
