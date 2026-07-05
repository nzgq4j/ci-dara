# DARA — Session Handoff

_Prepared: 2026-07-05 (late) · HEAD `7fe23ab` · branch `main` (clean, **deployed to prod**) · for: next session_

Start-here doc. Everything below is **live on production** (`dara.crucibleinsight.com`) unless flagged
otherwise. **Top priority next is the security backlog** (`SECURITY_BACKLOG.md`, §5). Agent memory
(load first): `security-reaudit-2026-07.md`, `personas-review-lens.md`, `billing-and-backlog.md`,
`direct-ai-review-mode.md`, `create-flow-body-size.md`. Deep decision log: `BUILD_STATUS.md`.

---

## 1. Deploy model (READ FIRST — unchanged)

- **Prod = `main`, deployed MANUALLY.** Every time: `git push origin main` → `vercel deploy --prod --yes`
  → confirm the new SHA is `READY` + `target: production` via the Vercel MCP `list_deployments`.
- **GitHub→Vercel auto-deploy is flaky/off** — do not wait on it; always deploy via CLI yourself.
- Vercel CLI **is** installed, authed as `islanista-7787`; `.vercel/` linked (project
  `prj_I6CLDhGJlbjro2Mc67i1AyyHpciP`, team `team_hluvXIDuWYVTRTyXnqxTbfWg`). Deploys show `gitDirty:1`
  only because of the untracked `tsconfig.tsbuildinfo` — source still == the commit.
- **Schema changes: migrate BEFORE the code deploy.** `pnpm prisma migrate deploy` → new `dara_*` table
  also needs its RLS applied via `npx tsx prisma/security/apply-sql.ts <file>` → then deploy.
  **No new migrations this session — every change was code-only** (21 migrations still the latest).
- **`.env.local` points at the REMOTE (prod) Supabase.** No local DB. `withTenant` interactive
  transactions can throw **P2028** from this dev machine (pooler latency) — verify tenant DB flows on
  prod, or with a throwaway non-interactive `pg` script on `DIRECT_URL`. `.env.local` also has the
  Stripe secret + `APP_KEY`.
- Every-minute Vercel **cron only runs on prod**; a review/shred kicked on preview is processed by
  prod's deployed code. Verify job *completion* on prod.

---

## 2. What shipped THIS session (2026-07-05 continuation)

All live on prod (deployed via CLI). Commits `bf72353` → `7fe23ab`.

1. **PDF export 500 fix** (`bf72353`) — multi-page Analysis Report PDFs crashed (`unsupported number`)
   for large sols (sol 13, 127 findings → 33 pages). Root cause: a `fixed` react-pdf element with a
   `render` callback and auto height compounds its box height each page until it overflows. Fixed with
   an explicit height on the page-number element (+ hardened bordered blocks). `components/dara/ReportPdf.tsx`.
2. **Trial enforcement wired** (`20fcccb`) — the trial-limit engine existed (`utils/dara/trial.ts`) but
   nothing called it. Gated `createSolShell` (solicitation), `inviteUser` (seat, new invites only), and
   `enqueueReviewRun`/`enqueueDirectReview` (review_run, **first run only** so re-runs aren't blocked);
   Run button disabled at limit; dashboard trial status bar. Paid plans are a no-op (company 1 is
   `starter`). See `billing-and-backlog.md`.
3. **`CRON_SECRET`** — generated + set in all 3 Vercel envs; prod redeployed. `/api/cron/passes` now
   returns 401 without the bearer (verified); legit Vercel Cron still 200s.
4. **Real `.docx` compliance-matrix export** (`c39c1d1`) — replaced the HTML-as-`.doc` trick with a genuine
   OOXML `.docx` via the `docx` lib. `utils/dara/matrix-docx.ts`; base64 through the export action →
   `MatrixExport` decodes. `docx` added to `next.config` `serverComponentsExternalPackages`.
5. **Per-review response upload + amendments drag-drop** (`e80fe0e`) — color-team reviews now take a
   per-review response draft (drag-drop `DocUploader`, `uploadReviewDoc`/`deleteReviewDoc` → `ReviewDocument`),
   replacing the single-upload + "Capture draft" snapshot model (removed). Sol-level proposal upload now
   shows only in Direct AI mode. Amendments upload switched to the same `DocUploader`. Deleted `utils/dara/reviews.ts`.
6. **Annotated response `.docx`** (`d25fcfd`, anchoring fix `4e231ec`) — export the proposal/response draft
   with each finding as a **real inline Word comment**, anchored to the passage it's about. One AI call at
   export time maps findings → verbatim quotes (no schema/re-run). `utils/dara/annotated-proposal.ts`,
   route `app/app/solicitations/[id]/annotated/route.ts`, `components/dara/AnnotatedExportButton.tsx` (on the
   report toolbar + each color-team review card). Anchoring fix: normalized (whitespace/smart-quote)
   matching + 200k-char cap (was 0 inline; sol 13 now 13/15 anchored — user-confirmed).
7. **Personas reintegrated as an AI review lens** (`f9f89c4`) — personas had fallen out of the review
   process (engines built prompts with zero persona input). Now `renderPersonaGuidance` injects the
   selected/active personas' `systemPrompt` into `buildPassPrompt` + `buildDirectReviewPrompt`
   (`personaLensBlock`, augment-not-override, before the JSON tail). `runPass` uses the review's selected
   personas (else all active); `runDirectReview` uses all active. **`Persona.systemPrompt` is the tweak knob**
   (edit at `/app/personas`) — steers results without touching hardcoded prompts. See `personas-review-lens.md`.
8. **CMMC L2 security re-audit** (§5) — 6-domain re-audit; prior hardening holds (26/26 RLS intact, no
   regressions). Net-new gaps SEC-01..23 in **`SECURITY_BACKLOG.md`** (repo root, **untracked — do NOT
   commit while open**). **SEC-04 fixed** (`7fe23ab`): the annotated-export CUI→LLM egress now records an
   `annotated.export` audit entry (provider/mode) + fences the proposal with the shared injection guard.

---

## 3. ⚠️ Gotchas that WILL bite if forgotten

- **Deploy manually every time** (§1); confirm READY on prod before assuming a change is live.
- **`@react-pdf/renderer`, `mammoth`, AND `docx` must stay in `serverComponentsExternalPackages`**
  (`next.config.js`). The `/report/pdf` and `/annotated` routes + matrix `.docx` action only execute the
  lib at request time, so a green `pnpm build` does NOT prove they render — smoke-test the helper or hit the route.
- **`AI_TIMEOUT_MS` (utils/dara/providers.ts) must stay ~240s.** Full shred/review runs 150-200s; 120s
  aborted them mid-generation.
- **The compliance matrix (requirements) comes from the SHRED**, a separate AI job from the review.
- **Personas now feed the review prompts.** Editing/activating a persona changes review output. No-persona
  companies get an unchanged prompt. The color-team Run gate ("≥1 active persona") is meaningful again.
- **The `/annotated` route makes a live AI call** (`maxDuration=300`) and has **no rate limit / trial gate**
  (SEC-01) — flagged in the backlog.

---

## 4. Backlog (non-security)

1. **PDF-export minor format polish** — user reported small issues, **deferred by them** ("tweak later").
2. **SAM.gov import** — dashboard button disabled; blocked on a SAM.gov API key/entitlement (operator).
3. **Annotated export follow-ups** — per-direct-review persona selector; annotate the *original* uploaded
   `.docx` in place (preserve formatting) instead of rebuilding from text; batch anchoring for huge finding sets.
4. Nice-to-haves: rename/edit metadata from the solicitations LIST; richer built-in persona templates.

---

## 5. SECURITY BACKLOG — top priority (`SECURITY_BACKLOG.md`)

Full CMMC L2 / NIST 800-171 / OWASP re-audit ran 2026-07-05. **Prior hardening holds — no regressions**
(26/26 `dara_*` tables RLS, `withTenant` everywhere, Stripe webhook verified, CUI encrypted, admin gating
fail-closed, prompt-injection fencing, no LLM tool-calling). Net-new gaps, highest first (see the file for
file:line evidence + fixes + control mappings; it's **untracked**, don't commit while open):

- **P1:** SEC-01 **no rate limiting / WAF / BotID** (SC-5; `/annotated` unbounded, re-runs + non-trial plans
  unmetered). SEC-02 **`next@14.2.35` = 5 HIGH prod advisories** (SSRF, middleware bypass) — needs 14→15
  migration. SEC-03 **CI gates don't block deploys** (no branch protection + Vercel deploys on push
  independent of CI). ~~SEC-04 annotated egress unaudited+unfenced~~ **FIXED this session**.
- **P2 (verified code gaps):** SEC-05 cross-department **BOLA** on child mutation/delete actions
  (`updateRequirement`/`saveMatrixRow`/`deleteRequirement`/`deleteSolDoc` + run/rerun/regenerate/archive/
  applyChange/enqueueReconcile — authorize child by `companyId` only, not the viewable parent sol). SEC-06
  **deactivated users keep access** (`getDaraUser` ignores `isActive`). SEC-07 **solicitation delete orphans
  CUI files** (`deleteSolicitationAction` no `removeStored`). SEC-08 **CSV formula/DDE injection** in matrix
  CSV export. SEC-09 **no crypto key-rotation** path. SEC-10 pass-re-run + exports unaudited. SEC-11 **MFA not
  enforced** (verify Supabase). SEC-12 decompression-bomb guard. SEC-13 CSP nonce (known-deferred).
- **P3/best-practice:** SEC-14 cron fail-closed. SEC-15 CI RLS-drift check + isolation test. SEC-16 SHA-pin
  GH Actions. SEC-17 scan SBOM + license gate. SEC-18 kill latent `dangerouslySetInnerHTML`. SEC-19 generic
  client errors. SEC-20 password policy. SEC-21 audit retention policy. SEC-22 persona-injection residual.
  SEC-23 tenant right-to-delete.
- **Suggested quick code wins next:** SEC-08 (CSV escaping), SEC-06 (`isActive` fail-closed), SEC-07
  (`removeStored` on sol delete), SEC-10 (export/re-run audit), SEC-14 (cron fail-closed). Then SEC-05 (BOLA
  sweep) and SEC-01 (rate limiting). **Operator:** SEC-03 (branch protection + CI-gated deploy), SEC-02
  (Next 15), SEC-11/SEC-20 (Supabase MFA/password).

---

## 6. Fast restart

```bash
git status                       # expect clean main, HEAD 7fe23ab
git log --oneline -14
pnpm install                     # if needed (docx added this session)
pnpm exec tsc --noEmit
pnpm build                       # must pass (27 routes; /annotated is the newest)
# Deploy (prod = main, MANUAL): git push origin main && vercel deploy --prod --yes ; confirm via MCP list_deployments
# Diagnose prod: Vercel MCP get_runtime_errors / get_runtime_logs
#   (projectId prj_I6CLDhGJlbjro2Mc67i1AyyHpciP, teamId team_hluvXIDuWYVTRTyXnqxTbfWg)
# Verify tenant DB flows: throwaway `npx tsx` with pg + DIRECT_URL (non-interactive).
```

## 7. Key files (this session)

- **Trial:** `utils/dara/trial.ts` (`requireTrialCapacity`, `trialLimitMessage`), gates in
  `app/app/solicitations/new/page.tsx` (createSolShell), `utils/dara/passes.ts` (enqueueReviewRun),
  `utils/dara/direct-review.ts` (enqueueDirectReview), `app/app/team/actions.ts` (inviteUser); dashboard bar
  in `app/app/dashboard/page.tsx`.
- **Exports:** `utils/dara/matrix-docx.ts` (+ `exportMatrixAction`/`MatrixExport.tsx`),
  `components/dara/ReportPdf.tsx` + `app/app/solicitations/[id]/report/pdf/route.ts`.
- **Annotated:** `utils/dara/annotated-proposal.ts`, `app/app/solicitations/[id]/annotated/route.ts`,
  `components/dara/AnnotatedExportButton.tsx`; fencing primitives now exported from `utils/dara/prompt.ts`.
- **Per-review upload:** `uploadReviewDoc`/`deleteReviewDoc` + review card in
  `app/app/solicitations/[id]/page.tsx`; `components/dara/DocUploader.tsx` (added `reviewId`).
- **Personas lens:** `utils/dara/personas.ts` (`renderPersonaGuidance`), `utils/dara/prompt.ts`
  (`personaLensBlock`, `buildPassPrompt`/`buildDirectReviewPrompt`), engines in `passes.ts`/`direct-review.ts`.
- **Security:** `SECURITY_BACKLOG.md` (root, untracked), `utils/dara/audit.ts` (`recordAudit`),
  `utils/prisma.ts` (`withTenant`), `prisma/security/*.sql` (RLS).
- **Workspace** (2300+ lines, mode-branched): `app/app/solicitations/[id]/page.tsx`.
```
