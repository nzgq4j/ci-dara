# Next Steps — Span-Anchored Requirement Extraction (compliance-matrix redesign)

_Captured 2026-07-09. Status: **DESIGN, in revision — do not build yet.** This is the redesign the
shred pre-processor work is being held for (SESSION_HANDOFF §4 items 6 + the held pre-processor)._

## What this is

A ground-up redesign of the solicitation shred (`utils/dara/requirements.ts` `shredRequirements`) that
makes **a requirement's identity a verified character range in the source document** — `(documentId,
spanStart, spanEnd)` — instead of an LLM-generated name/description. Duplication and hallucination are
solved **structurally** (a partial unique index + a verbatim-verification gate) rather than by the
LLM-dedup heuristics (name/descSig, churn guard, `MAX_REQUIREMENTS`) that keep failing. Adds
**selective, user-initiated decomposition** of compound requirements (a container + child leaves +
optional residual), with document-enumeration (zero-token) and model-tiling (small call) paths.

This is a **different problem** from backlog item 6 (admin/format requirements over-escalated to
technical findings). This redesign improves matrix *identity/granularity*; it does **not** add the
`manual_verification` disposition item 6 asks for. Keep both on the roadmap.

## Delivery plan — a 6-prompt chain (each a separate Claude Code session, show-then-wait, run serially)

1. **Prompt 1 — schema + migration** (additive). New `documentId/spanStart/spanEnd`, `composition`
   enum + `obligationCount`/`enumeratorCount`, decomposition linkage (`parentId/childOrder/rollupMode/
   decompositionSource/decomposedAt/citationSynthesized`). **Partial unique index** on
   `(solicitation_id, document_id, span_start, span_end) WHERE span_start IS NOT NULL` (raw SQL only —
   Prisma can't model a partial unique index; do NOT add `@@unique`). Migration ts `20260709100000`.
2. **Prompt 2 — deterministic utilities** (`utils/dara/spans.ts` + tests): windowing, `verifySpan`
   (the hallucination gate), interval `mergeSpans`, `findEnumerators`, `classifyComposition`,
   `deriveCitation`, `clauseReference`, `computeResidual`. Pure functions, no DB/LLM.
3. **Prompt 3 — extraction pipeline** (`extract-prompt.ts` + rewrite `shredRequirements` +
   `passes.ts` dispatch). **HIGHEST RISK** — a prior pipeline change caused a prod stall + full revert.
4. **Prompt 4 — decomposition service** (`decompose.ts`): plan/commit/recompose + read-time rollup.
5. **Prompt 5 — exclusion predicate** (`requirement-filters.ts` `ACTIVE_REQUIREMENT` threaded through
   every Requirement query so containers never reach the matrix or the compliance sweep).
6. **Prompt 6 — compliance-matrix UI**: compound badge, decompose flow, nested children, rollup display.

**Deploy order:** apply the Prompt-1 migration BEFORE deploying Prompt 3. Prompts 1–2 are safe to deploy
independently; 3–6 deploy together.

## Verified against the code (assumptions that hold)

- `complete(provider, system, user, model, apiKey, maxTokens)` — signature matches (providers.ts:106).
  `completeWithGate` does **not** exist. `AI_TIMEOUT_MS = 240_000` per HTTP call (providers.ts:88).
- Worker is `/api/cron/passes`, `maxDuration = 300`, cron every minute (vercel.json). The solicitation
  **page** is `maxDuration = 800` but the shred runs on the **worker**, so the budget is 300s/tick.
- `documentId` genuinely absent from `Requirement`; `removedAt` is the amendment-struck mechanism
  (schema:538). Both design premises correct.
- Shred resumption hook: `passes.ts:761 done = shredRes.exhausted ?? true;` (Prompt 3 flips this).
- Extraction: PDF via unpdf `mergePages:true` (documents.ts:66), DOCX via mammoth `extractRawText`;
  `extractedText` is encrypted at rest (DARA-009), decrypted at read → the stored string round-trips
  exactly, so spans are stable against the decrypted text.

## REQUIRED FIXES before running (fold into the prompts — do NOT run Prompt 3 without #1 and #2)

### Critical

1. **Timeout / resumption (Prompt 3).** Removing the gap-pass loop also removes cross-tick resumption —
   45 sequential windows on a 200k-char doc blows the 300s worker budget. This is the sol-18/19 stall
   that caused the revert. Fix: **window-index resumption persisted in the JobQueue payload JSON** (no
   new columns) + **bounded parallelism (4 windows/round)**, budget-checked before each *round* with a
   worst-case headroom margin (existing shred reserves ~130s).
2. **Verbatim exact-match vs PDF artifacts (Prompt 2 `verifySpan`).** Models *reformat* quoted text;
   unpdf emits soft hyphens, mid-word breaks (`pro- vide`), ligatures, NBSP, doubled spaces, curly
   quotes/dashes. Exact `indexOf` → verify-fail → span **silently dropped** → matrix silently missing
   requirements (worse than duplicates). Fix: `normalize()` both sides, build a **normalizedIndex→rawIndex
   map**, match normalized, **return RAW offsets**. Downstream (`deriveCitation`/`computeResidual`/
   `decompose`) all slice raw text — a normalized offset stored as `spanStart` corrupts every slice.
3. **Resumption vs global `mergeSpans` (Prompt 3) — the deepest gap.** `mergeSpans` is a global,
   in-memory, *fuzzy* (0.6-overlap) dedup that collapses the near-duplicate spans window overlap creates
   at boundaries (window A `[4400,4700]`, window B `[4450,4720]` = same obligation). Cross-tick
   resumption discards that accumulator, and the unique index only catches **exact** `(start,end)`
   dups — so boundary straddlers get inserted **twice** and `skipDuplicates` won't save you. Fix:
   **accumulate verified spans in the JobQueue payload across ticks; run `mergeSpans` + `createMany`
   only when the last document's last window completes** (a few hundred spans ≈ 15KB JSON, fine).

### Important

4. **`createMany` needs `skipDuplicates: true`** in both `requirements.ts` and `decompose.ts` — else a
   re-run / regenerate-after-decompose re-extracts identical spans → `P2002` fails the whole batch. With
   it, re-extraction is the intended no-op. (`ON CONFLICT DO NOTHING` honors the partial index.)
5. **Restore `logUsage` per window (Prompt 3).** Match the existing signature
   `{ capability:'shred', provider, model, companyId, tokenIn, tokenOut, ok }` — **no `jobId`**; run
   attribution is ambient via the `withRunContext('job:<id>')` wrap already around `processReviewJobs`.
   (The prior draft dropped logging AND used a wrong `{capability,companyId,jobId}` shape.)
6. **Failed windows must be visible, not silent (Prompt 3).** Persist `failedWindows: number[]`; return
   `{ ok, count, failedWindows, missedChars }`; consider a bounded retry of transient failures on the
   next resume tick before reporting permanent loss.
7. **`parseTiling` must NOT force `splits[0] === 0` (fold-in, lands in Prompt 4).** As written, model
   tiling can never produce a residual — but PWS 5.10 (obligation + 2 enumerated, below the 3-enumerator
   threshold) needs one. Allow `splits[0] > 0`; region `[0, splits[0])` is the residual;
   `residualStandsAlone` sets the checkbox default. **Also update the reconstruction check** so
   children **+ residual** reconstruct the parent (else every residual-bearing tiling is rejected).
8. **`decomposed_at` = `timestamp(3)`, not `TIMESTAMPTZ`** (Prompt 1 migration) — every other timestamp
   in the schema is plain `DateTime` → `timestamp(3)`; `TIMESTAMPTZ` is drift.
9. **Prompt 5 grep is incomplete.** Its call-site search covers `findMany`/`count` but misses
   `findFirst`/`aggregate`/`updateMany`. Real sites it must consider: page.tsx:414/450/475 (single-id
   edit gates), amendments.ts:188/208, evaluator.ts:339/547, passes.ts:516. The compliance-sweep
   candidate at evaluator.ts:493 IS caught (has `removedAt:null`) — and it matters most, since a
   decomposed container keeps `disposition:'compliance'`/`complianceStatus:'not_assessed'` and would be
   graded without the predicate (INV-08).

### Open decisions (each has a cleaner third answer than the a/b framing)

- **`clauseReference` collapse rule (Prompt 2).** Keep the FAR/DFARS clause-*number* regex (legitimately
  arithmetic — numbering is mandated by FAR 52.104 / DFARS 252.104), but replace the arbitrary 400-char
  proxy with the **`obligationCount` the extraction call already returns**: collapse iff a clause number
  is present AND `obligationCount <= 1`; if `>= 2` it carries extra obligations (PWS 5.10), don't
  collapse. Semantically meaningful, no new call.
- **Path A residual honesty (fold-in, Prompt 4).** Instead of an extra call or "not evaluated," go
  deterministic: `recommendInclude:false` with an honest reason ONLY when the stem matches an
  introductory pattern (reuse `inferRollup`'s `ILLUSTRATIVE` match); otherwise mark "not evaluated."
  Zero extra calls, no dishonest reason string.

### Watch-areas / cheap wins

- **CUI governance:** the Prompt-2 test fixture must be a **public** SAM.gov RFP, never a tenant's
  uploaded doc — committing real extracted CUI text to git conflicts with the DARA-009 encrypt-at-rest
  posture. The offset-map test should include a **ligature (1→2)** and a **whitespace-run (N→1)** case,
  not just soft-hyphen + mid-word break.
- **Table-structured requirements** (Section L submission checklists, Section M factor grids) extract
  poorly as contiguous verbatim spans and may verify-fail/drop — known cost of verbatim identity, eyes
  open. This is the concrete shape of "requirements the model synthesizes from scattered text = rejected
  as hallucination" (an accepted trade).
- **Higher input-token cost:** windowed extraction re-sends overlapping input + a ~600-token system
  prompt ×N. Watch it on the pricing dashboard; whether it's cheaper than the old variable-pass shred is
  empirical — measure on the first real shred.
- **`displayText` (later prompt, not now):** since Prompt 2 builds `normalize()`, storing the normalized
  slice alongside the verbatim `description` is nearly free and keeps the matrix readable (no soft
  hyphens in the UI). Worth an explicit later prompt.

## Accepted losses (conscious trades — do not try to preserve)

- Model-generated descriptions → verbatim source slices (uglier, more faithful).
- Model-synthesized requirements consolidating scattered text (no single source span → rejected).
- Cross-tick recovery-by-accident (gap-pass re-read everything) → replaced by explicit, visible
  window resumption + `failedWindows` reporting.

## Immediate next action

Settle **Prompt 2** (offset-map contract + public fixture spec + ligature/whitespace tests) and
**Prompt 3** (payload-accumulated resumption + merge-at-end + bounded parallelism + `logUsage` +
`skipDuplicates` + `failedWindows`) — these two carry all the risk. Then revise Prompts 1, 4, 5, 6.
