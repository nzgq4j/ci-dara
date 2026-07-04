# DARA — Session Handoff

_Prepared: 2026-07-04 · HEAD `3b0803c` · branch `main` (clean, **deployed to prod**) · for: next session_

Start-here doc. Everything below is **live on production** (`dara.crucibleinsight.com`) unless
flagged otherwise. Agent memory (authoritative, load first): `direct-ai-review-mode.md`,
`ui-redesign-roadmap.md`, `color-team-reframing.md`, `multi-pass-review.md`. Feature plan:
`DIRECT_AI_POAM.md`. Older MVP prompt-chain (`DARA_CC_PROMPT_CHAIN.md`) is largely superseded
by this session — Prompt 6-8 (reskin) is DONE; Prompt 3 (trial enforcement) is still open but
its target moved (see §5).

---

## 1. Deploy model (READ FIRST)

- **Prod = `main`, deployed MANUALLY.** Auto-deploy is OFF. The flow used all session:
  `git push origin main` → `vercel deploy --prod --yes`. `main` is always kept == prod.
- **Vercel CLI IS installed** (the session-start "not installed" note is stale). `.vercel/`
  is linked (project `prj_I6CLDhGJlbjro2Mc67i1AyyHpciP`, team `team_hluvXIDuWYVTRTyXnqxTbfWg`).
- **Schema changes: migrate BEFORE code deploy.** `pnpm prisma migrate deploy` (owner /
  `DIRECT_URL`) → if a NEW table, apply its RLS via `npx tsx prisma/security/apply-sql.ts <file>`
  → then `vercel deploy --prod`. Column-only adds need just `migrate deploy` (no RLS).
- **`.env.local` points at the REMOTE (prod) Supabase.** There is no local DB. `withTenant`
  interactive transactions throw **P2028 from this dev machine** (pooler latency) — so you
  cannot exercise tenant DB flows locally; verify on prod/preview or via a `prismaAdmin`/`pg`
  throwaway script (non-interactive queries work).
- **Preview caveat:** `vercel deploy` (no `--prod`) builds a preview, but the every-minute
  Vercel **cron only runs on prod**, and prod runs whatever code is currently deployed — so a
  Direct AI review kicked off on a preview may hang "Running" (its job gets processed by prod's
  code, not the preview's). Verify review *completion* on prod.

---

## 2. What shipped this session (all on prod)

**Direct AI review mode (M0–M7)** — a one-click unified review coexisting with the color-team
P1/P2/P3 flow. New `Solicitation.mode` enum, `DirectReview` table, `Finding` repoint
(migration `20260704000000` + RLS `2026-07-04_direct_reviews_rls.sql`, both applied to prod).
Engine `utils/dara/direct-review.ts` + worker `direct_review` branch in `passes.ts` (single LLM
call). UI: `ReviewModeBits`, `UploadAndReview`, `DirectReviewPanel`, mode-branched workspace
pipeline (color-team untouched). **Verified end-to-end on prod** (a review completed with a
score + 27 findings). Full detail: `DIRECT_AI_POAM.md`, `direct-ai-review-mode.md`.

**Navy/gold/Inter light reskin** — `--c-navy`/`--c-gold` tokens, `theme.ts` accent → navy
(buttons) / gold (focus/eyebrow), IBM Plex → Inter, `forcedTheme="light"`, navy sidebars, navy
sign-in. Swept ~110 `#3b6ef0` literals → navy. **Then** a full readability pass converting the
old dark-theme pastels to the design's severity/status palette (pale bg + dark text): red
`#991B1B`/`#FEE2E2`, orange `#C05621`/`#FFEDD5`, amber `#92400E`/`#FEF3C7`, green
`#166534`/`#DCFCE7`. (One intentional leftover: team avatar/dept-dot categorical palettes.)

**Redesigns from 4 Snagit mockups** (`C:\Users\david\OneDrive\Documents\Snagit\`):
- **Compliance Matrix** (`ComplianceMatrix.tsx`) — filter chips w/ counts, search, row tinting,
  inline auto-save of Response Location/Status/Notes (`saveMatrixRow`). Maps to existing
  `Requirement` fields; no migration.
- **Dashboard** (`dashboard/page.tsx`) — KPI cards (Active Reviews / Due ≤7d / Avg Compliance /
  Open Findings) + tracking table (Solicitation / Agency / NAICS / Due Date / Countdown /
  Review Status). Added `Solicitation.dueDate` + `naics` (migration `20260704010000`, applied to
  prod). New reusable `CountdownChip` + `ColorTeamStatus` in `ReviewModeBits`.
- **Editable solicitation names** — `EditableSolTitle` (pencil in workspace header,
  `renameSolicitationAction`). Plus `SolMetaEditor` (edit reference/agency/NAICS/due-date inline)
  and Due Date + NAICS fields on the create screen.

**Create-flow fixes** — two-step Upload & Instant Review (Continue/Cancel + staged processing
indicator); always-creates-the-sol; shared `FileDropzone`/`DocUploader` drag-drop on workspace
uploads; `serverActions.bodySizeLimit` = 25mb.

---

## 3. ✅ Create flow — FIXED & verified on prod (`f087ac3`, dpl_Avqe…)

**The Direct AI create flow ("shows progress but doesn't create a solicitation") is fixed and
verified** — sol#12 created from the same payload that previously failed. See memory
`create-flow-body-size.md`.
- **Root cause:** the rewritten create flow POSTed *all* files in one server-action FormData.
  Vercel caps a Function request body at **~4.5 MB** and that OVERRIDES
  `serverActions.bodySizeLimit: '25mb'` — larger sets 413'd and the sol was never created
  (silent: user dropped back to Step 2). Compounded by intermittent prod pooler errors
  (`P1001 DatabaseNotReachable` on `getDaraUser`, `P2028` tx timeout) seen in Vercel
  `get_runtime_errors`.
- **Fix:** split `createAndRunReview` → `createSolShell` + `uploadDocToSol` (one file/request,
  client-orchestrated, like the workspace `DocUploader`/`uploadSolDoc`) + `finalizeReview`.
  Added `withDbRetry` (retries P1001/P2028/etc.), structured client errors, `[new-sol]` server
  logs, and a client warning for any single file >4 MB. A single >4.5 MB file still fails its own
  request — long-term fix is direct-to-Supabase-Storage signed-URL upload.
- **Two follow-ups from the same log dig, both RESOLVED `9be19c5`:**
  1. `P2022 — column isScored…` was a STALE 2026-07-01 error (code before migration). Prod DB
     already has the column; all 20 migrations applied. No action.
  2. 300s timeouts + `pg` "client already executing a query" on `/app/solicitations/[id]`: five
     components each `setInterval(router.refresh, 3000)` → a backgrounded tab refreshed the heavy
     sol query forever. Fixed with `components/dara/usePollRefresh.ts` (polls only while the tab
     is visible). If timeouts persist, split the giant nested `findFirst` in `SolicitationDetailPage`.

---

## 4. Pending work (roadmap — see `ui-redesign-roadmap.md`)

1. **Analysis Report** (`futureautoreviewandcolorreview.png`) — the big remaining piece; a new
   page unifying auto + color review: exec summary (Overall + Pass 1/2/3 + narrative),
   **Prioritized Findings & Action Plan** with per-finding **Owner / Effort / Status**, right
   rail (deadline, finding distribution, DARA recommendation, pre-submission checklist).
   **Decision made:** finding workflow = **AI-suggested + editable** (the review suggests an
   owner role + effort estimate, Status defaults Open; users override). **Needs:** migration for
   `Finding.owner` / `status` (Open/InProgress/Resolved) / `effort` + a checklist concept; prompt
   changes in `utils/dara/prompt.ts` (`buildDirectReviewPrompt` + pass prompts) to emit
   owner/effort. Do it in stages: schema + prompt first, then the report page.
2. **DOCX export** on the compliance matrix (mockup has it) — needs a docx lib (`docx` npm);
   only XLSX + Print exist today.
3. **Trial enforcement is still NOT wired** (only the `review_run` count spans both paradigms).
   When wiring (was "Prompt 3"), target the CURRENT actions: `createAndRunReview` (`new/page.tsx`)
   and `runDirectReviewAction` + color-team `runReviewAction` — the old `createSolicitation`
   target no longer exists. Catch `TrialLimitError` → redirect `/app/billing`.
4. **"Import from SAM.gov"** dashboard button is present but disabled (backlog — needs SAM.gov API).
5. Nice-to-haves: rename/edit metadata from the solicitations LIST too (only the workspace has it
   now); `CRON_SECRET` in Vercel to lock `/api/cron/passes` (still open from the old handoff).

---

## 5. Fast restart

```bash
git status                       # expect clean main, HEAD 3b0803c
git log --oneline -15
pnpm install                     # if needed
pnpm exec tsc --noEmit
pnpm build                       # must pass (25 routes)
# Deploy (prod = main, manual):
#   git push origin main
#   vercel deploy --prod --yes           # then hard-refresh (Ctrl+Shift+R)
# New dara_* column/table? DB BEFORE the code deploy:
#   pnpm prisma migrate deploy                                    # owner/DIRECT_URL
#   npx tsx prisma/security/apply-sql.ts prisma/security/<new>_rls.sql   # only if new table
# Diagnose prod errors: Vercel MCP get_runtime_errors / get_runtime_logs
#   (projectId prj_I6CLDhGJlbjro2Mc67i1AyyHpciP, teamId team_hluvXIDuWYVTRTyXnqxTbfWg)
```

## 6. Key files
- Engine: `utils/dara/direct-review.ts`, `utils/dara/passes.ts` (worker), `utils/dara/prompt.ts`.
- Workspace (2200+ lines, mode-branched): `app/app/solicitations/[id]/page.tsx` — server actions
  at top (`createAndRunReview` is in `new/page.tsx`; `runDirectReviewAction`, `saveMatrixRow`,
  `renameSolicitationAction`, `updateSolMetaAction` here), `compliancePanel`, `directReviewPanel`,
  `pipelineViews`/`pipelineStages` near the bottom.
- Dashboard: `app/app/dashboard/page.tsx`. Create: `app/app/solicitations/new/page.tsx` +
  `components/dara/UploadAndReview.tsx`.
- Shared components: `components/dara/` — `ReviewModeBits` (chips/status/countdown),
  `ComplianceMatrix`, `DirectReviewPanel`, `FileDropzone`, `DocUploader`, `EditableSolTitle`,
  `SolMetaEditor`, `theme.ts` (class vocab).
- Theme tokens: `styles/main.css` (`--c-navy`/`--c-gold`), `tailwind.config.js`.
