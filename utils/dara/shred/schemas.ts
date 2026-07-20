// JSON Schemas for the two structured (tool-use) calls, plus their TypeScript output types.
// Because these are enforced as Anthropic tool input_schemas, the model's output is guaranteed
// to match: correct fields, valid enum values, no wrappers, no prose. Invalid classifications are
// impossible by construction — the whole point of the rebuild.

// ── Step A — Section M factors ──────────────────────────────────────────────────

export interface ExtractedFactor {
  name: string;        // e.g. "Technical Approach"
  description: string; // what this factor evaluates (1–2 sentences)
  citation: string;    // where it is defined, e.g. "Section M.2.1" or the heading
}

export interface FactorsOutput {
  factors: ExtractedFactor[];
}

export const FACTORS_TOOL = {
  name: 'record_evaluation_factors',
  description:
    'Record the Section M evaluation factors and subfactors under which proposals will be scored. ' +
    'Extract ONLY factors explicitly stated in the provided Section M text. If the text contains no ' +
    'evaluation factors, return an empty array — never invent factors.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      factors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Short factor/subfactor name as stated in the solicitation.' },
            description: { type: 'string', description: 'What this factor evaluates, in 1–2 sentences, grounded in the text.' },
            citation: { type: 'string', description: 'Where it is defined, e.g. "Section M.2.1" or the exact heading text.' }
          },
          required: ['name', 'description', 'citation']
        }
      }
    },
    required: ['factors']
  }
} as const;

// ── Step B — classify + link requirement candidates ────────────────────────────

export type ReqSource = 'instruction' | 'evaluation_factor' | 'sow_pws' | 'far_clause' | 'other';
export type ReqDisposition = 'scored' | 'compliance' | 'administrative';
export type ReqConfidence = 'high' | 'medium' | 'low';

// The classifier may NOT emit 'evaluation_factor' — the Section M factors are produced solely by
// Step A. A candidate is an offeror obligation that LINKS to those factors, never a factor itself.
export type ClassifySource = Exclude<ReqSource, 'evaluation_factor'>;

export interface CandidateClassification {
  candidateId: string;
  isRequirement: boolean;   // a real, actionable obligation the OFFEROR must satisfy (not narrative,
                            // definition, boilerplate, or a description of what the GOVERNMENT does)
  source: ClassifySource;
  disposition: ReqDisposition;
  name: string;             // short label summarizing the obligation
  governingFactors: string[]; // Section M factor names this obligation is evaluated under (from Step A)
  confidence: ReqConfidence;
}

export interface ClassifyOutput {
  classifications: CandidateClassification[];
}

export const CLASSIFY_TOOL = {
  name: 'record_requirement_classifications',
  description:
    'Classify each provided requirement CANDIDATE. You may NOT add, remove, merge, or reword ' +
    'candidates — classify exactly the candidateIds given, one classification each. For each: decide ' +
    'if it is a real actionable requirement, assign its source and disposition, write a short name, and ' +
    'link it to the Section M factor(s) it is evaluated under (choose only from the provided factor names).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidateId: { type: 'string', description: 'The exact candidateId being classified.' },
            isRequirement: {
              type: 'boolean',
              description: 'true ONLY if this is a real, actionable obligation the OFFEROR must satisfy or address. ' +
                'false for: narrative/background, definitions, table-of-contents, FAR "incorporated by reference" ' +
                'list entries, AND any statement describing what the GOVERNMENT does (how it evaluates, assesses, ' +
                'reviews, rates, or determines) — those are evaluation methodology, not offeror obligations.'
            },
            source: {
              type: 'string',
              enum: ['instruction', 'sow_pws', 'far_clause', 'other'],
              description: 'instruction = Section L proposal-submission instruction; sow_pws = SOW/PWS performance ' +
                'task; far_clause = a FAR/DFARS clause obligation; other = anything else. Do NOT classify anything ' +
                'as an evaluation factor — the Section M factors are already provided; link to them via governingFactors.'
            },
            disposition: {
              type: 'string',
              enum: ['scored', 'compliance', 'administrative'],
              description: 'scored = affects the evaluation rating; compliance = must be met/answered but not scored; ' +
                'administrative = forms, formatting, submission mechanics, or boilerplate.'
            },
            name: { type: 'string', description: 'Concise label (≤ 120 chars) summarizing the obligation.' },
            governingFactors: {
              type: 'array',
              items: { type: 'string' },
              description: 'Names of the Section M factor(s) this obligation is evaluated under. Use ONLY names from ' +
                'the provided factor list. Empty if it maps to no scored factor.'
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
          },
          required: ['candidateId', 'isRequirement', 'source', 'disposition', 'name', 'governingFactors', 'confidence']
        }
      }
    },
    required: ['classifications']
  }
} as const;
