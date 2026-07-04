# DARA — Session Handoff

_Prepared: 2026-07-05 · HEAD `5d491ea` · branch `main` (clean, **deployed to prod**) · for: next session_

Start-here doc. Everything below is **live on production** (`dara.crucibleinsight.com`) unless
flagged otherwise. Agent memory (authoritative, load first): `direct-ai-review-mode.md`,
`ui-redesign-roadmap.md`, `create-flow-body-size.md`, `color-team-reframing.md`,
`multi-pass-review.md`. Deep decision log: `BUILD_STATUS.md`.

---

## 1. Deploy model (READ FIRST)

- **Prod = `main`, deployed MANUALLY.** Auto-deploy is OFF. The flow, every time:
  `git push origin main` → `vercel deploy --prod --yes`. `main` is always kept == prod.
- **Vercel CLI IS installed** (session-start "not installed" note is stale). `.vercel/` linked:
  project `prj_I6CLDhGJlbjro2Mc67i1AyyHpciP`, team `team_hluvXIDuWYVTRTyXnqxTbfWg`.
- **Schema changes: migrate BEFORE the code deploy.** `pnpm prisma migrate deploy` (owner /
  `DIRECT_URL`, via `prisma.config.ts`) → if a NEW table, apply its RLS via
  `npx tsx prisma/security/apply-sql.ts <file>` → then `vercel deploy --prod`. Column-only adds
  need just `migrate deploy`. **21 migrations applied to prod** (latest `20260704020000_analysis_report`).
- **`.env.local` points at the REMOTE (prod) Supabase.** No local DB. `withTenant` interactive
  transactions can throw **P2028 from this dev machine** (pooler latency) — so verify tenant DB
  flows on prod, or with a throwaway `pg`/owner (`DIRECT_URL`) script (non-interactive queries
  work; that's how everything below was verified). `.env.local` also has the Stripe secret key.
- **Preview caveat:** the every-minute Vercel **cron only runs on prod**, and prod runs whatever
  code is currently deployed — a review/shred kicked off on a preview is processed by prod's code.
  Verify job *completion* on prod.

---

## 2. What shipped this session (2026-07-04 → 07-05, all on prod, all verified)

Commits `f087ac3` → `5d491ea`. In order:

1. **Create-flow reliability** (`f087ac3`) — Direct AI create POSTed *all* files in one
   server-action request; Vercel caps a Function body at **~4.5 MB** (overrides
   `serverActions.bodySizeLimit`), and the pooler intermittently throws P1001/P2028 — both
   silently killed the create. Split `createAndRunReview` → `createSolShell` + `uploadDocToSol`
   (one file per request) + `finalizeReview`; added `withDbRetry`; surfaced real errors + logs.
   See memory `create-flow-body-size.md`. **Verified:** sol#12 created from the failing payload.
2. **Workspace poll storm** (`9be19c5`) — 5 components each `setInterval(router.refresh,3000)`;
   a backgrounded tab refreshed the heavy sol query forever. New `components/dara/usePollRefresh.ts`
   polls only while the tab is visible. Fixes the `?_rsc=` loop + contention.
3. **Solicitation Analysis Report** (`a7c142a`) — new `/app/solicitations/[id]/report`
   (4th mockup; all redesigns now shipped). Exec summary + editable Prioritized Findings & Action
   Plan (owner/status/effort) + right rail (deadline, distribution, DARA recommendation + submit
   date, checklist). Migration `20260704020000` (Finding `status/ownerRole/ownerName/effortBand/
   effortEstimate`; DirectReview+Review `recommendation/recommendedSubmitAt/checklist`). AI emits
   owner/effort per finding + holistic recommendation/checklist (Direct review + final Risk pass).
   See `ui-redesign-roadmap.md`.
4. **Workspace query split** (`e2fdda4`) — the `[id]` page loaded everything via one nested
   `findFirst` (7 sibling relations → concurrent queries on one tx connection = the pg "client
   already executing" warning + slow renders). Now: access-gate query + bounded parallel scoped
   reads, reassembled into the same `solicitation` shape (render unchanged).
5. **Worker/LLM reliability** (`e2fdda4`, then `a216282`) — every LLM call now has an
   AbortController timeout; **`AI_TIMEOUT_MS = 240s`** (do NOT lower — see §3). `shredRequirements`
   is time-boxed (`deadlineMs`, skips coverage passes when <130s left). pg adapters have
   `connectionTimeoutMillis`/`statement_timeout`/`query_timeout` (`utils/prisma.ts`). Worker now
   **throws on a failed shred** instead of marking the job `done` with an empty matrix.
6. **Compliance sweep concurrency** (`aa21b9f`) — `sweepRequirements` grades
   `COMPLIANCE_CONCURRENCY=4` 30-item batches per round (was sequential). **Verified:** 107 reqs
   graded in ~82s (one tick).
7. **Delete solicitation → central list** (`4d58c4e` added it to Direct AI, `9dd4ea7` moved it) —
   `DeleteSolButton` (confirm-guarded) on the **Solicitations list** row, wired to
   `deleteSolicitationAction` (viewable-gated + audited). Removed from the workspace footer.
8. **Billing management** (`8f8626a`, `8572ce8`) — `/app/billing` now shows, live from Stripe:
   subscription status + **next billing date** + **actual next charge** (via
   `stripe.invoices.retrieveUpcoming`, net of **discount**/credit/proration/tax) + payment method
   + **invoice history (PDF links)**; and for trial plans a **trial card** (days left + usage
   meters via `getTrialUsage`). Helpers: `billing.getBillingOverview`, `trial.getTrialUsage`.
   **Verified:** company 1 (Proposal Foundry, active Base) shows $150 subtotal − $150 coupon = **$0 due**.
9. **Compliance sync on the Direct path** (`5d491ea`) — `syncMatrixFromPasses` only looked for a
   color-team `compliance_format` pass, so Direct AI sols errored "run an AI review first."
   Now branches by `Solicitation.mode`: Direct sources the completed **DirectReview** findings.
   **Verified:** sol#12 → 13 matrix rows sync.

---

## 3. ⚠️ Gotchas that WILL bite if forgotten

- **`AI_TIMEOUT_MS` (utils/dara/providers.ts) must stay ~240s.** A full-RFP shred runs 150-200s
  and a many-finding direct review ~180-200s; the earlier 120s value aborted them mid-generation
  and (via the swallow bug, now fixed) left a silently EMPTY compliance matrix. Ceiling sits just
  under the 300s function limit so true hangs still abort with headroom.
- **The compliance matrix (requirements) comes from the SHRED**, a separate AI job from the
  review. A direct_ai sol needs the shred to run to populate its matrix. Orphaned/stuck jobs are
  reaped after `STALE_MS=6min` (`passes.ts reapOrphanedJobs`); a stuck `running` job keeps the
  workspace poll spinning (`isShredActive`/`usePollRefresh`) — if you see an endless `?_rsc` loop,
  check `dara_job_queue` for a stuck job (0 active jobs = it's just a stale browser tab).
- **No schema changes for billing** — subscription dates/amounts are read live from Stripe on the
  (admin-only) billing page; the Company row only stores plan/status/trialEndsAt/stripe ids.

---

## 4. Backlog (hardest first — the working order agreed this session)

1. **SAM.gov import** — the dashboard button is present but disabled. Blocked on a **SAM.gov API
   key/entitlement** from the operator; then scaffold search + import mapping (Opportunities API).
2. **Trial enforcement** — NOT wired. Gate the create/run actions on `TrialLimitError` →
   redirect `/app/billing`. Targets: `createSolShell`/`finalizeReview` (`new/page.tsx`),
   `runDirectReviewAction` + color-team `runReviewAction`. The trial usage meters (`getTrialUsage`)
   and billing trial card built this session pair with this.
3. **DOCX export** on the compliance matrix (mockup has it) — needs a `docx` lib (XLSX + Print exist).
4. Nice-to-haves: rename/edit metadata from the solicitations LIST (only the workspace has it);
   `CRON_SECRET` in Vercel to lock `/api/cron/passes`; the "Sync from AI review" button label still
   says "Compliance & Format findings" (cosmetic — direct mode folds all findings).

### Deep backlog (larger, not yet scoped)
- **Annotated proposal export (Word w/ comments).** Produce an *updated version of the proposal
  draft* as a `.docx` with **Word review comments** anchored where the AI suggests changes — i.e.
  map each finding/recommended-action to the relevant passage in the proposal and attach a comment
  ("[HIGH] … → suggested fix"). The proposal draft's extracted text + per-finding
  `requirementRef`/`recommendedAction` are already stored; the hard parts are (a) locating each
  finding's anchor span in the original document and (b) writing real Word comments (OOXML
  `word/comments.xml` + `commentRangeStart/End` + `commentReference` runs — the `docx` npm lib's
  comment support is limited, may need direct OOXML/`docxtemplater` or round-tripping the source
  `.docx`). Pairs with the Analysis Report findings + owner/effort. Scope before building.

---

## 5. Fast restart

```bash
git status                       # expect clean main, HEAD 5d491ea
git log --oneline -12
pnpm install                     # if needed
pnpm exec tsc --noEmit
pnpm build                       # must pass (26 routes)
# Deploy (prod = main, manual):
#   git push origin main
#   vercel deploy --prod --yes           # then hard-refresh (Ctrl+Shift+R)
# Schema? DB BEFORE the code deploy:  pnpm prisma migrate deploy  (+ apply-sql RLS if NEW table)
# Diagnose prod: Vercel MCP get_runtime_errors / get_runtime_logs
#   (projectId prj_I6CLDhGJlbjro2Mc67i1AyyHpciP, teamId team_hluvXIDuWYVTRTyXnqxTbfWg)
# Verify tenant DB flows: throwaway `npx tsx` script with pg + DIRECT_URL (non-interactive).
```

## 6. Key files

- **Reviews/AI:** `utils/dara/direct-review.ts`, `utils/dara/passes.ts` (worker + `reapOrphanedJobs`
  + `syncMatrixFromPasses`), `utils/dara/evaluator.ts` (compliance sweep), `utils/dara/requirements.ts`
  (shred), `utils/dara/prompt.ts` (`PASS_SCHEMA` + owner/effort/report block), `utils/dara/providers.ts`
  (`AI_TIMEOUT_MS`).
- **Workspace** (2200+ lines, mode-branched): `app/app/solicitations/[id]/page.tsx` — server actions
  at top; gate + parallel loads near the render; `compliancePanel`/`directReviewPanel`/`pipelineViews`.
- **Report:** `app/app/solicitations/[id]/report/page.tsx` + `components/dara/reportBits.tsx`,
  `ReportFindings.tsx`, `ChecklistPanel.tsx`, `ReportToolbar.tsx`.
- **Billing:** `app/app/billing/page.tsx`, `utils/dara/billing.ts` (`getBillingOverview`),
  `utils/dara/trial.ts` (`getTrialUsage` + enforcement helpers).
- **Create:** `app/app/solicitations/new/page.tsx` + `components/dara/UploadAndReview.tsx`.
- **List/Dashboard:** `app/app/solicitations/page.tsx` (delete), `app/app/dashboard/page.tsx`.
- **Shared:** `components/dara/` — `usePollRefresh`, `ReviewModeBits`, `ComplianceMatrix`,
  `DeleteSolButton`, `SolMetaEditor`, `theme.ts`. Prisma/RLS: `utils/prisma.ts` (+ pg timeouts).
```
