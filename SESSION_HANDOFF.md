# DARA — Session Handoff

_Prepared: 2026-07-05 (late) · HEAD `b1c1847` · branch `main` (clean, **deployed to prod**) · for: next session_

Start-here doc. Everything below is **live on production** (`dara.crucibleinsight.com`) unless
flagged otherwise. Agent memory (authoritative, load first): `direct-ai-review-mode.md`,
`ui-redesign-roadmap.md`, `create-flow-body-size.md`, `color-team-reframing.md`,
`multi-pass-review.md`, `billing-and-backlog.md`. Deep decision log: `BUILD_STATUS.md`.

---

## 1. Deploy model (READ FIRST)

- **Prod = `main`, deployed MANUALLY.** Auto-deploy is OFF. The flow, every time:
  `git push origin main` → `vercel deploy --prod --yes`. `main` is always kept == prod.
- **⚠️ The GitHub→Vercel git integration did NOT fire on push this session** (both pushes; the
  webhook never created a deployment even though the commit was on `main`). This is exactly why
  the flow is manual — **always run `vercel deploy --prod --yes` yourself after pushing.** Do not
  wait on an auto-deploy; it may never come. (`mcp__…list_deployments` to confirm the new SHA is
  live + `state: READY`, `target: production`.)
- **Vercel CLI IS installed** (session-start "not installed" note is stale), authed as
  `islanista-7787`. `.vercel/` linked: project `prj_I6CLDhGJlbjro2Mc67i1AyyHpciP`,
  team `team_hluvXIDuWYVTRTyXnqxTbfWg`. CLI `--prod` builds from the working tree (deploys show
  `gitDirty:1` only because of the untracked `tsconfig.tsbuildinfo` — source still == the commit).
- **Schema changes: migrate BEFORE the code deploy.** `pnpm prisma migrate deploy` (owner /
  `DIRECT_URL`, via `prisma.config.ts`) → if a NEW table, apply its RLS via
  `npx tsx prisma/security/apply-sql.ts <file>` → then `vercel deploy --prod`. Column-only adds
  need just `migrate deploy`. **21 migrations applied to prod** (latest `20260704020000_analysis_report`).
  **No new migrations this session** — all three changes were code-only.
- **`.env.local` points at the REMOTE (prod) Supabase.** No local DB. `withTenant` interactive
  transactions can throw **P2028 from this dev machine** (pooler latency) — verify tenant DB flows
  on prod, or with a throwaway `pg`/owner (`DIRECT_URL`) non-interactive script. `.env.local` also
  has the Stripe secret key.
- **Preview caveat:** the every-minute Vercel **cron only runs on prod**, and prod runs whatever
  code is currently deployed — a review/shred kicked off on a preview is processed by prod's code.
  Verify job *completion* on prod.

---

## 2. What shipped THIS session (2026-07-05 continuation — commits `2df2959`, `b1c1847`)

Both live on prod (deployed via CLI). Context: user was doing a full end-to-end walkthrough.

### `b1c1847` — Real (vector) PDF export for the Analysis Report ✅ user-confirmed working
- **Replaces `window.print()`** with a server-rendered PDF via **`@react-pdf/renderer` (v4.5.1)**.
  New dependency (in `package.json`/`pnpm-lock.yaml`) — registered in
  `next.config.js` → `experimental.serverComponentsExternalPackages` (alongside `mammoth`).
- **`components/dara/ReportPdf.tsx`** — branded navy/gold document: header (DARA · Crucible Insight
  brand mark, title, meta, generated date), Exec Summary score cards, a Prioritized Findings table
  with severity/status chips (rows use `wrap={false}` so they never clip or split mid-line — the
  whole class of browser-print bugs is gone by construction), a "Submission Readiness" section
  (deadline, distribution, DARA recommendation, checklist), and a page-numbered footer.
  **Uses built-in Helvetica**, NOT the app's Inter — deliberate (keeps bundle light, no font files).
- **`app/app/solicitations/[id]/report/pdf/route.ts`** — Node-runtime `GET` that renders the PDF to
  a Buffer and streams it as a download; same view-access checks as the page. (`renderToBuffer`'s
  types want a `Document` element, so the component element is cast to
  `Parameters<typeof renderToBuffer>[0]`.)
- **`utils/dara/report-data.ts`** — new shared **`loadReportModel(solId, daraUser)`** so the report
  page and the PDF are built from ONE source of truth (can't drift). Also exports `readChecklist`,
  `scoreBand`, `PASS_META`. The report page was refactored onto it (removed its inline query +
  computation; imports these helpers now).
- **`ReportToolbar.tsx`** — Export PDF button now `fetch()`es `/report/pdf` → blob download, with a
  "Preparing…" spinner + error toast (was `window.print()`).
- **Verified:** typecheck + `pnpm build` clean (route compiles as dynamic, 0 B client JS);
  react-pdf smoke-tested in Node (emits valid `%PDF-`). **User confirmed the exported PDF works,
  with "one or two minor format issues" to polish later** (see backlog §4).

### `2df2959` — Review-quality + reconcile-refresh + print fixes
1. **Format-finding calibration** (`utils/dara/prompt.ts`) — new `FORMAT_VERIFIABILITY_RULE` woven
   into `PASS_LENS.compliance_format.guidance` (propagates to BOTH the multi-pass Compliance & Format
   pass and the Direct review's lens block). The AI was escalating things it *can't verify from
   extracted text* (font family, exact margins, orientation, paper size) into critical compliance
   failures with author-facing "open the source Word file / re-export the PDF" remediation. Now those
   un-verifiable items become **at most a low-severity manual-verify note**; genuinely evidenced
   format problems (page-limit overruns, missing sections/forms, a font the proposal itself declares
   out-of-spec) still surface normally. Matches the neutral `unable_to_determine` the compliance-
   matrix path already used.
2. **Background-job trailing refresh** (`components/dara/usePollRefresh.ts`) — after a job finishes,
   `active` flips true→false; the refresh that observes completion reads the JobQueue status and the
   rows it produced on **separate pooled connections**, so status can read `done` an instant before
   the just-committed rows are visible to the other snapshot → panel stayed empty until a manual
   reload. Now on the true→false edge it fires two catch-up `router.refresh()` calls (1.2s, 3.5s).
   Fixes **reconcile "proposed changes don't appear until I refresh"** (user-reported) and the same
   class for shred / compliance-check. (Reconcile auto-refresh deployed but not yet re-confirmed in a
   walkthrough — worth a glance next session.)
3. **Report print CSS** (`styles/main.css` `.report-print` scope + `no-print` on `ReportToolbar` +
   `report-print` class on the report root) — full-width, fixed table layout, repeat header, avoid
   row splits, preserve colors, Letter margins. **Now largely a fallback** since `b1c1847` replaced
   the Export-PDF button with the real generator, but it still makes browser Ctrl+P sane.

Prior session's work (create-flow reliability, poll storm, the Analysis Report feature, workspace
query split, worker/LLM timeouts, compliance-sweep concurrency, delete-to-list, billing management,
Direct-path compliance sync — commits `f087ac3`→`5d491ea`) is documented in `BUILD_STATUS.md`.

---

## 3. ⚠️ Gotchas that WILL bite if forgotten

- **Auto-deploy is dead/flaky — deploy manually every time** (see §1). Confirm the new SHA is READY
  on prod via the Vercel MCP before assuming a change is live.
- **`@react-pdf/renderer` must stay in `serverComponentsExternalPackages`** (next.config.js). Its
  layout/font engine won't bundle into the Next server build otherwise. Runtime only executes when
  `/report/pdf` is hit (route is `force-dynamic`), so a green `pnpm build` does NOT prove the PDF
  renders — smoke-test the component or hit the route.
- **`AI_TIMEOUT_MS` (utils/dara/providers.ts) must stay ~240s.** A full-RFP shred runs 150-200s and a
  many-finding direct review ~180-200s; 120s aborted them mid-generation (and, via the old swallow
  bug, left an EMPTY matrix). Ceiling sits just under the 300s function limit.
- **The compliance matrix (requirements) comes from the SHRED**, a separate AI job from the review.
  A direct_ai sol needs the shred to run to populate its matrix. Orphaned jobs reaped after
  `STALE_MS=6min` (`passes.ts reapOrphanedJobs`).
- **No schema changes for billing** — subscription dates/amounts read live from Stripe on the
  (admin-only) billing page.

---

## 4. Backlog (hardest first)

1. **PDF export polish (small, next up).** User said the exported PDF works with "one or two minor
   format issues" — **get the specifics from them** (likely a column width/spacing/wrapped label or a
   page-break spot), then tune `components/dara/ReportPdf.tsx` styles. Optional bigger polish:
   **register Inter** (via `Font.register` + bundled .ttf) so the PDF matches the app typography
   instead of Helvetica.
2. **SAM.gov import** — dashboard button present but disabled. Blocked on a **SAM.gov API
   key/entitlement** from the operator; then scaffold search + import (Opportunities API).
3. **Trial enforcement** — NOT wired. Gate create/run on `TrialLimitError` → redirect `/app/billing`.
   Targets: `createSolShell`/`finalizeReview` (`new/page.tsx`), `runDirectReviewAction` +
   `runReviewAction`. Pairs with the trial usage meters (`getTrialUsage`) + billing trial card.
4. **DOCX export** on the compliance matrix (mockup has it) — needs a `docx` lib (XLSX + Print exist).
5. Nice-to-haves: rename/edit metadata from the solicitations LIST; `CRON_SECRET` in Vercel to lock
   `/api/cron/passes`; "Sync from AI review" button label still says "Compliance & Format findings"
   (cosmetic — direct mode folds all findings).

### Deep backlog (larger, not yet scoped)
- **Annotated proposal export (Word w/ comments).** Produce an updated `.docx` of the proposal draft
  with **Word review comments** anchored where the AI suggests changes (map each finding /
  `recommendedAction` to the passage). Hard parts: (a) locating each finding's anchor span in the
  original doc, (b) writing real OOXML comments (`word/comments.xml` + `commentRangeStart/End` —
  the `docx` npm lib's comment support is limited; may need direct OOXML/`docxtemplater` or
  round-tripping the source `.docx`). Scope before building.

---

## 5. Fast restart

```bash
git status                       # expect clean main, HEAD b1c1847
git log --oneline -12
pnpm install                     # if needed (react-pdf added this session)
pnpm exec tsc --noEmit
pnpm build                       # must pass (27 routes; /report/pdf is the newest)
# Deploy (prod = main, MANUAL — auto-deploy is off/flaky):
#   git push origin main
#   vercel deploy --prod --yes           # ALWAYS; then hard-refresh (Ctrl+Shift+R)
#   confirm live: Vercel MCP list_deployments → newest SHA, state READY, target production
# Schema? DB BEFORE the code deploy:  pnpm prisma migrate deploy  (+ apply-sql RLS if NEW table)
# Diagnose prod: Vercel MCP get_runtime_errors / get_runtime_logs
#   (projectId prj_I6CLDhGJlbjro2Mc67i1AyyHpciP, teamId team_hluvXIDuWYVTRTyXnqxTbfWg)
# Verify tenant DB flows: throwaway `npx tsx` script with pg + DIRECT_URL (non-interactive).
```

## 6. Key files

- **Analysis Report + PDF:** `utils/dara/report-data.ts` (`loadReportModel` — shared loader,
  the source of truth), `components/dara/ReportPdf.tsx` (react-pdf document),
  `app/app/solicitations/[id]/report/pdf/route.ts` (streaming route),
  `app/app/solicitations/[id]/report/page.tsx` (refactored onto the loader),
  `components/dara/reportBits.tsx` (severity/effort palette — shared by page + PDF),
  `ReportFindings.tsx`, `ChecklistPanel.tsx`, `ReportToolbar.tsx` (Export PDF fetch/download).
- **Reviews/AI:** `utils/dara/direct-review.ts`, `utils/dara/passes.ts` (worker + `reapOrphanedJobs`
  + `syncMatrixFromPasses`), `utils/dara/evaluator.ts` (compliance sweep), `utils/dara/requirements.ts`
  (shred), `utils/dara/prompt.ts` (`PASS_LENS`/`FORMAT_VERIFIABILITY_RULE`, `PASS_SCHEMA`,
  owner/effort/report block), `utils/dara/providers.ts` (`AI_TIMEOUT_MS`).
- **Amendments/reconcile:** `utils/dara/amendments.ts` (`reconcileAmendment`, `applyAmendmentChange`);
  reconcile UI + poll in `app/app/solicitations/[id]/page.tsx` (AsyncJobControl) +
  `components/dara/usePollRefresh.ts` (trailing catch-up refresh).
- **Workspace** (2200+ lines, mode-branched): `app/app/solicitations/[id]/page.tsx`.
- **Billing:** `app/app/billing/page.tsx`, `utils/dara/billing.ts`, `utils/dara/trial.ts`.
- **Create:** `app/app/solicitations/new/page.tsx` + `components/dara/UploadAndReview.tsx`.
- **List/Dashboard:** `app/app/solicitations/page.tsx` (delete), `app/app/dashboard/page.tsx`.
- **Shared:** `components/dara/` — `usePollRefresh`, `ReviewModeBits`, `ComplianceMatrix`,
  `DeleteSolButton`, `SolMetaEditor`, `theme.ts`. Prisma/RLS: `utils/prisma.ts` (+ pg timeouts).
```
