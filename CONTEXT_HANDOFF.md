# DARA — Context Handoff

_Prepared 2026-07-01 (multi-pass session) · HEAD `d55ccdf` · branch `main` (clean, deployed)_

Start-here context for a fresh session. Deeper history: `BUILD_STATUS.md` (decisions,
completed, gaps, session log) and `SESSION_HANDOFF.md`. Security posture + findings:
`/app/security` and `utils/dara/security-content.ts`. Agent memory: `multi-pass-review.md`,
`color-team-reframing.md`.

> **Engine input update (2026-07-13, NOT yet deployed):** the HRLR shred (`utils/dara/requirements.ts`)
> now reads structured `ParseResult` output from the deployed Modal `dara-parser` service (pdfplumber +
> spaCy) when a current `dara_parse_results` row exists for a document, falling back to flat unpdf/mammoth
> text otherwise. Document uploads call Modal synchronously and persist a versioned parse row; the shred
> gains a structural pre-analysis preamble but the `hrlr` JSONB OUTPUT format is unchanged. A
> platform-admin-only parse-history viewer lives in the Documents panel. Deploy is pending (migration +
> RLS must be applied first). See `BUILD_STATUS.md` §-6 / `SESSION_HANDOFF.md` §0 (2026-07-13).

---

## 1. What DARA is (current product model)

A proposal-development tool for a small-business gov-contractor. It reviews the company's
**own** proposal against a solicitation via **color-team gate reviews** (Pink/Red/Gold/White
Glove). It is **not** source-selection (no scoring of competitors). The underlying
methodology is **never named** in UI/prompts/code/docs — use "color team review", the gate
names, "review gate".

**A solicitation → one or more color-team reviews.** The workspace is a **9-stage pipeline**
(a *suggestion*, every stage clickable/skippable):

`Solicitation · Compliance · Kickoff · Pink · Red · Gold · White Glove · Compliance · Submit`

- **Prod:** https://dara.crucibleinsight.com · **Vercel:** `crucible-insight/ci-dara`
- **Stack:** Next.js 14.2.35 (App Router) · Prisma 7 (pg driver adapter) · Supabase
  (Postgres + Auth + Storage) · Stripe · Vercel (Fluid Compute).

---

## 2. ⭐ The review model (current — multi-pass)

**A color-team review now runs a 3-pass async AI review** (imported `DARA.dc.html` design,
built this session). Each pass is a fixed lens producing a 0-100 score + severity-ranked
findings (severity · finding · requirement ref · recommended action):

1. **Pass 1 — Compliance & Format** (structure, volume/page limits, forms, formatting)
2. **Pass 2 — Technical Responsiveness** (approach vs PWS reqs + Section M subfactors)
3. **Pass 3 — Risk & Competitive** (programmatic risks, competitive gaps, strengthen areas)

Passes run **sequentially, async** (JobQueue + cron worker); the UI polls per-pass status
(queued → running → complete/error) with per-pass Re-run/Retry + Run/Re-run all. This is
**layered onto** color teams — each `Review` has 3 passes. The **old per-persona holistic
`runEvaluation`/`Result` path is preserved but no longer the primary output** (shown collapsed
under "Earlier per-reviewer findings"); the Run button now enqueues passes, not per-persona
evals.

**The compliance matrix** is governed by `Requirement.disposition` (**scored** / **compliance**
/ **administrative**), auto-classified by the AI shred. `disposition=compliance` rows get the
lean pass/fail sweep (`runComplianceCheck`); `administrative` rows are N/A and skipped;
`scored` ⇔ `isScored=true`. "Sync from AI review" folds the latest **Pass 1** findings into the
matrix.

---

## 3. Solicitation page architecture (`app/app/solicitations/[id]/page.tsx`)

One big server component; `PipelineStepper` (client) maps stages to views:

| Stage | View | Content |
|-------|------|---------|
| 1 Solicitation | `documents` | RFP + proposal-draft uploads (`SolDocument.docType`) |
| 2 & 8 Compliance | `compliance` | Matrix (dense inline-edit table) + Generate/Run-check/**Sync**/**Export** |
| 3 Kickoff | `overview` | Details, departments, danger zone |
| 4–7 Pink/Red/Gold/White | `pink`/… | `colorStage(color)` — reviews + **3 pass cards** inline |
| 9 Submit | `review` | Scorecard + legacy holistic findings |
| tool | `amendments` | Amendment log + reconcile |

**Key components (`components/dara/`):**
- `PipelineStepper` · `AddSection` (create-in-**modal**; closes on submit — capture-phase
  listener) · `AiActionButton` · `CuiBoundaryModal` · `RequirementDetail` (portal modal) ·
  `PrintButton`.
- **`ReviewPassPanel`** — the 3 pass cards; live polling (router.refresh every 3s while
  queued/running); Run/Re-run all + per-pass Re-run/Retry.
- **`MatrixExport`** — CSV / Word download buttons (Blob).
- `ResultCard`/`ReviewSummary`/… — legacy holistic finding rendering (collapsed).

**Compliance matrix table columns:** Status · Requirement (name + citation + detail) · Source
· **Type** (disposition select) · **Response loc.** (proposalRef) · **Notes** · Save · Delete.

---

## 4. Engine (`utils/dara/`)

- **`passes.ts`** (multi-pass review): `ensurePasses`, `runPass` (one lens, LLM outside
  tenant tx), `runReviewPasses` (sequential, resumable), `enqueueReviewRun`/`enqueuePassRun`
  (JobQueue), `processReviewJobs` (worker — claims jobs via `prismaAdmin`, runs under the
  job's tenant, requeues on deadline), `triggerWorker()` (fire-and-forget kick),
  `syncMatrixFromPasses` (fold Pass-1 findings → matrix, no LLM).
- **`requirements.ts` `shredRequirements`** — **HRLR shred (2026-07-10)**: one whole-document call
  reconstructs a typed requirement **graph** (`utils/dara/hrlr/*`) → `Requirement` rows with
  parent/child links + `hrlr` JSONB. One-shot (no gap-pass loop), no-ops into a non-empty matrix,
  containers inserted `not_applicable` (kept out of the sweep). See memory `hrlr-shred.md`. (The old
  multi-pass `buildShredGapPrompt`/`SHRED_MAX_TOKENS` flow is gone; `shred-prompt.ts` is orphaned.)
- **`evaluator.ts`** — legacy holistic `runEvaluation` (scored factors) still present;
  `runComplianceSweep`/`runComplianceCheck` (lean pass/fail over `disposition=compliance`).
- **`amendments.ts`** — `reconcileAmendment` (AI diff + **1 coverage pass**,
  `buildAmendmentGapPrompt`), `applyAmendmentChange`. `DIFF_MAX_TOKENS = 16000`.
- **`prompt.ts`** — all prompt builders + tolerant salvage parsers. `PASS_LENS` /
  `buildPassPrompt` / `parsePassResult`; `buildAmendmentDiffPrompt`/`buildAmendmentGapPrompt`. (Shred
  prompting now lives in `utils/dara/hrlr/prompt.ts`, not `buildShredPrompt`.)
- **`providers.ts`** — `complete()` clamps output tokens per provider.
- **Worker route** `app/api/cron/passes/route.ts` + **`vercel.json` cron** (every minute).

---

## 5. ⚠️ Gotchas (read before debugging)

- **`after()` is NOT available in Next 14.2.35.** Immediate worker start uses a
  fire-and-forget `fetch` to `/api/cron/passes` (`triggerWorker`); the **cron every minute**
  is the guaranteed backstop. `CRON_SECRET` optional (route allows if unset — set it in Vercel
  to lock the worker down).
- **Vercel deploy-skew traps open tabs** — always hard-refresh (Ctrl+Shift+R) after deploy.
- **`AddSection` closes on submit** (capture-phase `submit` listener — submit doesn't bubble,
  capture reaches it) so the server action's re-render never reconciles the open portal modal
  (that combo threw a client-side exception). `createReview` **revalidates, no redirect**.
- **Never `toLocaleDateString()` in SSR render** — use deterministic `fmtDate` (UTC).
- **AI JSON truncation** — raise the relevant `*_MAX_TOKENS`; salvage parsers recover items.
- **Deploy order for schema changes:** `pnpm prisma migrate deploy` (owner) → apply-sql new
  RLS → `vercel deploy` → push. New `dara_*` tables are RLS-fail-closed until granted;
  column-only adds (disposition, notes) need only `migrate deploy`.
- **Requirement disposition drives the sweep** — `runComplianceSweep`/`runComplianceCheck`
  target `disposition=compliance` only. Mark Section M factors **Scored** so they're
  classified right (the shred usually does this).

---

## 6. This session's arc (2026-07-01 multi-pass session, most recent first)

`d55ccdf` multi-pass shred + amendment **coverage passes** — `2070c6c` dashboard P1/P2/P3
badges + Avg Score — `20d05b6` compliance **"Sync from AI review"** — `4b0d4c1` matrix **Notes
+ Response Location + CSV/Word export** — `da370ed` **multi-pass AI review** (3 passes, async
JobQueue + cron worker, `ReviewPassPanel`) — `5c1bf8b` create-review crash + modal-close fix —
`f20b77e` modal centering (portal) — `c895da8` requirement **disposition** auto-classification
(scored/compliance/administrative) + shred exclusions + RequirementVersion `@map` fix.

Migrations added: `20260701050000_requirement_disposition`, `20260701060000_review_passes`
(+ RLS `2026-07-01_review_passes_rls.sql`), `20260701070000_requirement_notes`.

**Verified in prod by the user:** a full multi-pass review run (passes queued→running→complete
with scores + findings).

---

## 7. Queue / open items

**★ Top of queue — Full navy/gold reskin (design's visual system).** The imported
`DARA.dc.html` uses navy `#1B2A4A` / gold `#B8952A` / Inter, **light** theme, new top-nav —
different from the current IBM Plex dark theme. Explicitly deferred; the big one (every page).
Do it deliberately: adopt tokens first, convert page-by-page. Ref HTML at
`…/scratchpad/DARA_design.html`.

**Operator actions (browser/CLI):** (a) set the platform model to **Sonnet** (Application Admin
→ Platform AI) — now matters more (3 review passes + shred/amendment coverage passes all use
it); (b) optional `CRON_SECRET` in Vercel (all envs) to lock the worker route; (c) branch
protection on `main` (BUILD_STATUS #13); (d) Supabase Auth Site URL + Confirm-email ON (#1).

**Product backlog:** per-company audit-log viewer; AI codebase security-audit; billing polish;
async job processing is now real (JobQueue + cron) — could migrate the legacy shred/sweep to it
too if they start hitting the sync budget.

---

## 8. Fast restart

```bash
git status                 # expect clean main, HEAD d55ccdf
git log --oneline -10
pnpm install               # if needed
pnpm exec tsc --noEmit
pnpm build
# schema change? DB BEFORE deploy:
#   pnpm prisma migrate deploy
#   npx tsx prisma/security/apply-sql.ts prisma/security/<new>_rls.sql   # only if new table
# deploy: vercel deploy --prod --yes  then  git push  then HARD-REFRESH the browser
```
