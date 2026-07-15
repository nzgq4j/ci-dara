# CLAUDE.md — DARA (ci-dara) project instructions

Start-here context lives in `CONTEXT_HANDOFF.md`; the decision/session log is `BUILD_STATUS.md`;
the fast-restart doc is `SESSION_HANDOFF.md`.

## Compliance-matrix shred — two pipelines, current state (read before touching the shred)

`shredRequirements` (`utils/dara/requirements.ts`) dispatches between TWO extraction pipelines:

1. **Multipass (default when EVERY rfp doc has a current `dara_parse_results` row).** Deterministic,
   spaCy-first: the Modal parser flags every modal-verb sentence; the app SELECTS those candidates,
   runs ONE temperature=0 LLM call that only CLASSIFIES them (it cannot add rows), verifies text by
   string match, annotates conditionals, and traverses FAR/DFARS citations against the local clause
   library. Code in `utils/dara/extraction/*`. Memory: `multipass-extraction.md`.
2. **Legacy HRLR (fallback when NO doc has a parse row).** Whole-document LLM call that reconstructs a
   curated requirement graph. Code in `utils/dara/hrlr/*`. Memory: `hrlr-shred.md`.

**HONEST STATUS (2026-07-13): the multipass pipeline is NOISIER than HRLR on real solicitations.** The
first real run (CHIPS IV) produced **838 rows** vs HRLR's ~100–280, because multipass extracts every
"shall" sentence exhaustively. Evaluation of that CSV found (and these fixes target):
- **177 rows (21%) were junk "Conditional obligation (IF/WHEN/…)" rows** — Pass 2 was spawning a new
  requirement per unmatched conditional trigger. FIX (uncommitted): Pass 2 annotates existing
  requirements only, never spawns rows.
- **212 rows flagged, ~half falsely** — `subject_inferred` (passive voice, very common) was pushed into
  `flags`, and any flag forces Review=`flagged`. FIX: `subject_inferred`/dedup-merge are informational
  hrlr fields now, NOT in `flags`; `flagged` = genuine LOW confidence only.
- **769/838 rows had empty citations** — citation = section path, which is empty for PDFs (no parsed
  sections). FIX: fallback to a leading outline number → clause number → page marker.
- **Clause-text dumps** (one row 109,778 chars) — Pass 3 stored a whole FAR clause as the detail. FIX:
  truncate to 2,000 chars; full text stays in `dara_clause_versions`.

**Remaining KNOWN limitations (not yet addressed — do not claim they are):**
- **Section M is nearly invisible to multipass** (CHIPS IV: 2 rows). Evaluation factors rarely contain
  modal verbs, so spaCy never flags them as candidates. This is STRUCTURAL to the spaCy-first approach.
- **235 FAR/DFARS boilerplate rows** (the "clauses incorporated by reference" list) still extract as
  individual requirements.
- **~12% of rows carry mojibake (`�`)** from pdfplumber CID-font decoding — a Modal parse issue.
- **Duplicates** appear when docs were parsed BEFORE the Modal dedup redeploy (no
  `deduplicated_candidates`); re-parsing fixes it.

**If the multipass output is unacceptable for a real matrix, the fastest path to HRLR-quality is to make
HRLR the default again and gate multipass behind opt-in** — this was offered and NOT chosen (user chose
to fix multipass defects instead, 2026-07-13). Do not silently switch pipelines.

## Document-role classification & parse gating (DEPLOYED 2026-07-14 — where we are)

Uploaded solicitation documents are now classified by ROLE so only real solicitation documents feed the
extraction pipeline (Modal parse + shred); supporting material is stored but skipped. Memory:
`document-role-classification.md`. Live on prod (commit `a19ae1a`, migration `20260714120000_document_role`,
`dpl_4Z3yKbN8zWkN3JXn3zQy3csZaFFP`) — **not yet exercised in a browser.**

- **`SolDocument.documentRole`** (`DocumentRole?` enum, 10 values: `rfp_base` · `pws_sow` · `cdrl` ·
  `section_j_attachment` · `amendment` = **extracted**; `wage_determination` · `past_performance_template`
  · `questionnaire` · `market_research` · `other_supporting` = **stored-only**). Null = legacy/unclassified
  (treated as extracted). `documentRoleSuggested` (bool) = AI-assigned, human not yet confirmed. Split +
  helpers in `utils/dara/document-roles.ts` (`isExtractedRole`/`roleBadge`/…).
- **Classifier = CONTENT-based, server-side** (`utils/dara/classify-document.ts` `classifyDocumentRole`):
  an LLM reads a ~6k-char text sample and returns the role. Adapts to ANY document — **a filename-regex
  heuristic was built then REJECTED by the user (2026-07-14) as overfit; do NOT reintroduce filename rules.**
  New `document_classify` AICapability (usage-logged, per-capability model override). Fail-open (null →
  unclassified). Runs at upload because content only exists after upload.
- **Parse gating:** upload actions (`uploadDocToSol` in `new/page.tsx`, `uploadSolDoc` in `[id]/page.tsx`)
  ALWAYS extract text now (needed to classify), then a **stored-only** role sets
  `extractionStatus='skipped'` (new enum value) + skips `parseAndPersist` (Modal). The shred already filters
  `docType==='rfp' && extractionStatus==='complete'`, so `skipped` docs are auto-excluded. Text is retained
  even for stored-only so a later override is a clean status flip.
- **UI:** multi-file parallel uploader with an optional **"Auto-detect"** role default
  (`RoleStagingList` + `SolDocRoleUploader`, workspace RFP panel + create wizard). Confirm/override the
  AI role in the doc list via `DocRoleSelect` (gold "Suggested" chip + Confirm ✓) → `setDocumentRole`
  server action (BOLA-safe; re-gates status skipped↔complete). Proposal/amendment uploaders unchanged.

## Python / Modal CLI

The project's Python virtual environment is at `.venv` (Python 3.12, gitignored). The **Modal CLI is
installed in this venv**. Run any Python or `modal` command with the environment active:

```powershell
.venv\Scripts\Activate.ps1   # PowerShell, then:
modal <command>
```

or, without activating:

```powershell
python -m modal <command>
```

Use the **PowerShell tool** for Modal commands — the Bash tool runs Git Bash and will not pick up
`Activate.ps1`. Never commit `.venv/`.

The deployed structural parser source is `modal/app.py` (`dara-parser`, workspace `islanista`). **Do not
modify `modal/app.py`** unless a confirmed bug is found. See memory `modal-parser-integration.md`.

**`modal deploy` cannot run from Claude Code's sandbox** — the gRPC connection to `api.modal.com` cannot be
completed here (TCP:443 opens but the HTTP/2/gRPC channel is refused), regardless of auth. This is a network
constraint, not a code/credentials problem; do NOT keep retrying it in-session. A Modal redeploy is only needed
when `modal/app.py` changes — after such a session the OWNER runs, from a local PowerShell with `.venv` active:
`python -m modal deploy modal\app.py`. All other changes (Next.js, Prisma, HRLR) deploy via `vercel deploy
--prod --yes` as normal.

## Stack & conventions

- Next.js 14.2.35 (App Router, TypeScript) · Prisma 7 (`@prisma/adapter-pg`) · Supabase (Postgres + Auth +
  Storage) · Stripe · Vercel Pro (Fluid Compute, ~800s function limit).
- `after()` is **not** available in Next 14.2.35 — never use it.
- `toLocaleDateString()` is banned in SSR (hydration-unsafe) — use the UTC-deterministic `fmtDate`/`fmtDateTime`.
- Validate with `npx tsc --noEmit` and `pnpm build` (= `prisma generate && next build`; runs ESLint + TS).
- Package manager: `pnpm`.

## Database & security

- **Migrations only** — `pnpm prisma migrate deploy`. Never `pnpm prisma db push`.
- Every new `dara_*` table is RLS-fail-closed until granted and ships with a paired
  `prisma/security/*.sql` applied via `npx tsx prisma/security/apply-sql.ts <file>`.
- Tenant writes/reads go through `withTenant(companyId, …)` (sets the `app.company_id` GUC for RLS);
  cross-tenant/platform-admin paths use `prismaAdmin` and must justify themselves.
- **Deploy order:** `pnpm prisma migrate deploy` (owner) → apply RLS SQL → `vercel deploy --prod --yes` →
  `git push`. GitHub→Vercel auto-deploy is broken; deploy manually. Commit/push/deploy only when asked.

## Verified data-model facts (compliance matrix / HRLR)

Pasted prompts sometimes assert "confirmed facts" that are wrong — **always verify against the schema/DB
before building on them.** Ground truth as of 2026-07-13 (`dara_requirements`):

- **`source` enum** = `instruction` · `evaluation_factor` · `sow_pws` · `far_clause` · `other`.
  **Section L = `source='instruction'`**, **Section M = `source='evaluation_factor'`**. ("Section L
  instruction"/"M factor" are display labels via `SOURCE_LABEL`, NOT DB values.)
- **`disposition` enum** = `scored` · `compliance` · `administrative`. `complianceStatus` enum =
  `not_assessed` · `compliant` · `partial` · `non_compliant` · `not_applicable`.
- **`Requirement.reviewStatus`** (enum `RequirementReviewStatus` = `pending`·`approved`·`rejected`·`flagged`,
  added 2026-07-13) is the per-requirement **parse-QA** status, set by the shred `deriveReviewStatus`:
  `flagged` when unverified/flagged/fragmented/LOW-confidence, **`approved` otherwise** (a leftover `pending`
  row means the shred never classified it — pre-fix or manually added — NOT that a human reviewed it). Advanced
  by a reviewer in the matrix detail modal. DISTINCT from `complianceStatus` (proposal coverage) and from the
  color-team **`Review`** table's `ReviewStatus` enum. Also new: `Requirement.governingFactors` (`text[]`) =
  Section M factor markers each Section L instruction / SOW task is evaluated under (L→M link, from the shred).
- **Soft-hyphen (U+00AD) verbatim false positives:** pdfplumber preserves the hyphenation soft-hyphen at a
  line break (`com<shy>\npliance`); the LLM emits the joined `compliance`, so verbatim verification mismatches.
  Fixed by REJOINING at the source: `clean_extracted_text` in `modal/app.py` (strips `<shy>` + a following
  linebreak) AND `cleanSourceText` in `requirements.ts` (same, for the flat/existing-parse path). Do NOT "fix"
  this in `hrlr/parse.ts` — a bare strip leaves the newline → `com pliance` and still mismatches.
- **`hrlr` JSONB** (flattened at persist time in `requirements.ts`) carries: `verbatimVerified` (bool),
  `confidence` (HIGH/MEDIUM/LOW), `flags` (string[]), `state`, `syntheticPath`, `sectionPath`,
  `normalizedMeaning`, `satisfaction`, `applicability`, and **`evalScope`**. `evalScope` is a STRUCTURAL enum
  (`SELF`/`EACH_CHILD`/`PARENT_COLLECTIVE`/`AGGREGATE_SET`/`UNRESOLVED`) — it does NOT cross-reference other
  requirements/Section M.
- All requirement ids and `companyId` are **BigInt**; `createdBy`/`uploadedBy` are `@db.Uuid`.
- D5 FIXED (2026-07-13): the Modal `candidate_id` leak into `citation` (`cand-sent-para-p1-1`) is closed —
  `hrlr/prompt.ts` now tells the model those bracket handles are internal IDs, and `requirements.ts` rejects
  any `cand-`/`trigger-`/`t\d+` marker at persist (`PARSER_HANDLE`). Existing polluted rows clear on regenerate.

## Do not modify

`modal/app.py`; the HRLR core `utils/dara/hrlr/{types,parse,resolve,run}.ts`; the `hrlr` JSONB output
format on `dara_requirements`. (Individual sessions may explicitly lift one of these — e.g. a Modal PDF-cleaning
task authorizes editing `modal/app.py`. Follow the current session's stated scope.)
