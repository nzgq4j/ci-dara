# DARA — Context Handoff

_Prepared 2026-07-01 · HEAD `c775f5f` · branch `main` (clean, deployed)_

Start-here context for a fresh session. Deeper history: `BUILD_STATUS.md` (decisions,
completed, gaps, session log) and `SESSION_HANDOFF.md`. Security posture + findings:
`/app/security` and `utils/dara/security-content.ts`.

---

## 1. What DARA is (current product model)

A proposal-development tool for a small-business gov-contractor. It reviews the
company's **own** proposal against a solicitation via **color-team gate reviews**
(Pink/Red/Gold/White Glove…). It is **not** source-selection (no scoring of competitors).
The underlying methodology is **never named** in UI/prompts/code/docs — use "color team
review", the gate names, "review gate".

**A solicitation → one or more color-team reviews.** The workspace is a **9-stage
pipeline** (a *suggestion*, not a hard workflow — every stage is clickable/skippable):

`Solicitation · Compliance · Kickoff · Pink · Red · Gold · White Glove · Compliance · Submit`

- **Prod:** https://dara.crucibleinsight.com · **Vercel:** `crucible-insight/ci-dara`
- **Stack:** Next.js 14.2.35 (App Router) · Prisma 7 (pg driver adapter) · Supabase
  (Postgres + Auth + Storage) · Stripe · Vercel (Fluid Compute).

---

## 2. ⭐ THE core principle (do not regress)

**A review is a HOLISTIC evaluation, not a per-requirement checklist.** A review run does
two distinct things (commit `8125fd1`):

1. **Holistic review** — for each **evaluation factor** (`Requirement.isScored = true`,
   the few Section M factors), each chosen persona writes the full structured assessment
   (review summary incl. *what it was measured against* + how scored, rationale, strengths,
   weaknesses, compliance commentary, suggested improvements, score/rating) — the rich
   `buildUserPrompt`/`parseResult` path. `runEvaluation`, scoped to `isScored`, factors
   run **concurrently** (pool of `FACTOR_CONCURRENCY = 5`).
2. **Compliance matrix sweep** — for the **administrative/pass-fail** requirements
   (`isScored = false`, the bulk), a lean Go/No-Go determination sets each
   `complianceStatus` (+ `proposalRef`). `runComplianceSweep` (bundled into a run) and
   `runComplianceCheck` (standalone, Compliance stage).

`isScored=true` → holistic review; `isScored=false` → compliance matrix. **DO NOT** turn
the review back into a lean per-requirement determination grind over all requirements —
that was the explicitly-corrected "compliance-heavy" wrong turn (`3e410a2`, superseded).

---

## 3. Solicitation page architecture (`app/app/solicitations/[id]/page.tsx`)

One big server component. The tab bar was replaced by `PipelineStepper` (client). Stages
map to **views**; several stages can share a view (both Compliance stages → `compliance`):

| Stage | View | Content |
|-------|------|---------|
| 1 Solicitation | `documents` | RFP + proposal-draft uploads (`SolDocument.docType` rfp/proposal/amendment) |
| 2 & 8 Compliance | `compliance` | Compliance matrix (dense table) + Generate/Run-check |
| 3 Kickoff | `overview` | Details, departments, danger zone (compact 2-col) |
| 4–7 Pink/Red/Gold/White | `pink`/`red`/`gold`/`white` | `colorStage(color)` — color-scoped reviews + **holistic findings inline** |
| 9 Submit | `review` | Scorecard (reviews × scored factors) + all holistic findings |
| tool | `amendments` | Amendment log table + reconcile flow |

**Key components (`components/dara/`):**
- `PipelineStepper` — the stepper + tool chips + mounts all views (active shown). Nav
  marked `.no-print`.
- `AddSection` — "+ Add" button that opens the create form in a **modal** (never an inline
  blank card). Used for new review / amendment / requirement.
- `RunPanel` — per-review run button + progress bar + resumable "Assessed X/Y" notice.
- `RunningBanner` — page-top **live** progress: polls (2.5s) while an eval is `running`,
  shows the factor being reviewed + X/Y + determinate bar.
- `ProgressBar` — determinate or indeterminate sweep (CSS `progress-indeterminate`).
- `AiActionButton` — client wrapper for shred/compliance/reconcile; descriptive pending
  label + progress bar + result notice.
- `CuiBoundaryModal` — DARA-007 CUI notice as a modal, **permanently dismissible**
  (localStorage `dara-cui-ack-v1`), re-openable via a header chip.
- `RequirementDetail` — clickable **abridged description** → modal with full requirement.
- `PrintButton` — `window.print()`; print CSS in `styles/main.css` drops app chrome.
- `ResultCard` / `ReviewSummary` / `RationaleBlock` / `ResultFindings` — holistic finding
  rendering (per factor, per persona), with Regenerate + Archive.

**Compliance matrix table:** dense grid where each row is a `<form className="contents">`
(display:contents) so inline editing (status/name/source/scored/proposal-ref) aligns to
the grid columns; a sibling delete form. Columns: Status · Requirement (name + citation +
clickable detail) · Source · Scored · Proposal ref · Save · Delete.

---

## 4. Engine (`utils/dara/`)

- **`requirements.ts` `shredRequirements`** — AI-shred the **RFP docs only** into
  `Requirement` rows. Captures `citation` (where cited in the solicitation). **Dedupes by
  name** so re-running doesn't duplicate. `SHRED_MAX_TOKENS = 16000`.
- **`evaluator.ts`:**
  - `runEvaluation(evalId, companyId, deadlineMs)` — holistic rich assessment of the
    scored factors (concurrency 5), `EVAL_MAX_TOKENS = 5000`, time-boxed + resumable
    (skips factors that already have a Result). Sets eval `complete`/`pending`.
  - `runComplianceSweep(reviewId, …)` / `runComplianceCheck(solId, …)` — lean batched
    pass/fail over non-scored requirements → `complianceStatus` + `proposalRef`.
    `BATCH_SIZE_COMPLIANCE = 40`.
  - `regenerateResult`, `setResultArchived`.
- **`amendments.ts`** — `reconcileAmendment` (AI diff amendment vs matrix → proposed
  add/modify/remove), `applyAmendmentChange` (fold into matrix; modify → version into
  `dara_requirement_versions`; remove → `removed_at`). `DIFF_MAX_TOKENS = 16000`.
- **`prompt.ts`** — all prompt builders + tolerant parsers with **salvage**
  (`extractArrayObjects` recovers complete items from truncated JSON arrays).
- **`providers.ts`** — `complete()` clamps output tokens per provider (Google 8192 /
  OpenAI 16384 / Anthropic high).
- **`runReviewAction`** (in page) — per persona: find/create eval → `runEvaluation`, then
  one `runComplianceSweep`. `maxDuration = 800`, deadline `Date.now()+760_000`.

---

## 5. ⚠️ Gotchas (read before debugging)

- **Vercel deploy-skew traps open tabs.** After every `vercel --prod`, an already-open tab
  keeps running the OLD deployment (its server actions POST back to it) until a **hard
  refresh** (Ctrl+Shift+R). This caused ~half the "the fix didn't work" reports this
  session. Always hard-refresh after deploying before re-testing.
- **`maxDuration = 800` needs Fluid Compute** (default on Pro). If capped lower, big runs
  still mostly finish (concurrency + smaller tokens) and otherwise resume.
- **Never `toLocaleDateString()` in SSR render** — UTC-midnight dates shift a day / differ
  by locale → hydration crash ("Application error: a client-side exception"). Use the
  deterministic `fmtDate` (UTC `YYYY-MM-DD`).
- **AI JSON truncation** — raise the relevant `*_MAX_TOKENS`; the salvage parsers recover
  complete items regardless.
- **Server-action re-render can throw client-side** even when the write succeeds; heavy
  create forms use a **redirect** (fresh navigation) to sidestep it (`createReview`), plus
  a 120s duplicate guard.
- **Deploy order for schema changes:** `pnpm prisma migrate deploy` (owner) → apply-sql any
  new RLS file → `vercel deploy` → push. New `dara_*` tables are RLS-fail-closed until
  granted. Column-only adds (like `citation`) need only `migrate deploy`.
- Reviews run before the holistic restore (`8125fd1`) hold stale lean rows for all
  requirements — delete + recreate the review (or use a fresh solicitation) to see clean
  holistic behavior. Mark Section M items **Scored** so they get the holistic treatment.

---

## 6. This session's arc (2026-07-01, most recent first)

`c775f5f` parallel factors + 800s (one-round runs) · compact stepper · clickable req
detail · add-via-modal — `5137890` shred dedupe · requirement citation (migration
`20260701040000`) · compliance sweep fills proposal-ref · requirement modal · print
buttons · denser cards — `f790812` compliance→table · amendment log · add-buttons · compact
kickoff — `fd6688e` CUI modal + live progress — `9b08235` pipeline stepper + per-color stage
workspaces — `599243b` progress bars + compliance/scorecard split — `8125fd1` **holistic
review restored** — `d57eaa9` duplicate-review guard + redirect — `f60017b` amendment-diff
recall — `f1155b3` UTC-date crash + shred truncation fixes — `aa46956`/`9a4e944`/`d1836dc`
color-team reframing Phases 3/2/1.

---

## 7. Queue / open items

**Next design polish (optional):** the design's per-stage "AI Review Engine" sidebar,
"Analysis Log" feed, and "Accept Findings & Advance" gate were not built (mapped stages to
functional panels instead). The design also had a multi-volume compliance matrix
(Technical/Management/Price/Past-Perf columns); we use a single `proposalRef` — a real
per-volume coverage matrix would be a small schema add.

**Robustness:** true zero-click any-size runs = **async JobQueue + Vercel Cron worker**
(table exists, unused). The synchronous parallel+resumable path is the interim.

**Verify in prod (fresh data):** a full review run (rich per-factor findings in the color
stage + Submit scorecard) + compliance check (statuses + proposal-ref); the amendment
reconcile against a populated matrix.

**Operator actions (browser/CLI):** (a) branch protection on `main` (BUILD_STATUS #13);
(b) Supabase Auth Site URL + Confirm-email ON (#1); (c) move platform Anthropic key into
the console + set platform model to **Sonnet** for review/reconcile quality (#14).

**Product backlog:** per-company audit-log viewer; AI codebase security-audit; Reporting
phase 2 (weighted matrix + PDF/CSV export); billing polish.

---

## 8. Fast restart

```bash
git status                 # expect clean main, HEAD c775f5f
git log --oneline -8
pnpm install               # if needed
pnpm exec tsc --noEmit
pnpm build
# schema change? DB BEFORE deploy:
#   pnpm prisma migrate deploy
#   npx tsx prisma/security/apply-sql.ts prisma/security/<new>_rls.sql   # only if new table
# deploy: vercel deploy --prod --yes  then  git push  then HARD-REFRESH the browser
```
