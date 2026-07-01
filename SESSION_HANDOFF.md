# DARA — Session Handoff

_Prepared: 2026-07-01 (end of session) · for: next session_

This is the "start here tomorrow" doc. Authoritative status lives in
`BUILD_STATUS.md` (§2 decisions, §3 completed, §4 gaps, §7 session log); open
security findings live on `/app/security` and in `utils/dara/security-content.ts`.

---

## 1. Where we are

- **Branch:** `main`, clean. Last commit `8125fd1` (**holistic review restore** — see
  the core principle below). The **color-team reframing (Phases 1–3) is complete and
  deployed**; the bulk of the 2026-07-01 session was **bug-fixing the review/eval flow on
  real solicitation data** and a **course-correction back to a holistic review model**.
- **Session arc 2026-07-01 (most recent first):**
  `8125fd1` — **holistic review restored** + pass/fail → compliance matrix (the important
  one; supersedes the "compliance-heavy" batching) · `d57eaa9` — duplicate-review guard +
  redirect-after-create (fixes the create-crash → recreate loop) · `7e39b43`/`3e410a2` —
  batched/tiered/resumable eval **[superseded by `8125fd1`]** · `f60017b` — amendment-diff
  recall prompt · `f1155b3` — **two real prod bugs**: UTC-date `toLocaleDateString()`
  hydration crash → `fmtDate`; shred returning nothing (8000-token truncation) → 16000 +
  RFP-only + salvage parser + surfaced errors (`AiActionButton`) · `9a4e944` (Phase 2),
  `aa46956` (Phase 3), `d1836dc` (Phase 1), `054a8e6` (docs).
- **Design imported, not yet built:** `Color Review Cycle.dc.html` from the claude.ai
  "SaaS conversion plan" project (read via the `DesignSync` MCP). It reframes the
  solicitation workspace as a **9-stage pipeline** (Solicitation · Compliance · Kickoff ·
  Pink · Red · Gold · White Glove · Compliance · Submit) with per-stage AI findings, a
  multi-volume compliance matrix, and an amendment-workflow view. **Agreed approach:**
  *hybrid* — adopt the pipeline UX but **reuse the existing engine**; end goal is the full
  design. This is **Pass B** (top of the queue). Unescaped reference saved at
  `…/scratchpad/ColorReviewCycle.html`.
- **Prod:** https://dara.crucibleinsight.com
- **Deploy method:** GitHub→Vercel auto-deploy is **not** firing. Manual flow:
  `edit → pnpm exec tsc --noEmit → pnpm build → git commit → vercel deploy --prod --yes → git push`.
  **For any change that adds a `dara_*` table or column, the DB steps must run BEFORE
  the code deploy:** `prisma migrate deploy` (owner) **then** `npx tsx
  prisma/security/apply-sql.ts <new RLS file>` — the runtime roles are fail-closed on
  new tables until granted, and the layout/settings/evaluator query several of these
  tables on normal requests.
- **Security posture:** **No audit findings remain open.** DARA-007 (CUI→LLM) is
  risk-accepted with controls. SSP at `/app/security/plan`.

### Watch-outs (don't trip on these)

- **⭐ CORE PRINCIPLE — a review is a HOLISTIC evaluation, not a per-requirement
  checklist** (commit `8125fd1`). A color-team run does two distinct things:
  **(1) holistic review** — the full structured assessment (review summary incl. *what it
  was measured against* + how scored, rationale, strengths, weaknesses, compliance
  commentary, suggested improvements w/ rationale, score/rating) per **evaluation factor**
  (`isScored = true`, the few Section M factors), from each persona's perspective — the rich
  `buildUserPrompt`/`parseResult` path (`runEvaluation`, scoped to `isScored`);
  **(2) compliance matrix sweep** — `runComplianceSweep` runs a lean pass/fail determination
  over the **administrative/pass-fail** requirements (`isScored = false`, the bulk) and sets
  each requirement's `complianceStatus`. **DO NOT** turn the review back into a lean
  per-requirement determination grind — that was the explicitly-corrected wrong turn. Mark
  Section M factors as **Scored** on the Compliance tab so they get the holistic treatment.
- **⚠️ Vercel deploy-skew traps open tabs.** After a `vercel --prod` deploy, an already-open
  browser tab keeps running the *old* deployment (its server actions POST back to that
  deployment) until a **hard refresh** (Ctrl+Shift+R). This bit us repeatedly during rapid
  iteration — symptoms looked like "the fix didn't deploy" when it had. Always hard-refresh
  after deploying before re-testing. (Optional future: disable Skew Protection or add a
  "new version — reload" banner.)
- **Large synchronous review runs are time-boxed + resumable.** `runReviewAction` runs under
  a 200s budget; if it can't finish it leaves the eval `pending` and the RunPanel says
  "click Run again to continue." With the holistic model the rich review only covers the few
  scored factors, so this rarely triggers now — but the JobQueue + Vercel Cron worker remains
  the proper "any size, zero clicks" fix (deferred).
- **Product reframed: offerors → color-team gate reviews** (review *our own* proposal as
  it matures, not score competitors). The methodology is **never named** in UI/prompts/
  code/docs — use "color team review", gate names (Pink/Red/Gold/Blue/Green/Black/White),
  "review gate". All three phases SHIPPED. Solicitation tabs: **Overview · Documents ·
  Compliance · Amendments · Color Teams · Review**.
- **`Criterion`→`Requirement`** (`dara_requirements`). **Compliance** tab = AI shred
  ("Generate from solicitation", `utils/dara/requirements.ts`) + per-source grouping +
  compliance status + proposal ref. `dara_results.criterion_id` column kept (Prisma field
  `requirementId`). Long-RFP shred truncation → raise `SHRED_MAX_TOKENS`.
- **`Response`→`Review`** (`dara_reviews`). The proposal working draft lives on the
  solicitation (**Documents** tab, `doc_type=proposal`); each **Color Teams** review freezes
  a snapshot (`captureSnapshot`) and runs its chosen personas (fallback all active) vs that
  snapshot. Results in the **Review** tab. Engine reads `doc_type=rfp` for the RFP reference.
- **Amendments** (`dara_amendments`): upload an amendment doc → "Reconcile with AI"
  (`utils/dara/amendments.ts`) diffs it vs the matrix → accept/reject proposed add/modify/
  remove. Accept folds into the matrix (modify versions prior values into
  `dara_requirement_versions`; remove sets `removed_at`, retained/struck). Reviews
  snapshotted before an applied amendment show a **pre-amendment** flag (re-capture & re-run).
  Diff truncation → raise `DIFF_MAX_TOKENS` in `utils/dara/amendments.ts`.
- **Three new RLS files this session** (`2026-07-01_{requirements,reviews,amendments}_rls.sql`)
  + DARA-004/005 source files updated for the renames/new tables. New `dara_*` tables are
  fail-closed until granted, so apply-sql must run before each code deploy.

- **Application Admin is a company-less operator role** (`/app/admin`). An email in
  `PLATFORM_ADMIN_EMAILS` (or an active `dara_platform_admins` row) gets the admin
  shell and **no company / no CUI** — it is NOT a normal user. Use a separate account
  for company access. Admins are managed in the console (Administrators section);
  env-listed admins are pinned (can't be removed in-app). `PLATFORM_ADMIN_EMAILS` is
  currently **`islanista@gmail.com`**; `admin@crucibleinsight.com` is a DB admin.
  `david@crucibleinsight.com` was removed/deactivated and is back to a normal user
  (company "Proposal Foundry").
- **`PLATFORM_ADMIN_EMAILS` is stored Sensitive** → `vercel env pull` shows it blank
  (not empty!). To change it: `vercel env add PLATFORM_ADMIN_EMAILS <env> --value "…" --force --yes`
  (piping stdin does NOT work — the CLI runs non-interactive for agents).
- **Platform AI keys + model live in the console** (`/app/admin#ai`,
  `dara_platform_settings`). Platform-mode (non-BYOK) evaluations resolve their key +
  model from there; the `PLATFORM_ANTHROPIC_KEY` env var is now only a **fallback**
  (shown as "from env"). Move the key into the console to finish the migration. Model
  catalog: `utils/dara/ai-catalog.ts`. **Non-BYOK company accounts have no key/model
  choice** — Settings hides the provider/model/key inputs on platform mode (they appear
  only in BYOK mode; `app/app/settings/CompanyAIConfig.tsx`).
- **Review output lives in the `Review` tab** (the old "Matrix" tab, renamed Phase 2). Each
  per-factor result: **Review summary** (how/what/measured-against, cited) → **Assessment**
  (rationale) → strengths / weaknesses / compliance / **suggested changes** (change +
  rationale), with a score/rating. Per result: **Regenerate** (snapshots prior values into
  `dara_result_versions`, History(N) + regen×N badge) and **Archive/Restore** (retained,
  never deleted). `EVAL_MAX_TOKENS=8000` per rich call (`utils/dara/evaluator.ts`).
  **NOTE:** reviews run before `8125fd1` (on sol 5 etc.) hold *old* lean determination rows
  for all requirements — delete + recreate the review (or use a fresh solicitation) to see
  the restored holistic behavior cleanly.
- **Demoting a platform admin takes two steps.** Removing the email from
  `PLATFORM_ADMIN_EMAILS` is NOT enough: `resolvePlatformAdmin` treats an active
  `dara_platform_admins` row as admin regardless of the env list, and the console
  **Deactivate** is blocked while the email is still env-pinned. To fully demote: remove
  from env **and** delete/deactivate the row. (`david@crucibleinsight.com` was demoted
  this way — row deleted; now a normal `company_admin` of "Proposal Foundry".)
- **Onboarding gate is live.** A brand-new org creator (un-onboarded company +
  `company_admin`) is routed to `/onboarding`; an invited member to `/welcome`.
  Existing companies/users were **backfilled as onboarded**, so current users are
  unaffected. Not yet exercised by a real new sign-up — test with a fresh Google
  account that isn't already provisioned.
- **Invitation acceptance now requires a verified email** (`provisionNewUser(emailVerified)`).
  OAuth/magic-link prove it; password only once confirmed. Turn **Confirm email ON**
  in Supabase to make the password path real (and so legit invited password users can
  join). Without it, unverified-invite joins are refused (safe) but blocked.
- **Company names are intentionally non-unique** — tenancy is keyed on id/slug, never
  name. A shared name grants no access.
- Schema changes ship as Prisma migrations (DARA-017 workflow); owner-only RLS/grants
  go through `prisma/security/apply-sql.ts`, never `db push`.

---

## 2. Queue for next session (suggested order)

### ★ Top of queue — Pass B: build the Color Review Cycle design
Implement `Color Review Cycle.dc.html` as the new solicitation workspace, **hybrid
approach** (pipeline UX, reuse the existing engine), on top of the restored holistic
engine. Scope (full design):
- **9-stage pipeline stepper** at the top (Solicitation · Compliance · Kickoff · Pink ·
  Red · Gold · White Glove · Compliance · Submit). Stages 4–7 (Pink/Red/Gold/White Glove)
  = color-team reviews → the holistic engine; stages 1–3/8–9 map to Documents/Compliance/
  Submit.
- **Per-stage workspace**: AI Review Findings panel + AI Engine sidebar (model/stats/
  overall score) + Analysis Log + "Accept Findings & Advance" gate.
- **Multi-volume Compliance Matrix** view (Technical/Management/Price/Past-Perf columns,
  Met/Partial/Gap/Not-Started status — maps to `complianceStatus`).
- **Amendment workflow** view (intake → impact assessment → material? gate → revise).
- Sidebar reorg (Proposals list, Tools).
Design tokens already match the app (IBM Plex, `--c-*` vars, accent `#3b6ef0`). Reference
HTML: `…/scratchpad/ColorReviewCycle.html`. New concepts in the design that have **no
schema yet** (stage scheduling, advance-gate state, analysis-log/comments) — decide
per-piece whether to persist or present; confirm scope before adding tables.

### A. Operator actions — browser/CLI (you)
1. **Branch protection on `main`** (BUILD_STATUS #13 — the only thing keeping
   DARA-015 from "enforced"): GitHub → Settings → Branches → require the Security
   checks + CodeQL, block force-push/deletions.
2. **Supabase Auth** (BUILD_STATUS #1): set **Site URL** = `https://dara.crucibleinsight.com`
   (+ redirect allow-list) so invite/confirm links resolve in prod; turn **Confirm
   email ON** (makes the password-path verification gate real). Optional: Custom SMTP
   to brand the "from" line; edit the **Invite user** / **Confirm signup** templates.
3. **Move the platform Anthropic key into the console** (BUILD_STATUS #14): Application
   Admin → Platform AI → paste key + pick model → Save; then retire
   `PLATFORM_ANTHROPIC_KEY` from Vercel.

### B. Verify in prod
- The full **onboarding** flow with a brand-new Google account (should land on
  `/onboarding`; existing accounts won't).
- **Billing** page renders (prod has `STRIPE_PUBLISHABLE_KEY` but the client reads
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — confirm).
- A real **review run end-to-end on a fresh review** — confirms the restored holistic
  model: rich per-factor assessments in the **Review** tab + the pass/fail sweep setting
  statuses in the **Compliance** tab. (Mark Section M items **Scored** first.)

### C. Feature backlog (security-adjacent)
1. **Per-company admin audit-log viewer** — `dara_audit_log` is per-company; build a
   read-only, company-admin-gated viewer (filter by actor/action/date, export) with a
   home on the Team page. Reuse `prismaAdmin` scoped by `companyId`.
2. **AI codebase security-audit** (back-office, app-admin only) using the platform
   Anthropic key → findings that feed the register.

### D. Product backlog (§5 of BUILD_STATUS)
- Reporting phase 2 (weighted Compliance Matrix + PDF/CSV export).
- Evaluation robustness (JobQueue + Vercel Cron worker; per-criterion persona).
- Billing polish (`starter`→"Base" label; handle `subscription.paused`).

---

## 3. Offline / non-code follow-ups
- **ZDR agreements** on platform LLM keys (Anthropic DPA+ZDR primary; OpenAI ZDR on
  approval; Google paid/Vertex ZDR). On signing, update the platform-mode CUI notice
  copy (DARA-007). Tracked in `prisma/security/DARA-007-data-boundary.md`.

---

## 4. Fast restart commands
```bash
git status                 # expect clean main
git log --oneline -6
pnpm install               # if needed
pnpm exec tsc --noEmit     # typecheck
pnpm build                 # full build
# New dara_* table/column? DB BEFORE deploy:
#   pnpm prisma migrate deploy
#   npx tsx prisma/security/apply-sql.ts prisma/security/<new>_rls.sql
# deploy: vercel deploy --prod --yes  then  git push
```
