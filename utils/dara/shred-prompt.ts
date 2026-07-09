// Whole-document requirements shred. The model reads the ENTIRE concatenated solicitation in one
// call and returns a clean, de-duplicated requirements list — one row per requirement UNIT the
// document treats as a single addressable item. This replaces the windowed span-anchored pipeline:
// modern context windows hold a whole solicitation, so letting the model see everything at once
// gives better granularity, correct section citations, and cross-document de-duplication for free.

import {
  fenceUntrusted,
  fenceToken,
  INJECTION_GUARD,
  stripFences,
  extractArrayObjects,
  REQUIREMENT_SOURCES,
  REQUIREMENT_DISPOSITIONS,
  type RequirementSourceValue,
  type RequirementDispositionValue
} from '@/utils/dara/prompt';

export interface ShredRow {
  name: string;
  text: string;
  citation: string;
  farReference: string;
  source: RequirementSourceValue;
  disposition: RequirementDispositionValue;
  obligationCount: number;
  weight: number;
}

const SHRED_SCHEMA =
  '{' +
  '"name": "<short handle, <= 12 words>", ' +
  '"text": "<the obligation, quoted or tightly paraphrased, faithful to the source>", ' +
  '"citation": "<the section/paragraph/clause id EXACTLY as the document labels it — e.g. \\"PWS 2.5\\", ' +
  '\\"Section L.4.2\\", \\"FAR 52.212-5\\", \\"DFARS 252.204-7012\\". Empty string only if truly unlabeled.>", ' +
  '"source": "<instruction | evaluation_factor | sow_pws | far_clause | other>", ' +
  '"disposition": "<scored | compliance | administrative>", ' +
  '"obligation_count": <integer >= 1>' +
  '}';

/**
 * Build the whole-solicitation shred prompt. `solText` is every RFP document concatenated (with a
 * `=== DOCUMENT: <name> ===` header per file), structure preserved.
 */
export function buildShredPrompt(solText: string): { system: string; user: string } {
  const token = fenceToken();
  const doc = fenceUntrusted('SOLICITATION', solText, token);

  const system =
    'You are a senior U.S. Government proposal manager building a compliance matrix from a federal ' +
    'solicitation. You read the ENTIRE solicitation and extract every discrete requirement the offeror ' +
    'must satisfy as a clean, de-duplicated list — one row per requirement UNIT the document treats as a ' +
    'single addressable item. You are precise about what is and is not a requirement. Output ONLY valid JSON.';

  const user =
    `## Solicitation\n\n${doc}\n\n## Instructions\n\n${INJECTION_GUARD}\n\n` +
    'Extract every discrete requirement the offeror must DO, PROVIDE, COMPLY WITH, or be EVALUATED ON.\n\n' +
    '### Granularity (critical)\n' +
    '- ONE row per requirement UNIT — the smallest block the document treats as a single addressable item ' +
    '(a numbered paragraph like "2.5", a lettered sub-item, a Section L instruction, a FAR/DFARS clause).\n' +
    '- Do NOT split a numbered paragraph into individual sentences. A multi-sentence section is ONE row.\n' +
    '- Do NOT merge two separately numbered/lettered items into one row.\n' +
    '- If a parent section only introduces enumerated sub-items that have their own identifiers, output ' +
    'the sub-items and omit the parent.\n\n' +
    '### De-duplicate across the WHOLE solicitation\n' +
    '- If the same obligation appears in more than one place or document (e.g. a response template that ' +
    'echoes PWS section numbers, or a clause repeated in two enclosures), output it ONCE, citing the ' +
    'authoritative source. Never output two rows for the same underlying obligation.\n\n' +
    '### Exclude (do not extract)\n' +
    '- The evaluation/scoring METHODOLOGY: rating-scale definitions, weighting, order of importance, ' +
    'best-value / basis-of-award process, or how the Government/SSEB scores. (The evaluation FACTORS ARE ' +
    'requirements; the scoring machinery is not.)\n' +
    '- Background, scope narrative, definitions, acronym lists, boilerplate, and Government responsibilities.\n\n' +
    '### For each requirement, output an object:\n' +
    `${SHRED_SCHEMA}\n\n` +
    'source: instruction = Section L prep/format; evaluation_factor = Section M scored factor; sow_pws = ' +
    'SOW/PWS/SOO task; far_clause = FAR/DFARS clause/provision/rep-cert; other.\n' +
    'disposition: scored = a Section M factor the Government scores; compliance = a pass/fail requirement ' +
    'the proposal must demonstrate; administrative = complied with but not written up (SAM/CAGE, reps & ' +
    'certs, submission logistics).\n\n' +
    'Return ONLY a JSON array of these objects. No prose, no markdown fences.';

  return { system, user };
}

// Pull a FAR/DFARS clause number out of a citation string, if present.
const CLAUSE_NUM = /\b(\d{2,3}\.\d{3}(?:-\d{1,4})?)\b/;

function mapRow(r: any): ShredRow | null {
  const name = String(r?.name ?? '').trim();
  const text = String(r?.text ?? '').trim();
  if (!name && !text) return null;

  const rawSource = String(r?.source ?? 'other').trim();
  const source = (REQUIREMENT_SOURCES as readonly string[]).includes(rawSource)
    ? (rawSource as RequirementSourceValue)
    : 'other';

  const rawDisp = String(r?.disposition ?? '').trim().toLowerCase();
  let disposition: RequirementDispositionValue =
    (REQUIREMENT_DISPOSITIONS as readonly string[]).includes(rawDisp)
      ? (rawDisp as RequirementDispositionValue)
      : source === 'evaluation_factor' ? 'scored' : 'compliance';
  if (disposition === 'scored' && source !== 'evaluation_factor') disposition = 'compliance';

  const citation = String(r?.citation ?? '').trim().slice(0, 200);
  const far = citation.match(CLAUSE_NUM);
  const weight = Math.max(0, Math.min(100, Math.round(Number(r?.weight ?? 0) || 0)));

  return {
    name: (name || text.slice(0, 80)).slice(0, 300),
    text,
    citation,
    farReference: far ? far[1] : '',
    source,
    disposition,
    obligationCount: Math.max(1, Math.round(Number(r?.obligation_count ?? 1) || 1)),
    weight
  };
}

/** Parse the shred response into rows; [] if unparseable. Accepts a bare JSON array or an object
 *  wrapping one; tolerant salvage of a truncated array reuses prompt.ts extractArrayObjects. */
export function parseShredRows(text: string): ShredRow[] {
  const cleaned = stripFences(text);
  let list: any[] = [];
  try {
    const data = JSON.parse(cleaned);
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data?.requirements)) list = data.requirements;
  } catch {
    /* fall through to salvage */
  }
  if (list.length === 0) list = extractArrayObjects(cleaned, 'requirements');
  return list.map(mapRow).filter((r): r is ShredRow => r !== null);
}
