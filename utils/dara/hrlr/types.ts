// Hierarchical Requirement Logic Resolution (HRLR) — data model.
//
// Core doctrine: the source document is EVIDENCE, not a normalized data model. Every requirement
// carries THREE independent identities that may legitimately disagree:
//   - Source identity      (how it appeared: exact text, original marker, section path, offsets)
//   - Logical identity      (stable primary key REQ-XXXXXX — never rewritten by inferred structure)
//   - Presentation identity (synthetic display path R-n.n — derived, never authoritative)
//
// These files are intentionally free of app/`@/` imports so the same core runs in a standalone
// prototype AND ports verbatim into utils/dara/requirements.ts (the shred).

// ---------------------------------------------------------------------------------------------
// Structural state — explicit, never inferred solely from presence/absence of descendants.
export const NODE_STATES = [
  'STANDALONE', // complete, independently actionable, no children
  'PARENT_WITH_CHILDREN', // container/obligation with one or more children
  'CHILD', // subordinate to a parent
  'PARENT_AND_CHILD', // both a child above and a parent below
  'UNRESOLVED' // relationship indeterminable from the text
] as const;
export type NodeState = (typeof NODE_STATES)[number];

// Satisfaction logic a parent asserts over its children.
export const SATISFACTION_KINDS = [
  'ALL_OF',
  'ANY_OF',
  'EXACTLY_ONE_OF',
  'AT_LEAST_N',
  'OPTIONAL_SET',
  'EVALUATE_COLLECTIVELY',
  'EVALUATE_INDIVIDUALLY',
  'EXAMPLES_OF', // children are non-exhaustive illustrations of the parent
  'EVIDENCE_FOR', // children are evidentiary support for the parent claim
  'NONE', // node has no children — rule is not applicable
  'UNRESOLVED' // has children but the rule cannot be determined
] as const;
export type SatisfactionKind = (typeof SATISFACTION_KINDS)[number];

export interface SatisfactionRule {
  kind: SatisfactionKind;
  n: number | null; // threshold for AT_LEAST_N
  basis: 'EXPLICIT' | 'INFERRED' | 'UNRESOLVED';
  rationale: string;
}

// Whether evaluation is performed against the node itself, each child, the parent collectively,
// or an aggregate requirement set.
export const EVAL_SCOPES = ['SELF', 'EACH_CHILD', 'PARENT_COLLECTIVE', 'AGGREGATE_SET', 'UNRESOLVED'] as const;
export type EvalScope = (typeof EVAL_SCOPES)[number];

// ---------------------------------------------------------------------------------------------
// DARA compliance-matrix taxonomy — kept on every node so the graph ports directly into the
// existing Requirement model (source + disposition drive the matrix + compliance sweep).
export const REQUIREMENT_SOURCES = ['instruction', 'evaluation_factor', 'sow_pws', 'far_clause', 'other'] as const;
export type RequirementSource = (typeof REQUIREMENT_SOURCES)[number];

export const DISPOSITIONS = ['scored', 'compliance', 'administrative'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const MANDATORY_KINDS = ['MANDATORY', 'NON_MANDATORY', 'CONDITIONAL'] as const;
export type MandatoryKind = (typeof MANDATORY_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// SOURCE REPRESENTATION — documentary evidence. Never overwritten because the parser inferred a
// different logical structure.
export interface SourceProvenance {
  documentName: string;
  sectionPath: string; // e.g. "3 Technical > 3.2 Requirements > 3.2.1"
  originalMarker: string; // "3.2.1(a)" exactly as the document labels it; '' if unlabeled
  page: number | null;
  exactText: string; // verbatim slice of THIS unit (excludes children's text)
  spanStart: number | null; // char offset into the supplied text (best-effort)
  spanEnd: number | null;
  verbatimVerified: boolean; // exactText was located in the source (raw or normalized)
}

// Response-mode extension — a proposal passage is a claim ABOUT requirements, not a requirement.
export const CLAIM_TYPES = ['COMMITMENT', 'EVIDENCE', 'ASSUMPTION', 'EXCEPTION', 'NARRATIVE'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export interface ResponseMeta {
  claimType: ClaimType;
  addressesMarkers: string[]; // solicitation markers this passage claims to satisfy, if stated
}

// ---------------------------------------------------------------------------------------------
// A single node in the requirement graph. SEMANTIC fields (state, satisfaction, parent/child) are
// reconstructed by the parser; SOURCE fields live under `provenance`; PRESENTATION fields
// (logicalId, syntheticPath) are assigned deterministically in resolve.ts.
export interface RequirementNode {
  // Logical identity (assigned in resolve; stable primary key).
  logicalId: string; // REQ-000001
  // Presentation identity (assigned in resolve; derived display convention).
  syntheticPath: string; // R-3.2

  // The model's own per-extraction handle used to express links. Distinct from source_marker so
  // duplicated/missing/blank source numbering can never corrupt the logical graph.
  key: string;
  parentKey: string | null;
  childKeys: string[];

  state: NodeState;
  mandatory: MandatoryKind;

  exactText: string; // == provenance.exactText, surfaced for convenience
  normalizedMeaning: string; // plain-language restatement (the SEMANTIC reading)

  source: RequirementSource;
  disposition: Disposition;

  satisfaction: SatisfactionRule;
  evalScope: EvalScope;
  applicability: string; // conditions/scope for descendants; '' if none

  provenance: SourceProvenance;

  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceRationale: string;

  response: ResponseMeta | null; // populated only in response mode

  flags: string[]; // integrity notes added during resolve (see resolve.ts)

  // Same-marker fragment detection (resolve.ts). Present ONLY on a node flagged as a probable
  // mis-split — e.g. a bare "(CDRL A005)" tag the model emitted as its own node under a marker its
  // real requirement already occupies. Detection flags; a reviewer decides whether to merge.
  fragmentStatus?: 'PROBABLE_SPLIT';
  fragmentReason?: string; // which fragment signal matched
  fragmentMergeCandidate?: string; // logicalId of the longest node sharing this source marker
}

export interface NumberingConflict {
  childId: string; // logicalId
  parentId: string; // logicalId
  note: string;
}

// A source structural marker (e.g. "2.4.1") physically present in the document for which no node
// was extracted — the coverage-gap detector's finding. A missing requirement is worse than a
// duplicate, so gaps are surfaced, never inferred away.
export interface CoverageGap {
  type: 'coverageGap';
  sourceMarker: string; // normalized marker missing from the extracted nodes
  rawContext: string; // ~300 chars of source around the marker, for review
  detectedAt: 'resolveGraph' | 'shredRequirements';
  status: 'UNEXTRACTED';
}

export interface GraphStats {
  total: number;
  standalone: number;
  parents: number;
  children: number;
  unresolved: number;
  unverified: number; // provenance.verbatimVerified === false
}

export interface RequirementGraph {
  docKind: 'solicitation' | 'response';
  documentName: string;
  nodes: RequirementNode[];
  numberingConflicts: NumberingConflict[];
  coverageGaps: CoverageGap[]; // source markers with no extracted node; [] when the check found none
  stats: GraphStats;
}
