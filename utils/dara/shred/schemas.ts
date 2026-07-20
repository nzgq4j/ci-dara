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

export interface CandidateClassification {
  candidateId: string;
  isRequirement: boolean;   // a real, actionable obligation (not narrative, definition, or boilerplate)
  source: ReqSource;
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
              description: 'true only if this is a real, actionable obligation the offeror must satisfy. ' +
                'false for narrative, definitions, table-of-contents, or FAR "incorporated by reference" list entries.'
            },
            source: {
              type: 'string',
              enum: ['instruction', 'evaluation_factor', 'sow_pws', 'far_clause', 'other'],
              description: 'instruction = Section L proposal instruction; evaluation_factor = Section M factor; ' +
                'sow_pws = SOW/PWS performance task; far_clause = a FAR/DFARS clause obligation; other = anything else.'
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
