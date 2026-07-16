# Federal Solicitation Evaluation Architecture (FSEA)
## Technical Specification and Developer Reference
### DARA — ci-dara | Crucible Insight

---

## Overview

The Federal Solicitation Evaluation Architecture (FSEA) is the solicitation analysis pipeline that powers DARA's compliance matrix generation. It replaces the previous HRLR (Hierarchical Requirement Logic Resolution) shred function with a 10-pass sequential LLM pipeline that produces an evaluation-centric matrix rather than a compliance checklist.

The central design principle: the evaluation methodology determines what belongs in the proposal. The pipeline extracts and models the evaluation methodology first, then maps proposal instructions and requirements back to it.

**Entry point:** `utils/dara/fsea/orchestrator.ts` → `runFSEA()`

**Triggered by:** The "Generate" button on the Compliance tab, which enqueues a `shred` job in `dara_job_queue`. The worker in `utils/dara/passes.ts` → `processReviewJobs()` dispatches to `runFSEA()`.

**Output:** Four artifacts written to the database after a successful run:

| Artifact | Storage | Contents |
|---|---|---|
| Section A — Evaluation Matrix | `dara_requirements` rows | One row per actionable requirement; proposal response obligation in `description`; FSEA metadata in `hrlr` JSONB |
| Section D — Compliance Checklist | `dara_requirements` rows | Administrative items with `hrlr.isChecklist = true` |
| Sections B, C + ontology + pipeline metadata | `dara_solicitations.notes` JSONB | Strength register, weakness register, evaluation ontology, cross-references, page budget, writing sequences |
| Progress labels | `dara_job_queue.progressLabel` | Updated after each pass so the UI poll shows real status |

---

## Pipeline Architecture

The pipeline runs as a sequential conversation. Each pass receives the outputs of all prior passes as context and builds on them. No pass performs more than its defined scope. All LLM calls run at temperature 0 with JSON-only output schemas.

```
Document text (Pass 1)
        │
        ▼
Pass 2 — Requirement Candidate Detection       [LLM] [HARD GATE]
        │
        ▼
Pass 3 — Evaluation Factor Discovery           [LLM] [HARD GATE]
        │
        ▼
Pass 4 — Evaluation Ontology Construction      [LLM] [RETRYABLE → FALLBACK]
        │
        ▼
Pass 5 — Requirement Classification            [LLM] [RETRYABLE → ABORT]
        │
        ▼
Pass 6 — Proposal Actionability                [LLM] [GRACEFUL DEGRADE]
        │
        ▼
Pass 7 — L-to-M Mapping                        [LLM] [GRACEFUL DEGRADE]
        │
        ▼
Pass 8 — Strength Opportunity Detection        [LLM] [GRACEFUL DEGRADE]
        │
        ▼
Pass 9 — Cross-Reference Resolution            [LLM] [GRACEFUL DEGRADE]
        │
        ▼
Pass 10 — Matrix and Products Generation       [LLM] [HARD GATE → PARTIAL SAVE]
        │
        ▼
Persist (write-results.ts)
```

---

## File Structure

```
utils/dara/fsea/
├── orchestrator.ts         Pipeline entry point; sequences all 10 passes
├── types.ts                TypeScript interfaces for all pass inputs/outputs
├── clause-library.ts       FAR/DFARS clause library access and admin sync
├── passes/                 (reserved for future per-pass modules)
├── prompts/
│   └── index.ts            System prompts for all 9 LLM passes (P2–P10)
└── persist/
    └── write-results.ts    Database write layer; full and partial save
```

---

## Pass Reference

### Pass 1 — Document Assembly
**Type:** Deterministic — no LLM call
**Function:** `runPass1()` in `orchestrator.ts`

Loads eligible documents from the database, prefers structured parse result text (`dara_parse_results`) over flat extracted text (`dara_sol_documents.extracted_text`), and concatenates into a single `documentText` string passed to all subsequent passes.

**Document eligibility filter:** Only documents with `docType = 'rfp'`, `extractionStatus = 'complete'`, and `documentRole IN ('rfp_base', 'pws_sow')` are included. Documents with no `documentRole` assigned (legacy rows) are also included for backward compatibility. Section J attachments, pricing sheets, DD Forms, and other supporting material are excluded.

**Text priority:** Structured parse result → flat extracted text → skip with warning

**Truncation:** Documents exceeding 500,000 characters are truncated with a notice appended.

**Output:** `P1DocumentStructure` with `packageInventory`, `documentText`, and empty arrays for `sections`, `criticalParagraphs`, and `cdrlItems` (these are populated by LLM passes, not Pass 1).

**Failure modes:**
- No solicitation found → abort
- No eligible documents → abort with actionable hint ("Assign document roles on the Documents tab")
- All eligible documents have empty text → abort

---

### Pass 2 — Requirement Candidate Detection
**Type:** LLM — hard gate
**Prompt:** `PASS_2_SYSTEM` in `prompts/index.ts`
**Input:** Full document text
**Output:** `P2Output` — array of `P2Candidate` objects

Scans the solicitation text for every sentence or clause containing regulatory or evaluative force. Detection only — no interpretation or classification. Produces one candidate per obligation with actor, modal verb, action, object, condition, and verbatim `exactText`.

**Trigger patterns:** `shall`, `must`, `will`, `should`, `may` (obligation context); imperative verbs (`submit`, `provide`, `describe`, `demonstrate`, etc.); submission phrases (`offerors shall`, `quoters shall`); negative obligations (`shall not`, `must not`).

**Critical paragraph flagging:** Candidates within sections explicitly identified in the solicitation as critical evaluation paragraphs receive `isCritical: true`.

**Hard gate behavior:** If no candidates are extracted or the output is unparseable after retry, the pipeline aborts. Without a candidate list, all downstream passes are meaningless.

**Output schema (per candidate):**
```typescript
{
  reqId: string;          // e.g. "2.4.1-01"
  sectionId: string;
  sectionTitle: string;
  isCritical: boolean;
  modal: string;
  actor: string;
  action: string;
  object: string;
  condition: string | null;
  exactText: string;      // verbatim from source
}
```

---

### Pass 3 — Evaluation Factor Discovery
**Type:** LLM — hard gate
**Prompt:** `PASS_3_SYSTEM`
**Input:** Full document text
**Output:** `P3Output` — evaluation model structure

Parses the evaluation model from the solicitation. This pass runs against the same document text as Pass 2 but targets an entirely different surface: how the Government will evaluate and make award, not what the contractor must do.

**Extraction targets:**
- Evaluation strategy (best value tradeoff, LPTA, technically acceptable)
- Named evaluation factors and their order of importance
- Adjectival or numerical rating scale with full definitions
- Verbatim definitions of Strength, Weakness, and Deficiency
- Strength opportunity signals (exact phrases from evaluation language)
- Strategic constraints implied by the evaluation methodology
- Price evaluation role and interchange intent

**Hard gate behavior:** If no evaluation factors are found after retry, the pipeline aborts. Without an evaluation model, requirement classification in Pass 5 cannot assign governing criteria.

---

### Pass 4 — Evaluation Ontology Construction
**Type:** LLM — retryable with fallback
**Prompt:** `PASS_4_SYSTEM`
**Input:** Full document text + P2 candidates + P3 evaluation factors
**Output:** `P4Output` — complete evaluation object model

Constructs a 10-level typed object model from the evaluation data. This ontology is the reference structure for all downstream passes — Passes 5, 7, 8, and 10 all receive it as a lookup table.

**Object levels:**

| Level | Object Type | Example |
|---|---|---|
| 1 | Evaluation Strategy | Best Value Tradeoff, dominant factor, price role |
| 2 | Evaluation Factors | F1 — Technical (adjectival, importance #1) |
| 3 | Evaluation Criteria | F1-C1: "demonstration of clear understanding..." |
| 4 | Evaluation Surface | CP-01 through CP-07 (critical paragraphs) |
| 5 | Evaluative Constructs | Strength/Weakness/Deficiency verbatim definitions |
| 6 | Strength Opportunities | SO-01 through SO-08 (general signal types) |
| 7 | Weakness Risks | WR-01 through WR-08 (identified failure modes) |
| 8 | Administrative Compliance | AC-01 through AC-17 (submission gates) |
| 9 | Deliverable Obligations | DL-01 through DL-05 (CDRLs) |
| 10 | Relationship Map | Typed edges connecting all objects |

**Fallback behavior:** If Pass 4 fails after retry, `buildFallbackOntology()` constructs a minimal ontology from Pass 3 output (factor names, strategy type, strength signals). The pipeline continues with degraded ontology quality rather than aborting. Degradation is noted in the executive summary.

---

### Pass 5 — Requirement Classification
**Type:** LLM — retryable, abort on failure
**Prompt:** `PASS_5_SYSTEM`
**Input:** P4 evaluation ontology (as lookup table) + P2 candidate list
**Output:** `P5Output` — classified requirements with dispositions

Classifies every requirement candidate against the evaluation ontology. The ontology is provided as a reference table; the LLM matches candidates to criteria by explicit cross-reference, keyword match, or section proximity — it does not infer new factor names.

**Classification dimensions:**

*Type (mutually exclusive):*
- `EVAL` — directly evaluated; drives rating
- `PERF` — contract performance; not evaluated in proposal
- `COMP` — compliance or administrative; checklist only
- `INFO` — informational context; no response required

*Actionability:*
- `A` — actionable in proposal
- `N` — not proposal-actionable
- `M` — marginal; include only if it reinforces a critical paragraph strength

*Disposition:*
- `MATRIX` — include in evaluation matrix
- `NARRATIVE` — address in Part Two but not as a primary matrix row
- `CHECKLIST` — track on administrative checklist only
- `DISCARD` — not relevant to proposal response

**Critical paragraph doctrine:** When the solicitation states that adequate treatment of named critical paragraphs constitutes acceptance of all other requirements, all non-critical performance requirements receive `PERF/N/DISCARD`. Addressing them in the proposal creates rating risk with no offsetting benefit.

**Cluster detection:** Pass 5 identifies thematic clusters — groups of requirements sharing conceptual overlap across multiple paragraphs. Each cluster is a narrative economy opportunity: one well-constructed statement can satisfy multiple requirements. Clusters feed Pass 6 consolidation guidance.

**Key output field:** `governingCriteriaIds` — the criterion IDs from the ontology (e.g., `['F1-C1', 'F1-C3']`) this requirement contributes to. This is the authoritative L→M linkage, stored in `hrlr.governingCriteriaIds` on each database row.

---

### Pass 6 — Proposal Actionability
**Type:** LLM — graceful degrade
**Prompt:** `PASS_6_SYSTEM`
**Input:** P4 ontology + P5 matrix requirements + P5 clusters
**Output:** `P6Output` — actionability determinations, page budget, strength targets

Applies proposal strategy decision rules to every MATRIX-dispositioned requirement. Produces the page budget that governs how much space each critical paragraph receives in the proposal.

**Decision rules applied:**
- Rule 1: Response required if the requirement describes something the Government will evaluate
- Rule 2: Response not required if the requirement describes post-award contractor behavior
- Rule 3: Response strengthens rating if addressed with specificity and Government benefit framing
- Rule 4: Response risks weakness if addressed generically or incompletely
- Rule 5: Cluster consolidation — thematically overlapping requirements across paragraphs can be satisfied by a single narrative passage

**Page signal values** (applied to each requirement row):

| Signal | Meaning |
|---|---|
| `Lead statement` | Opens the paragraph; write first |
| `Highest-priority passage in CP-XX` | Single most important content in that paragraph |
| `High` | Full paragraph treatment required |
| `Medium` | One paragraph |
| `Low` | One to two sentences |
| `One sentence` | State and move on |
| `Consolidated with [req-id]` | Address together with named requirement |
| `Cross-reference only` | Point to where it was addressed; do not redevelop |
| `CHECKLIST only` | Do not address in proposal narrative |

**Strength target list:** All strength opportunities ranked by return on page investment — the ratio of rating elevation potential to page consumption required.

**Fallback behavior:** If Pass 6 fails, `buildFallbackP6()` assigns `Medium` page signal to all requirements and empty arrays for budget and consolidation guidance. Pipeline continues.

---

### Pass 7 — L-to-M Mapping
**Type:** LLM — graceful degrade
**Prompt:** `PASS_7_SYSTEM`
**Input:** First 40,000 chars of document text + P4 ontology + P5 matrix requirements + P6 actionability
**Output:** `P7Output` — typed wiring edges connecting proposal instructions to evaluation criteria

Produces the explicit L-to-M connection for every critical paragraph: which proposal instruction (Section L equivalent) wires to which evaluation criterion, what rating signal the wiring path achieves, and what specific evidence or demonstration would earn a strength under the solicitation's own strength definition.

**Wiring chain per row:**
```
Proposal Instruction
  → Submission Requirement (how to demonstrate it)
  → Evaluation Criterion (F1-C1, F1-C2, etc.)
  → Rating Signal (Acceptable to Good / Good to Outstanding)
  → Strength Gate (what specific demonstration exceeds compliance)
```

**Cross-paragraph wires:** Capabilities that connect to evaluation criteria across more than one critical paragraph. These represent narrative economy opportunities — one well-constructed capability statement satisfies multiple paragraph obligations. Cross-paragraph wires are tagged `XW-01` through `XW-NN` and determine the internal cross-reference architecture of the proposal.

**Narrative priority stack:** All wiring paths ranked by expected rating impact — the sequence in which writing effort should be allocated, highest return first.

**Fallback behavior:** If Pass 7 fails, `buildFallbackP7()` returns empty arrays. The matrix still generates in Pass 10 but without L-to-M wiring — the `strengthGate` field will be null on all matrix rows.

---

### Pass 8 — Strength Opportunity Detection
**Type:** LLM — graceful degrade
**Prompt:** `PASS_8_SYSTEM`
**Input:** P4 ontology + P7 L-to-M mapping + P4 construct definitions (Strength definition)
**Output:** `P8Output` — strength opportunity register with evidence requirements

Identifies every discrete strength opportunity available to the offeror using the solicitation's own strength definition as the controlling standard. For each opportunity, answers three questions:

1. What specific aspect of the offeror's capability EXCEEDS the stated requirement (not just meets it)?
2. How is that excess ADVANTAGEOUS TO THE GOVERNMENT during performance (not just to the offeror)?
3. What EVIDENCE must appear in the narrative to make the strength documentable rather than asserted?

**Each strength opportunity (SO) contains:**

| Field | Description |
|---|---|
| `soId` | Stable identifier, e.g. `SO-CP01-01` |
| `paragraph` | Critical paragraph location |
| `requirement` | The PWS/RFQ requirement being exceeded |
| `threshold` | What compliance looks like — the floor |
| `strength` | What exceeds compliance and why it is advantageous |
| `evidenceRequired` | Specific, concrete evidence — not generic advice |
| `writingBrief` | Sentence-level narrative guidance |
| `priority` | Rank within paragraph or relative descriptor |

**Critical gap advisory:** A plain-language statement identifying the single highest-risk absence — the strength opportunity where missing evidence has the most severe rating consequence. Surfaced in the UI as a warning banner.

**Fallback behavior:** If Pass 8 fails, strength register is empty. Section B of the matrix shows "no strengths identified." Pipeline continues.

---

### Pass 9 — Cross-Reference Resolution
**Type:** LLM — graceful degrade
**Prompt:** `PASS_9_SYSTEM`
**Input:** P5 clusters + P6 consolidation + P7 cross-paragraph wires + P8 strengths (first 15) + first 30,000 chars of document text
**Output:** `P9Output` — complete reference graph

Resolves four reference categories:

**Category 1 — Internal Cross-References (XR-01 through XR-NN):** Named cross-reference paths within the proposal narrative. Each XR has a defined establishment point (the paragraph that first develops the content) and one or more reception points (paragraphs that later reference it). The dependency map locks the writing sequence: a cross-reference cannot be received before it is established.

**Category 2 — Regulatory Citations:** Every regulatory framework referenced in the strength opportunities, verified against the solicitation. Includes citation rules governing how regulatory citations appear in narrative — listing regulations without demonstrating use produces a compliance assertion, not a strength.

**Category 3 — CDRL Linkages:** Contract deliverables mapped to their correct narrative use context. CDRLs are performance obligations, not evaluation criteria. The correct use is referencing the reporting rhythm as evidence of sustained performance discipline.

**Category 4 — Solicitation-to-Narrative Anchors:** Specific phrases from the solicitation that must be reflected accurately in the proposal. Paraphrasing evaluation criterion language inaccurately signals to the evaluator that the offeror did not read carefully.

**Fallback behavior:** If Pass 9 fails, cross-reference and citation sections are empty. The matrix generates without cross-reference notation. Pipeline continues.

---

### Pass 10 — Matrix and Products Generation
**Type:** LLM — hard gate with partial save on failure
**Prompt:** `PASS_10_SYSTEM`
**Input:** Outputs from all prior passes (Passes 2–9), context-trimmed to fit within token budget
**Output:** `P10Output` — four-section evaluation instrument

The integration pass. Receives the complete pipeline output and produces the four-section instrument that governs proposal strategy, narrative drafting, and compliance verification.

**Section A — Master Evaluation Matrix:** One row per actionable requirement. The `proposalResponseObligation` field is the critical output — a specific narrative directive specific enough that a writer with no prior knowledge of the solicitation can draft the correct content from it. "Address this requirement" is a failure. "Describe the AvMC approval navigation process; name the technology domain; state the approval pathway and outcome; frame Government benefit as reduced time-to-fielding" is a success.

**Section B — Strength Opportunity Register:** Consolidated register of all strength opportunities from Pass 8, with `status` field for offeror capability assessment.

**Section C — Weakness Risk Register:** All identified weakness risks with `trigger` (the specific action that causes it), `effect` (the rating consequence), and `guardAction` (what to do to prevent it).

**Section D — Administrative Compliance Checklist:** Every administrative compliance item from Pass 4 with `responsible` party assigned.

**Executive Summary:** Counts of all pipeline outputs, page budget by paragraph, highest-leverage action before drafting, and ordered list of critical pre-draft actions.

**Writing Sequences:** Per-paragraph ordered lists specifying the sequence in which requirements should be drafted within each critical paragraph, based on the strength opportunity map.

**Hard gate with partial save:** If Pass 10 fails after retry, `writeFseaPartial()` saves whatever Passes 2–9 produced so the run is not a total loss. The error is surfaced in the UI with a partial-pipeline banner.

---

## Error Handling

### Pass Gate Classification

| Pass | Gate Type | Failure Behavior |
|---|---|---|
| 1 | Hard abort | Returns user-facing error with actionable hint |
| 2 | Hard abort | Returns error; pipeline cannot continue without candidates |
| 3 | Hard abort | Returns error; pipeline cannot continue without evaluation model |
| 4 | Retryable → fallback | One retry; on second failure, builds minimal fallback ontology from P3 and continues |
| 5 | Retryable → abort | One retry; on second failure, aborts (no matrix is possible without classified requirements) |
| 6 | Graceful degrade | On failure, uses `buildFallbackP6()` (Medium page signal on all rows); notes in executive summary |
| 7 | Graceful degrade | On failure, uses `buildFallbackP7()` (empty wiring); notes in executive summary |
| 8 | Graceful degrade | On failure, empty strength register; notes in executive summary |
| 9 | Graceful degrade | On failure, empty cross-reference graph; notes in executive summary |
| 10 | Hard gate + partial save | On failure, saves P2–P9 data via `writeFseaPartial()`; returns error |

### JSON Parse Hardening

Every LLM response goes through two parse attempts before failing:

1. **Direct parse** after stripping markdown code fences
2. **Regex extraction** of the outermost `{...}` or `[...]` block

If both fail, the raw output (first 800 characters) is logged to the console for diagnosis.

### Deadline Handling

Each pass checks `Date.now() > deadlineMs` after completion. If the worker tick deadline is exceeded, `writeFseaPartial()` saves current state and the orchestrator returns a `deadline exceeded after Pass N` error. The job can be re-run from the beginning — partial data is preserved in the notes JSONB but the requirements table is cleared on re-run per the no-clobber guard.

### Retry Logic

Passes 2, 4, 5, and 10 support one retry on JSON parse failure. The retry prepends an explicit instruction to the user message: "Your previous response could not be parsed as JSON. Return ONLY a valid JSON object — no prose, no markdown code fences, no explanation. Begin your response with { and end with }." Context is trimmed to `MAX_PRIOR_CONTEXT_CHARS` (80,000 characters) on retry.

---

## Data Model

### dara_requirements (Section A and D rows)

FSEA rows share the `dara_requirements` table with manually-added and legacy shred rows. They are distinguished by `hrlr.fseaPassRow = true` in the JSONB field.

| Column | FSEA usage |
|---|---|
| `name` | Requirement summary (capped at 300 chars) |
| `description` | Proposal response obligation — the writing directive |
| `source` | Always `'instruction'` for Section A matrix rows |
| `disposition` | `'compliance'` for high/medium/lead priority; `'administrative'` for checklist |
| `citation` | Requirement ID from Pass 2 (e.g., `2.4.1-01`) |
| `sort_order` | Writing sequence order within the solicitation |
| `hrlr` | JSONB — all FSEA-specific metadata (see below) |

**`hrlr` JSONB fields written by FSEA:**

```typescript
{
  fseaPassRow: true,
  isChecklist: boolean,           // true for Section D rows
  paragraphId: string,            // e.g. 'CP-01'
  evaluationCriterion: string,    // e.g. 'F1-C1'
  strengthGate: string | null,    // e.g. 'SO-CP01-01'
  crossReference: string | null,  // e.g. 'XR-02'
  pageSignal: string,             // e.g. 'High'
  priority: string,               // e.g. 'lead' | 'high' | 'medium' | 'low'
  writingSequenceOrder: number,
  pageBudgetMin: number | null,
  pageBudgetMax: number | null,
  type: string,                   // P5 type: 'EVAL' | 'PERF' | 'COMP' | 'INFO'
  actionable: string,             // P5 actionability: 'A' | 'N' | 'M'
  governingCriteriaIds: string[], // e.g. ['F1-C1', 'F1-C3']
  partial: boolean,               // true if row was written by writeFseaPartial
}
```

### dara_solicitations.notes (Pipeline metadata)

The full pipeline output — everything not in dara_requirements rows — is stored in the solicitation's `notes` column as a JSON string. This is a temporary approach pending dedicated table migrations.

**Structure:**

```typescript
{
  fseaOutput: {
    partial: boolean,             // true if pipeline did not complete
    error?: string,               // error message if partial
    sectionB: P10StrengthRegisterEntry[],
    sectionC: P10WeaknessRisk[],
    sectionD: P10AdminChecklist[],
    executiveSummary: P10ExecutiveSummary,
    paragraphWritingSequences: P10WritingSequence[],
    evalOntology: {
      factors: P4Factor[],
      criteria: P4Criterion[],
      evaluationSurface: P4EvalSurface[],
      constructs: P4ConstructObject[],
    },
    crossRefs: P9CrossRef[],
    regulatoryCitations: P9Citation[],
    cdrlLinkages: P9CdrlLinkage[],
    solicitationAnchors: P9Anchor[],
    actionsRequired: P9Action[],
    pageBudget: { volume, pagesMin, pagesMax }[],
    strengthTargetList: P6StrengthTarget[],
    strengthOpportunities: P8StrengthOpportunity[],
    strengthSummary: { top5: ... },
    criticalGapAdvisory: string | null,
  }
}
```

---

## UI Integration

The pipeline output surfaces across five sub-tabs on the Compliance panel, rendered by `components/dara/ComplianceSubTabs.tsx`.

### Tab routing logic

| Tab | When FSEA data exists | When no FSEA data |
|---|---|---|
| Matrix | `FSEAMatrixPanel` — Sections A/B/C/D with executive summary | Legacy `ComplianceMatrix` table |
| Writing Plan | `WritingPlan` — Section A by paragraph with writing sequences | Empty state |
| Strengths | `StrengthGuide` — Section B with status buttons | Empty state |
| Risks | `WeaknessRegister` — Section C with mitigation tracking | Empty state |
| Evaluation | `FSEAEvaluationPanel` — ontology-driven factor/criterion/requirement hierarchy | Legacy `EvaluationPanel` with drag-and-drop L→M |

### Data flow from database to UI

```
page.tsx server component
  ├── Loads dara_requirements rows
  ├── Parses solicitation.notes JSON → fseaOutput
  ├── Builds sectionARows from requirements with hrlr.fseaPassRow = true
  └── Passes both to ComplianceSubTabs
        ├── matrixRows → legacy ComplianceMatrix (when no FSEA)
        ├── sectionARows → FSEAMatrixPanel + WritingPlan + FSEAEvaluationPanel
        └── fseaOutput → all five tabs
```

---

## Context Budget Management

Each LLM call is limited by the model's context window. FSEA manages this through two constants:

- `MAX_DOC_CHARS = 500,000` — maximum document text size after concatenation
- `MAX_PRIOR_CONTEXT_CHARS = 80,000` — maximum chars of prior pass output included in each subsequent pass user message

The `trimContext()` function serializes pass outputs to JSON and truncates at the budget limit with a notice. Truncation is logged as a warning. Passes 7 and 9 additionally receive only the first 40,000 and 30,000 characters of document text respectively, since they already receive large prior context from earlier passes.

---

## Prompt Design Principles

All nine LLM prompts enforce the following:

**Temperature-0 discipline:** Every prompt includes the explicit instruction "Return ONLY valid JSON matching the schema. If a field cannot be found in the source text, return null — never infer. Never paraphrase verbatim fields."

**Single responsibility:** Each prompt does one thing. Pass 2 detects; Pass 3 discovers; Pass 4 builds the object model; Pass 5 classifies against it. No pass attempts to do what a subsequent pass is designed to do.

**Closed enumerations:** All categorical fields use explicit enumerations listed in the system prompt. The model cannot invent new categories.

**Verbatim enforcement:** Fields named `exactText`, `verbatim`, or `definition` are explicitly instructed to copy the text character-for-character. The model is told that these fields will be verified against the source.

**Null over inference:** "A null is always correct; a wrong value is always harmful" is the controlling instruction on every prompt.

---

## Operational Constraints

### No-clobber guard

The orchestrator checks for existing requirements before running:

```typescript
const existing = await tx.requirement.count({
  where: { solicitationId, companyId, removedAt: null }
});
if (existing > 0) return { ok: false, error: 'Matrix already populated...' };
```

To re-run the pipeline, existing requirements must be deleted first. The UI "Clear" action handles this.

### AI provider

The pipeline uses the company's configured AI provider and model via `resolveCompanyAI()`. The `shred` capability key governs model selection. If no API key is configured, the pipeline fails with a user-facing error directing the user to Settings.

### Token consumption

A complete 10-pass pipeline run on a typical solicitation (8–15 pages) consumes approximately 200,000–400,000 tokens across all passes, depending on document size and prior output volume. Token usage is logged to `dara_ai_usage_log` after each pass under the `shred` capability.

### Worker deadline

The job worker tick runs for a bounded duration. If a pipeline run exceeds the deadline between passes, the current state is saved and the job returns an error. The user can re-run the pipeline from the beginning — partial data in the notes JSONB is overwritten on re-run.

---

## Adding or Modifying a Pass

To add a new pass or modify an existing one:

1. **Define the output interface** in `utils/dara/fsea/types.ts`. Add a `PNOutput` interface with all fields nullable/optional for forward compatibility.

2. **Write the system prompt** in `utils/dara/fsea/prompts/index.ts`. Follow the template: single responsibility, JSON-only output, closed enumerations, null over inference.

3. **Add the LLM call** in `orchestrator.ts` following the `runLlmPass<T>()` pattern. Determine the gate type (hard / retryable / graceful degrade) and implement the corresponding failure handling.

4. **Update `writeFseaResults()`** in `persist/write-results.ts` to include the new pass output in either the requirements write or the notes JSON.

5. **Update the UI** — add or modify the component that reads the new pass output. If the output belongs in the notes JSON, add the field to `FseaOutput` in `ComplianceSubTabs.tsx`.

6. **Update `writeFseaPartial()`** to include the new pass in partial saves.

---

## Known Limitations and Future Work

**Solicitation notes column as storage:** The full pipeline output is stored in `dara_solicitations.notes` as a JSON string. This column was not designed for this purpose. A future migration should add dedicated columns to `dara_requirements` (`proposalResponseObligation`, `paragraphId`, `evaluationCriterion`, `pageSignal`, `writingSequenceOrder`, `pageBudgetMin`, `pageBudgetMax`) and add new tables (`dara_eval_factors`, `dara_eval_criteria`, `dara_requirement_factor_links`, `dara_strength_opportunities`) to replace the JSONB storage pattern.

**Pipeline is not resumable:** If the worker deadline is exceeded mid-pipeline, the job re-runs from Pass 1. For long solicitations, this may require multiple worker ticks. A resumable pipeline would checkpoint after each pass and pick up where it left off.

**Context window pressure on Pass 10:** Pass 10 receives the outputs of all nine prior passes, which can approach the context limit for large solicitations. If Pass 10 consistently fails due to context overflow, the fix is to split it into two passes: one for Sections A and B, one for Sections C and D.

**User-provided intelligence:** Pass 10's proposal response obligations are generic — they are derived from the solicitation text alone. The quality of the writing brief improves significantly when the model also knows the offeror's specific capabilities and past performance. An offeror profile (confirmed SO status, contract history, credential register) fed into Pass 8 and Pass 10 would produce company-specific obligations rather than generic ones.

---

## Quick Reference — Progress Labels

| Pass | Progress % | Label shown in UI |
|---|---|---|
| 1 | 5% | Pass 1 — Assembling document package… |
| 2 | 12% | Pass 2 — Detecting requirement candidates… |
| 3 | 20% | Pass 3 — Parsing evaluation methodology… |
| 4 | 28% | Pass 4 — Building evaluation ontology… |
| 5 | 38% | Pass 5 — Classifying requirements… |
| 6 | 46% | Pass 6 — Determining page budget and actionability… |
| 7 | 54% | Pass 7 — Mapping Section L to evaluation criteria… |
| 8 | 62% | Pass 8 — Detecting strength opportunities… |
| 9 | 70% | Pass 9 — Resolving cross-references and citations… |
| 10 | 80% | Pass 10 — Generating evaluation matrix and writing plan… |
| Persist | 92% | Saving N requirements and N strength opportunities… |
| Complete | 100% | Pipeline complete — N requirements, N strength opportunities |

---

*Document version: July 2026 | ci-dara commit 8c706b4 | Crucible Insight / The Daniel Group LLC*
