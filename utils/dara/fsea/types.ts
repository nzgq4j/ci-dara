// Federal Solicitation Evaluation Architecture (FSEA) — shared type definitions.
//
// Every pass produces typed output conforming to these interfaces. Temperature 0 is enforced
// at the prompt level; every LLM output is validated against these shapes before being passed
// to the next pass. Null is always the correct response when a field cannot be found in the
// source text — the model is never permitted to infer or fabricate.

// ── Pass 1 — Document Structure ───────────────────────────────────────────────

export interface P1DocumentStructure {
  packageInventory: P1Document[];
  sections: P1Section[];
  criticalParagraphs: string[];      // e.g. ['2.4.1', '2.4.2', '2.4.3', '2.5', '2.6.1', '2.6.2', '2.6.3']
  cdrlItems: P1Cdrl[];
  documentText: string;              // full concatenated text for downstream passes
}

export interface P1Document {
  name: string;
  role: 'rfp_base' | 'pws_sow' | 'cdrl' | 'amendment' | 'attachment' | 'other';
  present: boolean;
}

export interface P1Section {
  id: string;                        // e.g. 'pws-2.4.1'
  number: string;                    // e.g. '2.4.1'
  title: string;
  parentId: string | null;
  type: 'critical' | 'non_critical' | 'contract_performance' | 'compliance' | 'context';
  pageStart: number | null;
  pageEnd: number | null;
}

export interface P1Cdrl {
  id: string;                        // e.g. 'A001'
  title: string;
  frequency: string;
  authority: string;
  pwsRef: string;
}

// ── Pass 2 — Requirement Candidates ───────────────────────────────────────────

export interface P2Output {
  candidates: P2Candidate[];
  summary: {
    total: number;
    critical: number;
    nonCritical: number;
    compliance: number;
  };
}

export interface P2Candidate {
  reqId: string;                     // e.g. '2.4.1-01'
  sectionId: string;                 // parent section
  sectionTitle: string;
  isCritical: boolean;
  modal: string;                     // 'Shall' | 'Must' | 'Will' | 'Should'
  actor: string;                     // 'Contractor' | 'Government' | other
  action: string;                    // verb phrase
  object: string;                    // noun phrase — the thing being acted on
  condition: string | null;          // conditional clause if present
  exactText: string;                 // verbatim from the source document
}

// ── Pass 3 — Evaluation Factor Discovery ──────────────────────────────────────

export interface P3Output {
  evaluationStrategy: 'best_value_tradeoff' | 'lpta' | 'technically_acceptable' | 'other';
  tradeoffLanguage: string | null;
  interchangeIntent: string | null;
  factors: P3Factor[];
  ratingScale: P3RatingLevel[];
  constructDefinitions: P3Construct[];
  strengthSignals: P3StrengthSignal[];
  strategicConstraints: P3Constraint[];
}

export interface P3Factor {
  id: string;                        // e.g. 'F1', 'F2'
  name: string;                      // e.g. 'Technical'
  orderOfImportance: number;
  ratingMethod: 'adjectival' | 'pass_fail' | 'point_score' | 'narrative';
  relativeImportanceStatement: string | null;
  sourceText: string;
}

export interface P3RatingLevel {
  label: string;                     // 'Outstanding' | 'Good' | 'Acceptable' | 'Marginal' | 'Unacceptable'
  description: string;
  riskLevel: string;
}

export interface P3Construct {
  name: 'Strength' | 'Weakness' | 'Deficiency';
  definition: string;
  scoringEffect: string;
}

export interface P3StrengthSignal {
  term: string;
  location: string;
  implication: string;
}

export interface P3Constraint {
  id: string;                        // e.g. 'C1', 'C2'
  description: string;
  strategicImplication: string;
}

// ── Pass 4 — Evaluation Ontology ──────────────────────────────────────────────

export interface P4Output {
  evaluationStrategy: P4StrategyObject;
  factors: P4Factor[];
  criteria: P4Criterion[];
  evaluationSurface: P4EvalSurface[];
  constructs: P4ConstructObject[];
  strengthOpportunities: P4StrengthOpportunity[];
  weaknessRisks: P4WeaknessRisk[];
  adminCompliance: P4AdminItem[];
  deliverables: P4Deliverable[];
  relationships: P4Relationship[];
}

export interface P4StrategyObject {
  type: string;
  dominantFactor: string;
  priceRole: string;
  interchangeIntent: string;
  awardQuantity: string;
  setAside: string | null;
}

export interface P4Factor {
  id: string;                        // 'F1', 'F2'
  name: string;
  orderOfImportance: number;
  ratingMethod: string;
}

export interface P4Criterion {
  id: string;                        // 'F1-C1', 'F1-C2', 'F1-C3', 'F1-C4'
  factorId: string;
  text: string;
  source: string;
}

export interface P4EvalSurface {
  paragraphId: string;               // 'CP-01' through 'CP-07'
  pwsRef: string;                    // '2.4.1'
  title: string;
  parent: string;
  role: 'primary_evaluation_surface';
}

export interface P4ConstructObject {
  name: string;
  definition: string;
  scoringEffect: string;
}

export interface P4StrengthOpportunity {
  id: string;                        // 'SO-01' through 'SO-08'
  signal: string;
  source: string;
  targetParagraphs: string[];
  type: string;
}

export interface P4WeaknessRisk {
  id: string;                        // 'WR-01' through 'WR-08'
  description: string;
  triggeredBy: string;
  effect: string;
}

export interface P4AdminItem {
  id: string;                        // 'AC-01' through 'AC-17'
  requirement: string;
  source: string;
  statusNeeded: string;
}

export interface P4Deliverable {
  id: string;                        // 'DL-01' through 'DL-05'
  cdrl: string;
  title: string;
  frequency: string;
  format: string;
  pwsRef: string;
}

export interface P4Relationship {
  from: string;
  relationship: string;
  to: string;
}

// ── Pass 5 — Requirement Classification ───────────────────────────────────────

export interface P5Output {
  classified: P5Requirement[];
  summary: {
    eval: number;
    evalMarginal: number;
    perf: number;
    comp: number;
    info: number;
    discarded: number;
  };
  clusters: P5Cluster[];
}

export type P5Type = 'EVAL' | 'PERF' | 'COMP' | 'INFO';
export type P5Actionability = 'A' | 'N' | 'M';
export type P5Disposition = 'MATRIX' | 'NARRATIVE' | 'CHECKLIST' | 'DISCARD';

export interface P5Requirement {
  reqId: string;
  sectionId: string;
  isCritical: boolean;
  requirementSummary: string;
  type: P5Type;
  actionable: P5Actionability;
  disposition: P5Disposition;
  rationale: string;
  governingCriteriaIds: string[];    // ['F1-C1', 'F1-C3'] from the ontology
}

export interface P5Cluster {
  id: string;                        // 'CL-01' through 'CL-04'
  theme: string;
  appearsIn: string[];               // ['CP-01', 'CP-04', 'CP-06']
}

// ── Pass 6 — Proposal Actionability ───────────────────────────────────────────

export interface P6Output {
  actionabilityDeterminations: P6Determination[];
  pageBudget: P6PageBudget[];
  strengthTargetList: P6StrengthTarget[];
  clusterConsolidation: P6ClusterGuidance[];
  guardRails: P6GuardRail[];
}

export interface P6Determination {
  reqId: string;
  paragraphId: string;
  responseRequired: boolean;
  strengthensRating: boolean;
  strengthLevel: 'High' | 'Medium' | 'Low' | null;
  risksWeakness: boolean;
  pageSignal: string;                // 'High' | 'Medium' | 'Low' | 'One sentence' | 'Lead statement' | 'Highest-priority passage'
  notes: string;
}

export interface P6PageBudget {
  paragraphId: string;
  title: string;
  pagesMin: number;
  pagesMax: number;
}

export interface P6StrengthTarget {
  rank: number;
  strengthTarget: string;
  paragraph: string;
  strengthType: string;
  pageInvestment: string;
}

export interface P6ClusterGuidance {
  clusterId: string;
  requirementsSatisfied: string[];
  recommendedApproach: string;
}

export interface P6GuardRail {
  section: string;
  doNotAddressUnless: string;
}

// ── Pass 7 — L-to-M Mapping ───────────────────────────────────────────────────

export interface P7Output {
  mappingArchitecture: string;
  paragraphMaps: P7ParagraphMap[];
  crossParagraphWires: P7CrossWire[];
  narrativePriorityStack: P7Priority[];
  wiringIntegrityStatus: string;
}

export interface P7ParagraphMap {
  paragraphId: string;
  wiringVerdict: string;
  rows: P7WiringRow[];
}

export interface P7WiringRow {
  proposalInstruction: string;
  submissionRequirement: string;
  evaluationCriterion: string;       // 'F1-C1' | 'F1-C2' | 'F1-C3' | 'F1-C4'
  ratingSignal: string;
  strengthGate: string | null;
}

export interface P7CrossWire {
  id: string;                        // 'XW-01' through 'XW-07'
  capability: string;
  paragraphs: string[];
  criteriaConnected: string[];
}

export interface P7Priority {
  rank: number;
  capability: string;
  paragraph: string;
  criteria: string;
  pageInvestment: string;
}

// ── Pass 8 — Strength Opportunity Detection ───────────────────────────────────

export interface P8Output {
  strengthOpportunities: P8StrengthOpportunity[];
  summary: {
    total: number;
    byParagraph: Record<string, number>;
    top5: { rank: number; soId: string; paragraph: string; impact: string }[];
  };
  criticalGapAdvisory: string;
}

export interface P8StrengthOpportunity {
  soId: string;                      // 'SO-CP01-01' through 'SO-CP07-03'
  paragraph: string;
  requirement: string;
  threshold: string;
  strength: string;
  evidenceRequired: string;
  soType: string[];                  // ['SO-04', 'SO-07']
  priority: number | string;
  writingBrief: string;
}

// ── Pass 9 — Cross-Reference Resolution ───────────────────────────────────────

export interface P9Output {
  internalCrossRefs: P9CrossRef[];
  crossRefDependencyMap: string;     // rendered as text
  regulatoryCitations: P9Citation[];
  cdrlLinkages: P9CdrlLinkage[];
  solicitationAnchors: P9Anchor[];
  integrityStatus: string;
  actionsRequired: P9Action[];
}

export interface P9CrossRef {
  id: string;                        // 'XR-01' through 'XR-06'
  establishedIn: string;
  crossReferencedIn: string[];
  contentEstablished: string;
  crossReferenceLanguage: Record<string, string>;  // paragraph -> suggested language
  pageSaving: string;
  riskIfOmitted: string;
}

export interface P9Citation {
  citation: string;
  fullTitle: string;
  relevance: string;
  verifiedAgainstSolicitation: string;
}

export interface P9CdrlLinkage {
  cdrl: string;
  narrativeUseContext: string;
  paragraph: string;
  languageGuidance: string;
}

export interface P9Anchor {
  category: string;
  solicitationText: string;
  location: string;
  requiredNarrativeReflection: string;
}

export interface P9Action {
  actionNumber: number;
  description: string;
  urgency: 'before_drafting' | 'before_submission';
}

// ── Pass 10 — Matrix and Products ────────────────────────────────────────────

export interface P10Output {
  sectionA: P10MatrixRow[];
  sectionB: P10StrengthRegisterEntry[];
  sectionC: P10WeaknessRisk[];
  sectionD: P10AdminChecklist[];
  executiveSummary: P10ExecutiveSummary;
  paragraphWritingSequences: P10WritingSequence[];
}

export interface P10MatrixRow {
  reqId: string;
  paragraphId: string;
  requirement: string;
  proposalResponseObligation: string;
  evaluationCriterion: string;
  strengthGate: string | null;
  crossReference: string | null;
  pageSignal: string;
  priority: 'lead' | 'high' | 'medium' | 'low' | 'checklist_only';
  writingSequenceOrder: number;
  pageBudgetMin: number | null;
  pageBudgetMax: number | null;
}

export interface P10StrengthRegisterEntry {
  soId: string;
  paragraph: string;
  requirement: string;
  threshold: string;
  strengthDescription: string;
  evidenceRequired: string;
  status: 'to_be_confirmed' | 'confirmed' | 'partial' | 'absent';
}

export interface P10WeaknessRisk {
  wrId: string;
  riskDescription: string;
  trigger: string;
  effect: string;
  guardAction: string;
}

export interface P10AdminChecklist {
  acId: string;
  requirement: string;
  source: string;
  responsible: string;
  status: 'to_be_confirmed' | 'confirmed' | 'na';
}

export interface P10ExecutiveSummary {
  requirementsTotal: number;
  requirementsActionable: number;
  requirementsDiscarded: number;
  strengthOpportunities: number;
  weaknessRisks: number;
  crossReferencesResolved: number;
  regulatoryCitationsRegistered: number;
  solicitationAnchors: number;
  adminComplianceItems: number;
  pageBudget: { volume: string; pagesMin: number; pagesMax: number }[];
  criticalActions: string[];
  highestLeverageAction: string;
}

export interface P10WritingSequence {
  paragraphId: string;
  sequence: string[];
}

// ── Orchestrator result ────────────────────────────────────────────────────────

export interface FSEAResult {
  ok: boolean;
  error?: string;
  matrixCount?: number;
  strengthCount?: number;
  adminCount?: number;
  passResults?: {
    p1?: boolean; p2?: boolean; p3?: boolean; p4?: boolean; p5?: boolean;
    p6?: boolean; p7?: boolean; p8?: boolean; p9?: boolean; p10?: boolean;
  };
}
