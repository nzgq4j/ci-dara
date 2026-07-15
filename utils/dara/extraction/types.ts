// Shared types for the deterministic 3-pass extraction pipeline.
//
// Doctrine: spaCy (in the Modal parser) DISCOVERS candidate obligations; this pipeline SELECTS,
// CLASSIFIES (one temperature=0 LLM call that can never add rows), VERIFIES verbatim by string
// comparison, annotates conditionals, and traverses incorporation-by-reference against a local clause
// library. Everything except the LLM classify step is deterministic.
//
// Enum reality (verified against prisma/schema.prisma — do NOT use the display labels a pasted spec
// might assert): RequirementSource = instruction | evaluation_factor | sow_pws | far_clause | other.
// Section L = `instruction`, Section M = `evaluation_factor`.

export type UCFSectionType =
  | 'SECTION_L'
  | 'SECTION_M'
  | 'SOW_PWS'
  | 'CDRL'
  | 'FAR_CLAUSE'
  | 'BACKGROUND'
  | 'OTHER';

// The classification vocabulary the LLM returns (spec §6.4). Mapped to the real DB enum below.
export type LlmSource =
  | 'SECTION_L_INSTRUCTION'
  | 'SECTION_M_EVALUATION_FACTOR'
  | 'SOW_PWS_REQUIREMENT'
  | 'FAR_DFARS_CLAUSE'
  | 'CDRL_DELIVERABLE'
  | 'ADMINISTRATIVE'
  | 'OTHER';

// The real dara_requirements column enums.
export type DbSource = 'instruction' | 'evaluation_factor' | 'sow_pws' | 'far_clause' | 'other';
export type DbDisposition = 'scored' | 'compliance' | 'administrative';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** A pre-identified obligation candidate assembled from the ParseResult (spec §6.3). */
export interface RequirementCandidate {
  candidateId: string;
  sourceText: string;
  modalVerb: string;
  modalClass: string;
  subject: string | null;
  subjectInferred: boolean;
  verbPhrase: string | null;
  object: string | null;
  svoConfidence: Confidence;
  ucfSectionType: UCFSectionType;
  sectionPath: string;
  sectionId: string | null;
  paragraphId: string;
  sentenceId: string;
  pageNumber: number | null;
  isPassive: boolean;
  isTableDerived: boolean;
  isCdrl: boolean;
  tableHeaders?: string[];
  conditionalTriggerIds: string[];
  ibrFlagIds: string[];
  duplicateSourceIds: string[];
}

/** The LLM's per-candidate classification (spec §6.4). It classifies only; it cannot add candidates. */
export interface Classification {
  id: string;
  isRequirement: boolean;
  source: LlmSource;
  disposition: DbDisposition;
  title: string;
  normalizedMeaning: string;
  parentCandidateId: string | null;
  confidence: Confidence;
}

export interface ClassifiedCandidate extends RequirementCandidate {
  classification: Classification;
}

/** A matched conditional structure (Pass 2). */
export interface ConditionAnnotation {
  triggerId: string;
  conditionType: string;
  triggerText: string;
  scopeText: string;
  confidence: string;
  parentConditionId: string | null;
}

export interface AnnotatedCandidate extends ClassifiedCandidate {
  conditions: ConditionAnnotation[];
}

export interface VerifiedCandidate extends AnnotatedCandidate {
  verbatimVerified: boolean;
}

/** The final pipeline row unit, ready for persist. Maps to dara_requirements columns + hrlr JSONB. */
export interface ExtractedRequirement {
  candidateId: string;
  title: string;
  description: string; // verbatim source text
  normalizedMeaning: string;
  source: DbSource;
  disposition: DbDisposition;
  citation: string;
  farReference: string;
  sourceAnchor: string | null; // sentence_id (or table row id) linking back to the ParseResult
  sectionId: string | null;
  pageNumber: number | null;
  parentCandidateId: string | null;
  confidence: Confidence;
  verbatimVerified: boolean;
  reviewStatus: ReviewStatus;
  flags: string[];
  conditionalTriggerIds: string[];
  conditions: ConditionAnnotation[];
  ibrFlags: string[];
  citationChain: string[];
  traversalDepth: number;
  versionResolved: boolean;
  passOrigin: 1 | 2 | 3;
  // Informational (stored in hrlr, NOT in `flags` — these must not force a review flag).
  subjectInferred?: boolean;
  mergedCount?: number;
  // Source solicitation document this row was extracted from (stamped per-doc by the orchestrator).
  documentId?: bigint | null;
}

// ── Deterministic enum mapping ─────────────────────────────────────────────────

const LLM_TO_DB_SOURCE: Record<LlmSource, DbSource> = {
  SECTION_L_INSTRUCTION: 'instruction',
  SECTION_M_EVALUATION_FACTOR: 'evaluation_factor',
  SOW_PWS_REQUIREMENT: 'sow_pws',
  FAR_DFARS_CLAUSE: 'far_clause',
  CDRL_DELIVERABLE: 'sow_pws',
  ADMINISTRATIVE: 'other',
  OTHER: 'other'
};

const UCF_TO_DB_SOURCE: Record<UCFSectionType, DbSource> = {
  SECTION_L: 'instruction',
  SECTION_M: 'evaluation_factor',
  SOW_PWS: 'sow_pws',
  CDRL: 'sow_pws',
  FAR_CLAUSE: 'far_clause',
  BACKGROUND: 'other',
  OTHER: 'other'
};

export function llmSourceToDb(s: LlmSource): DbSource {
  return LLM_TO_DB_SOURCE[s] ?? 'other';
}

export function ucfSourceToDb(s: UCFSectionType): DbSource {
  return UCF_TO_DB_SOURCE[s] ?? 'other';
}

/** Categorical confidence routing → parse-QA reviewStatus (spec §Pass 1 confidence routing). */
export function deriveReviewStatus(
  confidence: Confidence,
  verbatimVerified: boolean,
  flags: string[]
): ReviewStatus {
  if (flags.length > 0) return 'flagged';
  if (confidence === 'LOW') return 'flagged';
  if (confidence === 'HIGH' && verbatimVerified) return 'approved';
  return 'pending';
}
