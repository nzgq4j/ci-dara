// Per-window extraction prompt for span-anchored requirement extraction (Prompt 3 of the
// redesign). Unlike buildShredPrompt (whole doc -> paraphrased descriptions), this asks the
// model, for one WINDOW of solicitation text, to return each obligation's VERBATIM quote plus
// its classification and obligation count. The pipeline (requirements.ts) then anchors each
// quote to a raw character range via verifySpan — a paraphrase can't be anchored, so the prompt
// insists on exact copying. Mirrors prompt.ts fencing + tolerant-salvage patterns.

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

const EXTRACT_SCHEMA =
  '{"requirements": [{' +
  '"quote": "<EXACT verbatim substring, copied character-for-character from the passage above — ' +
  'the offeror-obligation text itself. Do NOT paraphrase, summarize, fix typos, expand ' +
  'abbreviations, or stitch together separated sentences. If you cannot copy it exactly, omit it.>", ' +
  '"name": "<short handle, <= 12 words, e.g. \\"Page limit — Volume II\\">", ' +
  '"source": "<one of: instruction | evaluation_factor | sow_pws | far_clause | other>", ' +
  '"disposition": "<one of: scored | compliance | administrative>", ' +
  '"obligation_count": <integer >= 1 — how many distinct obligations this quote imposes on the offeror>, ' +
  '"truncated": <true if this obligation is cut off by the top or bottom edge of the passage — it begins ' +
  'before the passage starts or continues past where it ends; else false>, ' +
  '"weight": <integer 0-100 relative importance for a scored evaluation factor if discernible, else 0>' +
  '}]}';

/**
 * Build the extraction prompt for ONE window of solicitation text. The window is fenced as
 * untrusted data; the model returns verbatim quotes so the pipeline can anchor each to a span.
 */
export function buildExtractPrompt(windowText: string): { system: string; user: string } {
  const token = fenceToken();
  const doc = fenceUntrusted('PASSAGE', windowText, token);

  const system =
    'You are a senior government-contracting proposal manager building a compliance matrix. You ' +
    'read a PASSAGE from a solicitation and capture every discrete obligation the OFFEROR must ' +
    'meet, quoting each VERBATIM and flagging any obligation the passage cuts off at its edge. ' +
    'Each quote is later verified character-for-character against the source — a paraphrase, or a ' +
    'quote stitched together from separated text, will be REJECTED and the requirement lost, so ' +
    'copy exactly. You are disciplined about what is NOT a requirement. Respond only in the JSON ' +
    'format specified.';

  const user =
    `## Passage (a slice of the solicitation)\n\n${doc}\n\n## Instructions\n\n${INJECTION_GUARD}\n\n` +
    'Extract the discrete requirements the offeror must satisfy that appear IN FULL in this ' +
    'passage, and classify each. A requirement is something the offeror must DO, PROVIDE, COMPLY ' +
    'WITH, or be EVALUATED ON.\n\n' +
    '### Quote VERBATIM (critical)\n' +
    '- "quote" MUST be an EXACT substring of the passage, copied character-for-character — same ' +
    'words, punctuation, casing, spacing. Do NOT paraphrase, summarize, fix typos/OCR errors, ' +
    'expand abbreviations, or join text separated by other content. (Minor line-break and ' +
    'hyphenation artifacts in the source are tolerated by the verifier, but the WORDS must match.)\n' +
    '- This passage is a SLICE of a larger document; an obligation may be cut off at the top or ' +
    'bottom edge — it begins before this passage starts, or continues past where it ends. Do NOT ' +
    'skip it. Quote what you CAN see (verbatim, as always) and set "truncated": true. A ' +
    'deterministic step later reassembles the fragments across passages by character position — ' +
    'your job is only to report what is visible and flag that it is cut off. For an obligation ' +
    'fully contained in this passage, set "truncated": false.\n\n' +
    '### DO NOT extract (omit entirely)\n' +
    '- The evaluation/scoring METHODOLOGY: rating-scale definitions (Outstanding/Good/…), how ' +
    'factors are weighted or combined, order of importance, best-value tradeoff / basis-of-award, ' +
    'or any description of how the Government/SSA/SSEB conducts the evaluation. (The evaluation ' +
    'FACTORS themselves ARE requirements; the scale/process used to score them are not.)\n' +
    '- Background, purpose, scope narrative, definitions, acronym lists, boilerplate imposing no ' +
    'obligation on the offeror.\n' +
    '- Government responsibilities or statements about what the Government will do/furnish.\n\n' +
    '### Classify each requirement\n' +
    '"source": instruction (Section L prep/format) | evaluation_factor (Section M scored) | ' +
    'sow_pws (SOW/PWS/SOO "shall" tasks) | far_clause (FAR/DFARS clause/provision/rep-cert) | other.\n' +
    '"disposition": scored (a Section M evaluation factor/subfactor the Government SCORES — almost ' +
    'always source = evaluation_factor) | compliance (a pass/fail requirement the offeror must ' +
    'DEMONSTRATE in the proposal, checkable against the narrative) | administrative (complied with ' +
    'but NOT written up in the proposal — SAM/CAGE/UEI, reps & certs and clauses incorporated by ' +
    'reference, submission logistics such as due date/time, address/portal, number of copies, file ' +
    'naming). When unsure between compliance and administrative: if the proposal text would carry ' +
    'gradable evidence, choose compliance; if it is a checkbox/registration/logistics fact, ' +
    'administrative.\n' +
    '"obligation_count": how many DISTINCT obligations the quote imposes (a single "shall" = 1; a ' +
    'clause that both incorporates a reference AND adds substantive requirements is > 1). This ' +
    'later decides whether the requirement is treated as compound.\n\n' +
    `Respond ONLY with a valid JSON object matching this schema exactly:\n\n${EXTRACT_SCHEMA}\n\n` +
    'Do not include any text outside the JSON object. If the passage contains no offeror ' +
    'obligations, return {"requirements": []}.';

  return { system, user };
}

export interface ExtractedRequirement {
  quote: string; // verbatim — the pipeline anchors this via verifySpan to get RAW offsets
  name: string;
  source: RequirementSourceValue;
  disposition: RequirementDispositionValue;
  isScored: boolean;
  obligationCount: number; // >= 1
  // True when the obligation is cut off by the passage edge. The pipeline's stitchFragments()
  // reassembles adjacent truncated fragments by raw offset — the model only reports what it sees.
  truncated: boolean;
  weight: number;
}

function mapExtractItem(r: any): ExtractedRequirement {
  const quote = String(r?.quote ?? '').trim();

  const rawSource = String(r?.source ?? 'other').trim();
  const source = (REQUIREMENT_SOURCES as readonly string[]).includes(rawSource)
    ? (rawSource as RequirementSourceValue)
    : 'other';

  // Honor the model's disposition; infer from source when missing/invalid (mirrors mapShredItem).
  const rawDisp = String(r?.disposition ?? '').trim().toLowerCase();
  let disposition: RequirementDispositionValue =
    (REQUIREMENT_DISPOSITIONS as readonly string[]).includes(rawDisp)
      ? (rawDisp as RequirementDispositionValue)
      : source === 'evaluation_factor' ? 'scored' : 'compliance';
  // 'scored' is meaningful only for an evaluation factor.
  if (disposition === 'scored' && source !== 'evaluation_factor') disposition = 'compliance';

  const name = String(r?.name ?? '').trim().slice(0, 300) || quote.slice(0, 120) || 'Requirement';
  const obligationCount = Math.max(1, Math.round(Number(r?.obligation_count ?? 1) || 1));
  const weight = Math.max(0, Math.min(100, Math.round(Number(r?.weight ?? 0) || 0)));
  const truncated = r?.truncated === true;

  return { quote, name, source, disposition, isScored: disposition === 'scored', obligationCount, truncated, weight };
}

/**
 * Parse one window's extraction response; [] if unparseable. Tolerant salvage of a truncated
 * array (reuses prompt.ts extractArrayObjects). Items with no verbatim quote are dropped — they
 * can't be anchored to a span.
 */
export function parseExtract(text: string): ExtractedRequirement[] {
  const cleaned = stripFences(text);
  let list: any[] = [];
  try {
    const m = cleaned.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m ? m[0] : cleaned);
    if (Array.isArray(data?.requirements)) list = data.requirements;
  } catch {
    /* fall through to salvage */
  }
  if (list.length === 0) list = extractArrayObjects(cleaned, 'requirements');
  return list.map(mapExtractItem).filter((r) => r.quote.length > 0);
}
