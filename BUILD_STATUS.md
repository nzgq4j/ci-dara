# DARA — Build Status & Decisions

_Last updated: 2026-07-06_

**Production:** https://dara.crucibleinsight.com (alias: https://ci-dara.vercel.app)
**Vercel project:** `crucible-insight/ci-dara` · **Branch:** `main` · last DEPLOYED code `6eeb625` (`dpl_DcLvK6wz4VAzSjguZydca3dcXTCU`)
**Deploy method:** GitHub→Vercel auto-deploy is **not firing**; deploys are done manually via `vercel deploy --prod --yes` after `git push`. (See §4.)
**Stack:** Next.js 14.2.35 (App Router) · Prisma 7 · Supabase (Postgres + Auth + Storage + MFA) · Stripe · Vercel

> **Start-here for the next session is `SESSION_HANDOFF.md`** (deploy model, gotchas, backlog, key files).
> **Top priority next: the security backlog** — `SECURITY_BACKLOG.md` (untracked; findings unified to
> `DARA-021..045`, prior hardening intact). DARA-025 BOLA (code) + DARA-022/023 (operator). Invites now WORK.
> **Two operator dashboard steps pending:** enable Supabase Manual Linking + paste the 12 email templates.

---

## 0. Latest session (2026-07-06, night) — invites verified + account self-service + avatars + dept editor + email templates

Commits `21fcae9` → `6eeb625`, both DEPLOYED to prod. **One prod migration** (`20260707000000_user_avatar`,
additive `avatar_url` on `dara_users` — existing RLS/grants cover it) + **new public Storage bucket
`dara-avatars`** (`scripts/create-avatars-bucket.mjs`). Full detail in `SESSION_HANDOFF.md` §2.0; memory
`account-self-service.md`.

- **Invite dead-link diagnosed + fixed (DARA-045 link side closed).** The link came back as Supabase's default
  *implicit flow* — session in the URL `#fragment` on `/signin/...`, unreadable by any server route (ours read
  `?token_hash=` / `?code=`). Fix was **operator config (Option A)**: Site URL = bare origin, redirect allowlist
  `…/**`, and the branded token_hash "Invite user" template pasted in. Delivery via **Resend Custom SMTP**.
  A test invite now lands on `/welcome` signed in. See §8 of the handoff.
- **Account self-service** — new `/app/account/profile` (sidebar "Profile"): edit display name + avatar,
  set/change password (fixes OTP-invited users with no password), link/unlink Google (`linkIdentity`). Audited.
- **Avatars** — shared `components/dara/Avatar.tsx`, shown in the sidebar, **Teams member list**, and welcome
  screen (uploaded preferred over OAuth picture). Public bucket, service-role upload w/ magic-byte checks.
- **Per-solicitation department editor on the LIST** — `DepartmentEditor.tsx` modal + `setDepartmentsAction`
  (`app/app/solicitations/page.tsx`), gated **admin + creator**; mirrors the Overview-tab card.
- **12 branded Supabase email templates** in `supabase/templates/` (+ README slot map) — confirm-signup,
  magic-link, email-change, recovery, reauthentication, 7 security notices; all links use `/auth/confirm`.
  **Must be pasted into the dashboard to take effect.**
- ⚠️ **Pending operator (Supabase dashboard):** enable **Manual Linking** (for "Connect Google"); paste the
  **12 email templates**.

## 0b. Prior session (2026-07-06) — security fixes, 2FA, legal/TOS, invites, auth-link flow

Commits `258a5eb` → `1754cf6`; deployed through `2e2e74c` (last two commits = register text only). **Two prod
migrations applied** (`20260706000000_user_mfa`, `20260706010000_user_legal_acceptance` — both additive on
`dara_users`, existing RLS/grants cover the new columns). Highlights:

- **Security quick-wins** (`258a5eb`) — DARA-026 (`getDaraUser` fail-closed on `isActive` + `findDaraUserRaw`
  for the layout's AccountDisabled screen), DARA-027 (sol-delete `removeStored`s all CUI blobs), DARA-028
  (CSV formula/DDE injection escaping), DARA-030 (audit exports + pass re-runs), DARA-034 (cron `CRON_SECRET`
  mandatory in prod). **Unified the findings register: `SEC-01..23` → `DARA-021..045`.**
- **TOTP 2FA — DARA-031** (`8fed6c3` + onboarding `a5e1d9e`) — Supabase-native MFA (AAL2), chosen over a
  hand-rolled parallel TOTP (which on Supabase would sit beside the real session and be bypassable). Opt-in
  `/app/account/security`, challenge `/auth/2fa-challenge`, middleware AAL2 gate on `/app`, bcrypt backup
  codes + signed httpOnly recovery marker, optional onboarding step. Supabase stores the secret (no secret
  column, no crypto util, no new env). **Opt-in, not enforced.** See `mfa-totp.md`.
- **Legal / TOS** (`9418c7e`) — required onboarding "Agreement" step + `/app/account/legal` viewer. Source
  `.docx` in `public/legal/` → `node scripts/gen-legal.mjs` → `utils/dara/legal-content.ts` (v1.0). Acceptance
  writes `dara_users.tos_*` + immutable `legal.accept` audit (version/name/IP). Plain-text render (no
  innerHTML). See `legal-tos.md`.
- **Team invite Resend** (`18000bb`) + **branded invite email** (`e2a9b11`) — but delivery is blocked
  (DARA-045, below).
- **ChromeGate fix** (`5e0aa4b`) — marketing navbar/footer no longer bleeds onto `/auth/*`, `/onboarding`,
  `/welcome` (the `/auth/2fa-challenge` bar). Bares `/app`, `/signin`, `/auth`, `/onboarding`, `/welcome`.
- **Auth email-link flow** (`2e2e74c`) — invites failed (`otp_expired`) because `/auth/callback` only does
  the PKCE `?code` exchange, which doesn't work for admin invites (no browser verifier). Added `/auth/confirm`
  (`verifyOtp` token_hash); shared provisioning in `utils/dara/auth-finalize.ts`; invite template link now
  targets `/auth/confirm`; invite-send errors logged + surfaced.
- **⚠️ DARA-045 (deferred by user):** team invites don't reliably email on Supabase built-in email — "rate
  limit exceeded" + can't re-send to an already-registered address. Link side fixed; delivery is the blocker.
  Real fix = code-owned email via **Resend** + `admin.generateLink`. See SESSION_HANDOFF §8.

### Later same day (2026-07-06, evening) — compliance-matrix reliability + New Solicitation path picker

Commits `6b12d74` → `c282963`; deployed through `c282963` (`dpl_AgrHPtXNWN…`). **Code-only, no migrations.**

- **Shred (compliance-matrix generation) timed out on dense RFPs → empty matrix + infinite poll** (`c282963`).
  Observed on sol 18/19: the workspace hammered `/app/solicitations/<id>?_rsc=…` forever. Root cause = the shred
  made **one** AI call requesting up to **16000** output tokens; on a requirement-dense RFP that generation ran
  past the **240s** provider timeout (`utils/dara/providers.ts` `AI_TIMEOUT_MS`), was aborted, threw before any
  row was written, and left the JobQueue row stuck `running` — so `isShredActive` stayed true and the page
  polled endlessly (matched a prior manual clear of an "orphaned shred blocking the workspace poll"). **Not a
  regression** — the shred path was unchanged since the last good shred; it's a latent single-call scaling
  limit, output-bound (requirement density), NOT input-size (input is capped at 50k words). Fixes:
  (1) `utils/dara/requirements.ts` — `SHRED_MAX_TOKENS` **16000→8000** so a call finishes under 240s; the shred
  is now **resumable across worker ticks** (first tick full-extracts, later ticks skip it and only run gap
  passes), returns `exhausted` (dry gap pass or the new **800-requirement** cap), and the worker requeues while
  `!exhausted` so a dense RFP is fully mined across ticks instead of one mega-call.
  (2) `utils/dara/passes.ts` — `reapOrphanedJobs` fully wrapped in try/catch (queue read, each per-job update,
  trailing resets) so a transient DB error can't abort the reap/drain; for shred/compliance/reconcile jobs,
  failing the JobQueue row is what releases the `isShredActive`/`isComplianceCheckActive` poll.
- **Compliance-check (grading sweep) could loop forever** (`6b12d74`). `mapDetermination` wrote any AI
  determination that wasn't an exact lowercase token back to `not_assessed`, so `runComplianceJob`'s
  `res.checked===0` stall guard never tripped → the job requeued every tick. Now `mapDetermination` normalizes
  case/whitespace/hyphens and maps unknowns to `partial` (terminal); `runComplianceJob` terminates on **actual
  net progress** (not-assessed count before vs after the tick). Files: `utils/dara/evaluator.ts`, `passes.ts`.
- **New Solicitation — review-path picker** (`6b12d74`, `components/dara/UploadAndReview.tsx`). The FIRST screen
  is now two explanatory cards — **Direct AI** vs **Color Team** — chosen before the sol is created. Direct AI
  uploads a response draft during creation; Color Team hides the proposal dropzone (drafts attach per-review
  later). Replaces the buried "Advanced → Switch to Color Team" checkbox; `mode` still threads to `createSolShell`.
- **Signin footer copyright** (`2ceb0ce`) — "© 2026 Crucible Insight LLC" → "© 2026 The Daniel Group LLC".
  (Privacy/TOS pages still say "Crucible Insight LLC" — not yet reconciled; invite email uses "The Daniel Group
  LLC d/b/a Crucible Insight".)

### Prior session (2026-07-05, late) — exports, trial fencing, personas, security re-audit

Commits `bf72353` → `7fe23ab`, all deployed + verified on prod. Highlights:

- **PDF export 500 fixed** (`bf72353`) — multi-page Analysis Report PDFs crashed (`unsupported number`) on
  large sols (sol 13, 127 findings/33 pages): a `fixed` react-pdf element with a `render` callback + auto
  height compounds its box height per page. Fixed via explicit height. `components/dara/ReportPdf.tsx`.
- **Trial enforcement wired** (`20fcccb`) — `utils/dara/trial.ts` existed but nothing called it; gated
  createSolShell / inviteUser / enqueueReviewRun + enqueueDirectReview (**review gate = first run only**),
  Run button disabled at limit, dashboard trial bar. Paid plans no-op.
- **`CRON_SECRET`** set in all Vercel envs + prod redeploy → `/api/cron/passes` 401 without bearer (verified).
- **Real `.docx` compliance-matrix export** (`c39c1d1`) — `docx` lib (`utils/dara/matrix-docx.ts`), base64 via
  the export action; replaced the HTML-as-`.doc` trick. `docx` added to `serverComponentsExternalPackages`.
- **Per-review response upload + amendments drag-drop** (`e80fe0e`) — color-team reviews upload their own
  response draft (`uploadReviewDoc`→`ReviewDocument`); "Capture draft"/auto-snapshot removed; sol-level
  proposal upload now Direct-AI-only; amendments use `DocUploader`. Deleted `utils/dara/reviews.ts`.
- **Annotated response `.docx`** (`d25fcfd` + anchoring fix `4e231ec`) — proposal draft exported with each
  finding as a real inline Word comment, anchored via one export-time AI call (no schema/re-run).
  `utils/dara/annotated-proposal.ts` + `/annotated` route + `AnnotatedExportButton`. `docx@9.7.1` has native
  comment support; the Document `comments` option takes plain option OBJECTS, not `Comment` instances.
- **Personas reintegrated as an AI review lens** (`f9f89c4`) — `renderPersonaGuidance` injects selected/active
  personas' `systemPrompt` into `buildPassPrompt`/`buildDirectReviewPrompt` (augment, not override). They had
  fallen out entirely (engines used zero persona input; legacy per-persona evaluator still dead). See memory
  `personas-review-lens.md`.
- **CMMC L2 security re-audit** (6 parallel domains) — prior DARA-001..019 hardening HOLDS, 26/26 RLS intact,
  no regressions. Net-new gaps SEC-01..23 in **`SECURITY_BACKLOG.md`** (root, **untracked — do not commit
  while open**). **SEC-04 FIXED** (`7fe23ab`): annotated-export CUI→LLM egress now audited (`annotated.export`,
  provider/mode) + fenced. Top open: SEC-01 rate limiting/WAF, SEC-02 Next 14→15 CVEs, SEC-03 CI-not-blocking,
  SEC-05 cross-department BOLA, SEC-06 deactivated-users-keep-access, SEC-07 sol-delete storage orphan.

### Prior session (2026-07-04 → 07-05) — Direct-AI polish, reliability, billing
Commits `f087ac3` → `5d491ea`, all deployed. Highlights:

- **Direct AI create flow fixed** — split into per-file uploads (`createSolShell` + `uploadDocToSol`
  + `finalizeReview`); a single bundled POST hit Vercel's ~4.5 MB Function body cap. + transient-DB
  retry + real error surfacing. (memory `create-flow-body-size.md`)
- **Solicitation Analysis Report** shipped — `/app/solicitations/[id]/report`, the 4th/last mockup.
  Migration `20260704020000` (Finding owner/effort/status; Review/DirectReview recommendation/
  submit-date/checklist). AI now emits owner/effort per finding + a holistic recommendation + checklist.
- **Worker/LLM reliability** — `AI_TIMEOUT_MS=240s` (⚠️ don't lower — 120s silently emptied the
  compliance matrix), shred time-boxing, pg connection/statement timeouts, worker throws on failed shred.
- **Workspace perf** — split the giant `[id]` page query into parallel scoped reads; `usePollRefresh`
  pauses polling when the tab is hidden (killed the 300s-timeout `?_rsc` storm); **compliance sweep now
  grades 4 batches concurrently** (107 reqs in ~82s).
- **Delete solicitation** moved to the central Solicitations list (confirm-guarded), works for both modes.
- **Billing management** — `/app/billing` shows live Stripe subscription details, **actual next charge
  via `retrieveUpcoming`** (net of discount/credit/tax), invoice history w/ PDFs, and a trial usage card.
- **Compliance-matrix sync works on the Direct path** — `syncMatrixFromPasses` branches by mode
  (DirectReview findings vs. color-team pass).

**Open backlog (hardest first):** SAM.gov import (needs API key) · trial enforcement (gate create/run →
billing) · DOCX matrix export · rename-from-list / `CRON_SECRET`. The full reskin + all 4 mockups are DONE.
**Deep backlog:** annotated proposal export — regenerate the response doc as `.docx` with **Word
comments** anchored where the AI suggests changes (OOXML comments; anchor-span location is the hard part).
See `SESSION_HANDOFF.md` §4.

---

## 1. Summary

The app was migrated to a new Supabase project, its (previously never-passing)
build was fixed, the DARA persona + evaluation engine was ported from the
WordPress plugin and wired end-to-end, and admin/billing and a prototype-matched
UID redesign were added. The app builds green and is deployed to production.
The UI redesign was then completed across all pages, and a full NIST 800-171 /
CMMC L2 / OWASP **security audit** was performed (2026-06-27) with an in-app
Security page and the first wave of remediations shipped (see §3 / §5).

The product was then **reframed from source-selection (scoring competing offerors) to
proposal development (color-team gate reviews of the company's own proposal)** across three
shipped phases — Requirements/Compliance, Color-team reviews, Amendments + AI reconciliation
(§2). The evaluation model settled on **holistic review of the evaluation factors + a lean
pass/fail compliance-matrix sweep of the administrative requirements** (⭐ §2, 2026-07-01) —
after a course-correction away from an interim compliance-heavy checklist. The pipeline UI was
then built, and — most recently — the review engine was reworked into a **3-pass async AI
review** per the imported `DARA.dc.html` design (Pass 1 Compliance & Format → Pass 2 Technical
Responsiveness → Pass 3 Risk & Competitive), with requirement **disposition** classification,
compliance-matrix export/sync, dashboard pass badges, and multi-pass shred/amendment coverage
(§7 "multi-pass session"). Next major work is the **full navy/gold visual reskin** (deferred).
The underlying review methodology is **never named** in UI/prompts/code/docs.

---

## 2. Key decisions (with rationale)

| Area | Decision | Why |
|------|----------|-----|
| **Prisma 7 runtime** | `@prisma/adapter-pg` driver adapter, constructed with `DATABASE_URL` | Prisma 7 no longer reads the datasource URL from the schema/`prisma.config.ts` at runtime; a driver adapter is the supported path. `prisma.config.ts` now loads the CLI datasource URL from env (`DIRECT_URL`) — no longer hardcoded (fixed DARA-001). |
| **PDF extraction** | `unpdf` (not `pdf-parse`) | `pdf-parse` v2 works locally but fails in Vercel's serverless runtime (pdfjs worker/asset tracing). `unpdf` ships a worker-free serverless pdfjs build. DOCX still uses `mammoth`. |
| **Auth provisioning** | Call `provisionNewUser` on email+password sign-in too | Provisioning previously only ran in `/auth/callback` (OAuth/magic-link), so password users had "no account information". |
| **Admin model** | **Application Admin** = company-less platform operator (`dara_platform_admins`), DB-backed and bootstrapped from `PLATFORM_ADMIN_EMAILS`; company admin via `UserRole = company_admin` | Formalized 2026-06-30. Separation of duties (CMMC AC-5/AC-6): an app admin manages accounts/users/platform settings but has **no tenant context → no CUI**, by construction. Env-listed emails are auto-provisioned and can't be removed in-app (bootstrap root). **Behavior change:** an email in `PLATFORM_ADMIN_EMAILS` no longer gets a company workspace — use a separate account for company/CUI access. |
| **Platform AI config** | Platform LLM keys (encrypted) + central provider/model live in a singleton `dara_platform_settings`, edited **only** in the Application Admin console; platform-mode evaluations resolve from it (a console key overrides the `PLATFORM_*_KEY` env fallback) | 2026-06-30. One place to manage platform keys + model; `resolveCompanyAI(company, platform)` uses the central provider/model/key in platform mode. **Non-BYOK (platform) accounts have NO per-account key/model choice** — the company Settings AI form hides the provider/model/key inputs on platform mode and shows the admin-set model read-only; those inputs appear only in BYOK mode (`app/app/settings/CompanyAIConfig.tsx`). Env keys remain a transition fallback until moved into the console. |
| **Evaluation output + sections** | Each result returns a structured **review summary** (how the review was made / what was reviewed / measured against, with citations to specific tasks/requirements), a formatted **Assessment** (rationale), then **strengths / weaknesses / compliance / suggested-changes-with-rationale**. A "section" = one criterion's result: regeneratable in place (snapshot → `dara_result_versions`, `regenCount` bumped), archivable (`archivedAt`, never deleted). Output budget raised to 8000 tokens. | 2026-06-30. Per-criterion granularity gives finest control. Runs stay **synchronous** with a live progress indicator (RunPanel) + a running-count banner that auto-refreshes; async JobQueue+cron deferred. The review-summary addition first truncated JSON at the old 4096 cap, then over-suppressed `suggested_changes` — both fixed (8000 tokens; prompt requires a suggested change per weakness). |
| **Onboarding** | New `Company.onboardedAt` + `DaraUser.onboardedAt` gate. Org creator (un-onboarded company + `company_admin`) → 6-step wizard `/onboarding` (prefilled from Google OAuth); other un-onboarded users → one-screen `/welcome`. Existing rows backfilled as onboarded | 2026-06-30. New sign-ups set up their workspace before the dashboard; invited members get a light welcome once. Gate lives in `app/app/layout.tsx`; wizard/welcome live outside the `/app` shell. |
| **API keys at rest** | AES-256-GCM (`utils/dara/crypto.ts`) keyed off `APP_KEY` | BYOK keys must be encrypted; the WP `Crypto` class was not portable. |
| **Stripe checkout** | Custom plan cards → Stripe Checkout Session (promotion codes enabled) | User chose custom cards over the hosted pricing table; coupon support needed for testing. |
| **Stripe billing model** | Webhook syncs to the Prisma `Company` (`plan/planStatus/stripeCustomerId/stripeSubId`) | That's what the app's trial gating / admin actually read; the Supabase template billing tables were dropped. |
| **Stripe environment** | Live keys, tested with a coupon | User opted to run against live as-is. |
| **Webhook endpoint** | `https://dara.crucibleinsight.com/api/webhooks` | Canonical custom domain (matches `NEXT_PUBLIC_SITE_URL`); both domains are Vercel-served. (A trailing-dot typo in the Stripe endpoint URL was the cause of the first failed sync.) |
| **Plan↔price map** | Base=$150 `price_1Tm7jq…`, Pro=$399 `price_1Tm7kH…`, Enterprise=$899 `price_1Tm7kr…` | Existing live Stripe catalog. `starter` plan is labelled **"Base"** in the UI. |
| **UI design system** | Port `DARA App Prototype.dc.html` (from the claude.ai design project via DesignSync) | IBM Plex fonts, accent `#3b6ef0`, layered dark palette, 220px sectioned sidebar, full-screen app shell (marketing chrome gated off `/app`). |
| **Security standards** | NIST SP 800-171 r3 / 800-53 r5 / CSF 2.0 / CMMC 2.0 L2 / OWASP as **standing guidance for all future builds** | App handles likely FCI/CUI; small-business contractor targeting CMMC L2 readiness. Saved to agent memory. |
| **Tenant isolation (DB)** | Revoke `anon`/`authenticated` on `dara_*` + enable RLS as a deny-by-default backstop; app keeps connecting as the `postgres` owner (BYPASSRLS) | Closed the confirmed anon-key REST exposure with zero app risk. Full per-tenant RLS policies + a least-privilege role (DARA-004) deferred — they require a per-request `company_id` GUC and Prisma transaction refactor. |
| **In-app Security page** | `/app/security`, themed; standards + control posture visible to all signed-in users, **detailed findings gated to platform admins** | Keeps reports visible (per request) without publishing exploit detail; severity cards count open findings + a remediated tally. |
| **Deploy workflow** | Manual `vercel --prod` after push | GitHub→Vercel auto-deploy stopped firing (last git-triggered build `4512262`); manual deploys are the interim path until the Git integration is reconnected. |
| **Schema migrations** | Tracked Prisma migrations (`migrate dev`/`deploy`), **not** `db push`. Owner-only security DDL (RLS/grants/roles/audit) stays in `prisma/security/*.sql` via `apply-sql.ts` | DARA-017 baseline. Two-layer source of truth: Prisma migrations = table structure; owner-SQL = RLS/grants Prisma can't model. New `dara_*` tables are fail-closed for the runtime roles until granted, so each migration ships with a paired RLS file. No local DB, so new migrations are generated offline via `migrate diff` (committed schema → edited schema) and applied with `migrate deploy`. |
| **Teams / departments model** | `Team` (`dara_teams`) per company; `TeamMember` join with a per-team `UserRole`; `Invitation` (`dara_invitations`) email-invite with `pending/accepted/revoked/expired` | `DaraUser.role` stays the **company-level** role (the `company_admin` gate); per-team role lives on `TeamMember`. The Team UI presents one department per user (single-select); schema stays multi-capable. |
| **Invitations / join flow** | `provisionNewUser` matches a pending invite by email and attaches the user to that company + team with the invited role on first sign-in; else creates a new company (prior behavior) | Previously every signup made a one-person company — there was no way to join an existing one. Invite emails are Supabase-sent; the invite **row** is the source of truth, so joining works via sign-in even if email isn't configured. |
| **Solicitation visibility** | Solicitations assignable to **multiple departments** (`dara_solicitation_departments`). Rules: `company_admin` sees all; **creator** always sees own; others see only via an assigned department; unassigned ⇒ admins + creator only | Department-scoped authorization within a tenant. **Enforced app-layer** (`utils/dara/sol-access.ts`): list/dashboard queries filtered; the detail gate (`requireViewableSolicitation`) covers the page + every mutation, so child data (docs/criteria/offerors/evaluations) is covered transitively. Company-level RLS remains the DB backstop; DB-level department RLS is a deferred hardening. Assign rights: admins + creator. |
| **Product reframing → color-team reviews** | DARA reframed from source-selection (score competing **offerors**) to proposal development (**color-team gate reviews** of the company's *own* proposal as it matures). One solicitation → one or more reviews. The underlying methodology is **never named** in UI/prompts/code/docs. Decided 2026-06-30; **all three phases SHIPPED 2026-06-30**: Phase 1 Requirements/Compliance, Phase 2 Reviews (color teams), Phase 3 Amendments (AI reconciliation). Tabs: Overview · Documents · Compliance · Amendments · Color Teams · Review. | Decisions: (1) unify evaluation factors + requirements into one `Requirement` model (Compliance tab); (2) snapshot the proposal draft per review; (3) freeform reviews, color is a label, behavior from chosen personas; (4) full AI amendment reconciliation (diff → proposed changes → approve → versioned matrix). |
| **Color-team reviews (Phase 2)** | `Response`→`Review` (`dara_responses`→`dara_reviews`; `offeror_name`→`name` + `color_team` label, `status`, `snapshot_at`), `ResponseFile`→`ReviewDocument` (per-review frozen draft snapshot), new `ReviewPersona` (chosen reviewers), `SolDocument.doc_type` (rfp/amendment/proposal). `Evaluation.response_id` remapped to `reviewId`. | The proposal working draft lives on the solicitation (`doc_type=proposal`); each review freezes it (`captureSnapshot`, `utils/dara/reviews.ts`). A run uses the review's chosen personas (fallback all active) vs the snapshot; shred/evaluator scope `doc_type=rfp`. DB columns kept where remapping avoids churn. |
| **Amendments + AI reconciliation (Phase 3)** | New `Amendment` + `AmendmentChange` (proposed add/modify/remove) + `RequirementVersion`; `Requirement` gains amendment provenance (`removed_at`, `*_by_amendment_id`, `version`); `SolDocument.amendment_id`. **Amendments tab**: upload amendment doc → "Reconcile with AI" diffs it vs the matrix → accept/reject proposed changes. | Accepting folds into the matrix: add → new requirement; modify → version prior values + update in place; remove → `removed_at` (retained, struck). `utils/dara/amendments.ts` (`reconcileAmendment`, `applyAmendmentChange`) + `buildAmendmentDiffPrompt`/`parseAmendmentDiff`. Reviews snapshotted before an applied amendment are flagged **pre-amendment** (re-capture & re-run). |
| **Requirements / Compliance matrix (Phase 1)** | `Criterion` evolved into **`Requirement`** (`dara_criteria`→`dara_requirements`): `source` (Section L instruction / M factor / SOW-PWS / FAR clause / other), `isScored`, `complianceStatus`, `proposalRef`. The **Compliance tab** replaces Criteria and adds an **AI shred** ("Generate from solicitation") that turns the RFP docs into a requirements list. | Requirements are the structured backbone every review scores/tracks. `dara_results.criterion_id` column kept (Prisma field remapped to `requirementId`) so the FK/unique index are untouched. Old `criterion_type` migrated into `source`+`isScored`. Table rename preserves RLS; DARA-004/005 source files updated for rebuilds + `2026-07-01_requirements_rls.sql`. |
| **⭐ Review model: HOLISTIC evaluation + compliance matrix** (2026-07-01, commit `8125fd1`) | A color-team review run does **two** things: **(1) holistic review** — the full structured assessment (review summary incl. what-it-was-measured-against + how-scored, rationale, strengths, weaknesses, compliance commentary, suggested improvements, score/rating) per **evaluation factor** (`isScored=true`), from each persona's perspective (rich `buildUserPrompt`/`parseResult`, `runEvaluation` scoped to `isScored`); **(2) compliance sweep** — `runComplianceSweep` runs a lean pass/fail determination over the **administrative** requirements (`isScored=false`) and sets each `complianceStatus`. | Course-correction: an interim "compliance-heavy" batching (`3e410a2`) turned the whole review into a lean per-requirement checklist over all 125 shredded items — wrong. The review must stay a **holistic evaluation** of the few scored factors; the pass/fail bulk belongs in the matrix. `isScored=true` → holistic; `isScored=false` → matrix. No schema change. **Do not** regress to the checklist model. |

---

## 3. Completed

### Infrastructure / migration
- New Supabase project `djcgfejogflbqaqtuhtk`; all connection strings + keys in
  `.env.local` and Vercel: `DATABASE_URL`, `DIRECT_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `PLATFORM_ANTHROPIC_KEY`,
  `APP_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Schema originally applied via `prisma db push`; **now baselined to tracked
  migrations** (`prisma/migrations/0_init`, DARA-017). Build runs `prisma generate`
  only; pg driver adapter. Forward schema changes use `migrate dev`/`deploy`.
- Private Supabase Storage bucket `dara-documents`.
- Seed login user `david@crucibleinsight.com` (pre-confirmed).

### Build fixes (pre-existing breakage)
- Supabase client typing across `@supabase/ssr` / `supabase-js`; lazy admin
  client; `prisma generate` in the build script; client BigInt/Date no longer
  passed to the client `Header` (fixed a client-side exception on mutations).

### Features
- **Solicitations**: list, create, detail with full CRUD on criteria & offerors.
  **Department-scoped access**: assignable to multiple departments (create form +
  detail Overview "Departments" card); visibility per the access rules (admins all,
  creator own, others via assigned department). Enforced app-layer in
  `utils/dara/sol-access.ts` + the detail gate; list/dashboard scoped to match.
- **Personas** (`/app/personas`): 5 built-ins auto-seeded; full CRUD + active toggle.
- **Evaluation pipeline** (`utils/dara/`): prompt builder, providers
  (Anthropic/OpenAI/Google + platform/BYOK resolution), evaluator, document
  upload + extraction (unpdf/mammoth), per-offeror **Run evaluation**
  (synchronous, `maxDuration=300`), results view.
  - **Structured findings (2026-06-30):** every result returns formatted
    **strengths**, **weaknesses**, **compliance**, and **suggested changes**
    (each with a rationale) alongside the score/determination. Schema +
    instructions in `prompt.ts`; stored in `Result.ai_{strengths,weaknesses,
    compliance,suggested_changes}`; rendered by `components/dara/ResultFindings.tsx`.
  - **Review summary + Assessment (2026-06-30):** each result opens with a
    **Review summary** (`ReviewSummary.tsx` ← `Result.ai_review`): how the review
    was made / what was reviewed / measured against — the prompt requires citing
    specific tasks/requirements (PWS/SOW, Section L/M, FAR). The rationale renders as
    a formatted **Assessment** card with numbered findings (`RationaleBlock.tsx`).
  - **Progress + completion (2026-06-30):** `RunPanel.tsx` shows a live
    "Evaluating… (N personas)" spinner + a completion notice (runs are synchronous);
    `RunningBanner.tsx` shows the in-progress count and auto-refreshes while any run.
  - **Regenerate / archive by section (2026-06-30):** per-criterion **Regenerate**
    (snapshots the prior values into `dara_result_versions`, bumps `regenCount`, shows
    a History(N) log) and **Archive/Restore** (`archivedAt`, retained — no delete).
    `ResultCard.tsx`; logic in `utils/dara/evaluator.ts` (`regenerateResult`,
    `setResultArchived`). All these fields populate on the **next** run/regenerate.
- **Compliance matrix** (`/app/solicitations/[id]` → **Compliance** tab, Phase 1 of the
  color-team reframing): `Requirement` rows (`dara_requirements`) shredded from the
  solicitation via AI ("Generate from solicitation", `utils/dara/requirements.ts`) or
  added manually. Each row carries a **source** (Section L instruction / M factor /
  SOW-PWS / FAR clause / other), **scored** flag + weight, **compliance status**
  (not-assessed/compliant/partial/non-compliant/N-A) and **proposal reference**; grouped
  by source with status-count pills. Replaces the old Criteria tab; evaluations now run
  per requirement. (Offeror→review rename + Color Teams/Review tabs are Phase 2.)
- **Settings** (`/app/settings`, company admin): AI config + encrypted BYOK keys.
  (Member/team management moved to the Team page; Settings links to it.)
- **Team** (`/app/team`, company admin): departments/sub-teams with per-team roles.
  Create teams; **invite members by email** (role + optional team) — a pending
  `dara_invitations` row + a Supabase invite email; the invitee is attached to the
  company + team with the invited role on first sign-in (provisionNewUser), instead
  of creating a new one-person company. Also manages company-level members (org-wide
  role + active, with a self-lockout guard) and per-team membership (add existing,
  change role, remove). All actions audited. New tables `dara_teams` /
  `dara_team_members` / `dara_invitations` under the DARA-004 RLS model.
- **Application Admin** (`/app/admin`, company-less platform operator — 2026-06-30):
  the formalized admin console. **Accounts** (plan/status/trial/AI config),
  **Users** (role · ban/unban · delete incl. Supabase auth removal),
  **Administrators** (grant by email · activate/deactivate · remove; env-pinned +
  self protected), and **Platform AI** (below). Separate company-less shell
  (`PlatformAdminSidebar`), no CUI. Identity in `dara_platform_admins`
  (`utils/dara/platform.ts`); login routes admins to `/app/admin` and never
  provisions a tenant; middleware + root keep them out of company routes. Banned
  (`isActive=false`) users get a terminal "account disabled" screen.
- **Platform AI** (`/app/admin#ai`, app admin only — 2026-06-30): the single place
  to set platform LLM keys (encrypted) + the central provider/model. Singleton
  `dara_platform_settings`; `utils/dara/{platform-ai,ai-catalog}.ts`. Platform-mode
  evaluations resolve from here; a console key overrides the `PLATFORM_*_KEY` env
  fallback. Model picker constrained to providers with a key.
- **Company** (`/app/company`, company admin — 2026-06-30, under the **Organization**
  sidebar group): edit company **profile** (name, legal name, website, phone, CAGE,
  UEI), **address**, and **CMMC/C3PAO assessment** (target level, status, assessor
  name/contact/email/phone, last-assessment + cert-expiry dates). 19 nullable columns
  on `dara_companies`.
- **Onboarding** (2026-06-30): `/onboarding` 6-step wizard for new org creators
  (welcome → profile → organization → AI mode → invite team → done), prefilled from
  Google OAuth; `/welcome` one-screen for invited members. `Company.onboardedAt` +
  `DaraUser.onboardedAt` gate in `app/app/layout.tsx`; existing rows backfilled.
- **Sign-in "Create Account"** (2026-06-30): replaced "Request access"; Google OAuth
  now offered on the create-account view (flows into onboarding); signup form
  restyled. Account creation still yields a trial `company_admin`.
- **Billing** (`/app/billing`): custom plan cards → Checkout (coupons enabled),
  Customer Portal; webhook → `Company` sync.
- **UI redesign (complete)**: foundation + shell (IBM Plex, accent, sidebar,
  full-screen app), **sign-in** (two-panel brand layout), **dashboard** (stat
  cards + recent activity + plan panel). `dara-logo.png` in sidebar/sign-in +
  favicon; company name under the DARA badge; `starter`→"Base" label.
  - Shared design primitives in `components/dara/` (`theme.ts` class vocabulary,
    `PageHeader.tsx`, `Tabs.tsx`) so every page draws from one token set.
  - **Solicitations list + new** aligned to the dashboard table/header style.
  - **Solicitation detail** rebuilt as tabs — Overview / Documents / Criteria /
    Offerors / **Matrix** (offeror × criterion score grid derived from
    evaluation results, plus detailed per-persona rationale cards). All server
    actions preserved; the `Tabs` shell keeps inactive panels mounted so form
    state survives tab switches.
  - **Personas, Settings, Billing, Admin** aligned to the shared cards, tables,
    status badges, and mono labels.

### Security audit & remediation (2026-06-27)
- **Audit** against NIST 800-171 r3 / 800-53 r5 / CMMC L2 / OWASP; ~20 findings.
  Rendered in-app at **`/app/security`** (`utils/dara/security-content.ts` is the
  single source of truth); detailed register gated to platform admins.
- **Remediated:**
  - **DARA-001 (Critical)** — DB credential removed from tracked `prisma.config.ts`
    (now env), **password rotated**, and **purged from git history**
    (`git filter-branch` literal scrub of both historical values + force-push).
  - **DARA-005 (Critical)** — confirmed the public anon key had full CRUD on all
    `dara_*` tables via PostgREST; **revoked** `anon`/`authenticated`, **enabled
    RLS** on 11/11 tables, blocked future default grants. SQL artifact:
    `prisma/security/2026-06-27_lock_dara_tables.sql`. Verified anon now gets 401.
  - **DARA-011** — security headers (CSP, HSTS, X-Frame-Options DENY, nosniff,
    Referrer-Policy, Permissions-Policy) via `next.config.js`.
  - **DARA-012** — server-side upload validation (allow-list, 20 MB cap,
    magic-byte checks, server-derived content type) in `utils/dara/documents.ts`.
  - **DARA-004 + DARA-003 (Remediated 2026-06-28)** — database-enforced per-tenant
    isolation. Three-role least-privilege model (`dara_app` non-BYPASSRLS runtime,
    `dara_admin` cross-tenant, `postgres` migrations-only) + per-tenant RLS policies on
    all 11 `dara_*` tables; app refactored to `withTenant()` (per-request `app.company_id`
    GUC), cross-tenant paths on `prismaAdmin`; production hard-fails if the role URLs are
    missing. Verified by `dara004-isolation-test.ts` (14/14) and live in production.
    Artifacts: `prisma/security/2026-06-27_dara004_rls_policies.sql`,
    `DARA-004-{scope,status,handoff}.md`. (Two cutover outages from a bad prod env value
    — host `base` — caught and rolled back; fixed by sourcing prod/preview vars from the
    verified `.env.local`.)
- **Partial / in progress:**
  - **DARA-006** — Next.js `14.2.3 → 14.2.35` (clears CVE-2025-29927 + 14.2.x advisories).
  - **DARA-008** — LLM prompt-injection hardening: untrusted doc/sol text wrapped
    in randomized fences + "treat as data, not instructions" guard (`prompt.ts`).
- **Prod outage fixed mid-effort:** after the DB password rotation, production 500'd
  because Vercel still held the old `DATABASE_URL`/`DIRECT_URL`; updated both prod
  env vars and redeployed. (Rotation runbook noted in §4.)

---

## 4. Known gaps / action items

1. **Supabase Auth email config (your action, dashboard).** Two settings, both in
   the Supabase dashboard, both affecting auth emails (confirmation/magic-link **and
   Team invite emails**):
   - **URL config:** Set Site URL = `https://dara.crucibleinsight.com` and add
     redirect URLs `https://dara.crucibleinsight.com/**`, `http://localhost:3000/**`.
     Until then the email links point at `localhost`. (Invitations still work without
     this — an invited person who signs in is attached correctly; only the convenience
     link breaks.)
   - **Sender "from" line:** the from name/address is **not** in our code — it's
     Supabase email config. The built-in service's sender is fixed; to brand it (e.g.
     `DARA <no-reply@crucibleinsight.com>`) enable **Custom SMTP** under
     Authentication → Emails → SMTP Settings and set **Sender name** + **Sender email**
     (verified domain on your SMTP provider). `supabase/config.toml` only affects the
     local dev stack, not prod.
   - **Subject/body:** Authentication → **Email Templates** → edit **Invite user**
     (Team invites via `inviteUserByEmail`) and/or **Confirm signup** (self-registration —
     the "Confirm your email address… finish signing up" copy). Vars: `{{ .ConfirmationURL }}`,
     `{{ .SiteURL }}`, `{{ .Email }}`. (Code-owned branded emails via Resend/SMTP are an
     alternative if you'd rather not use Supabase templates — not built.)
   - **Note (defense-in-depth, 2026-06-30):** invitation acceptance now requires a
     **verified email** (`provisionNewUser(emailVerified)`); OAuth/magic-link prove it
     inherently, password only once confirmed. Turning **Confirm email ON** in Supabase
     is what makes the password path's verification real. Without it, a pending invite
     for an unverified address is refused (no hijack), but a legit invited password user
     also can't join until confirmed — so enabling Confirm email is recommended.
2. **Stripe webhook endpoint** — confirm the URL has **no trailing dot** and add
   `customer.subscription.updated` to the subscribed events (created/deleted are
   there; updated is needed for plan changes/renewals). Activate the **Customer
   Portal** (Stripe → Settings → Billing) so "Manage billing" works.
3. **Live AI evaluation** verified to connect (manual `SELECT 1` + sync), but a
   full multi-criteria AI run hasn't been exercised end-to-end in the browser.
4. **Synchronous evaluation** can approach the 300s function limit on large
   solicitations; `JobQueue` table exists but is unused (future: cron worker). The
   per-section **Regenerate** is the interim escape hatch (re-runs one criterion).
   Output budget is `EVAL_MAX_TOKENS=8000`; the richer review+findings output can be
   verbose, so watch for truncation on unusually long criteria (raise if needed).
5. **Per-criterion persona assignment**, **Compliance Matrix**, **Reports/export**
   from the WP plugin are not ported yet.
6. No OCR for scanned/image-only PDFs.
7. `dara-logo.png` (~630 KB) is heavy for an icon; an optimized version would help.
8. **Vercel auto-deploy not firing (your action).** Reconnect the GitHub
   integration (Project → Settings → Git), confirm Production Branch = `main`,
   and check for an "Ignored Build Step". Until then, deploy via `vercel --prod`.
9. **Secret-rotation runbook.** Rotating the DB password (or any secret) requires
   updating the value in **Vercel env (all environments)** + redeploy — not just
   `.env.local`. Skipping Vercel is what caused the post-rotation 500s.
   - **DARA-004 role credentials.** Three DB roles, three secrets, by least
     privilege (NIST 800-171 03.01.05 / AC-6): `dara_app` (restricted runtime,
     `DATABASE_URL_APP`), `dara_admin` (cross-tenant runtime, `DATABASE_URL_ADMIN`),
     `postgres` (owner/DDL — migrations only, `DIRECT_URL`). To set/rotate the two
     new roles run `prisma/security/rotate-dara004-roles.sh` (reads passwords from
     shell env — no secrets in the script), then update the matching
     `DATABASE_URL_APP` / `DATABASE_URL_ADMIN` in **Vercel (all envs)** + `.env.local`
     and redeploy. `dara_app`/`dara_admin` are low-privilege and only need rotation
     on suspected compromise; routine rotation is still effectively just `postgres`.
10. **Unused `DARA_*` env vars.** A Supabase/Vercel integration added
    `DARA_POSTGRES_*` / `DARA_SUPABASE_*` vars that the code does not read. Either
    remove them or wire the app to the integration's pooled URL (more robust for
    future rotations).
14. **Move the platform LLM key into the console (2026-06-30).** Platform keys + the
    active model now live in **Application Admin → Platform AI** (`dara_platform_settings`,
    encrypted). `PLATFORM_ANTHROPIC_KEY` still works as a fallback (shown as "from env").
    To finish: paste the Anthropic key into the console + pick the model, then you may
    retire `PLATFORM_ANTHROPIC_KEY` from Vercel. (Optional model-catalog tweak:
    `utils/dara/ai-catalog.ts`.)
15. **`PLATFORM_ADMIN_EMAILS` is now `islanista@gmail.com` (2026-06-30).** `david@crucibleinsight.com`
    was removed from the env allow-list and its `dara_platform_admins` row **deleted**, reverting it
    to a normal user (company **"Proposal Foundry"**, `company_admin`). Current admins:
    `islanista@gmail.com` (env-pinned) + `admin@crucibleinsight.com` (DB). NOTE: `PLATFORM_ADMIN_EMAILS`
    is stored **Sensitive**, so `vercel env pull` shows it blank — use `vercel env add … --value … --force`.
    **Gotcha that bit us:** the in-console **Deactivate** is blocked while an admin is still env-pinned,
    so david's row stayed `active=true`; and `resolvePlatformAdmin` treats an **active row as admin
    regardless of the env list** — so removing from env alone is not enough. To fully demote: remove
    from `PLATFORM_ADMIN_EMAILS` **and** delete (or deactivate) the `dara_platform_admins` row.
11. **Open security findings.** The original DARA-001..019 register is closed (DARA-007 risk-accepted).
    **A 2026-07-05 CMMC L2 re-audit of the new surface (exports, /annotated, per-review upload, personas,
    trial) found net-new gaps SEC-01..23 — see `SECURITY_BACKLOG.md` (untracked).** Prior hardening holds
    (26/26 RLS, no regressions). SEC-04 fixed; top open = SEC-01 rate limiting, SEC-02 Next 14→15, SEC-03
    branch-protection/CI-gated-deploy, SEC-05 BOLA, SEC-06 isActive, SEC-07 sol-delete storage orphan.
    Original register detail on `/app/security`. Latest original closures:
    **DARA-017 (migration history) Remediated 2026-06-29** (prod baselined to
    `prisma/migrations/0_init`; two-layer schema source of truth documented in
    `prisma/security/DARA-017-migrations.md`; legacy drift verified already gone) and
    **DARA-002 (secrets handling) Remediated 2026-06-29** (platform-as-source-of-truth;
    redundant `.env` + dead vars removed; rotation runbook —
    `prisma/security/DARA-002-secrets.md`). Everything else remediated as of
    2026-06-28 (incl. DARA-010 admin model and DARA-015 CI gates — see action item
    #13 to enforce them via branch protection).
13. **Enable branch protection on `main` (your action — closes DARA-015 enforcement).**
    GitHub → repo **Settings → Branches → Add branch ruleset / protection rule** for
    `main`: **Require status checks to pass** (select the `Security` checks +
    `CodeQL`), **Require branches up to date**, **Block force pushes**, **Block
    deletions**. (Solo dev: you can skip "require PR approval" until you have a
    second reviewer — the status-check + no-force-push controls are the key ones.)
    Without this, the CI gates run but don't *block* a bad merge.
12. **Persona active toggle — FIXED (2026-06-28).** Root cause: the toggle only
    persisted when you clicked each persona's *Save*, so an unsaved "off" persona
    still ran. Added a dedicated auto-persisting toggle (`toggleActive`) on
    `/app/personas`; `updatePersona` no longer controls active state. `runEvaluations`
    already filtered `isActive: true`. (Note: the Matrix still shows *historical*
    results from prior runs by design — turning a persona off excludes it from
    future runs, not past ones.)

---

## 5. Next steps (suggested order)

1. ~~**Finish the UI redesign**~~ — **done** (see §3). The Matrix tab renders a
   read-only score grid + rationale cards from existing evaluation data; a full
   weighted **Compliance Matrix** with export is still phase 2 (below).
   - Optional polish remaining: rebuild the OAuth button block (Google/Microsoft)
     to match; optimized logo asset.
2. **Reporting (phase 2)** — port WP **Reports** + **Compliance Matrix**:
   - Scoring rollup per offeror (weighted by criterion `weight`, aggregated
     across personas), comparison/compliance matrix, PDF/CSV export.
3. **Evaluation robustness** — move runs to the `JobQueue` + a Vercel Cron worker
   (`CRON_SECRET` already set) to avoid function timeouts at scale; add
   per-criterion persona assignment.
4. **Billing polish** — map raw `starter` → "Base" on the billing page; handle
   `customer.subscription.paused`.
5. **Housekeeping** — optimized logo asset; smoke-test a real evaluation run.

### Security remediation backlog (status tracked on `/app/security`)
- **Quick wins (Remediated 2026-06-28):** DARA-014 (DB TLS enforced via pg adapter
  `ssl`; harness-verified), DARA-018 (`redirect_to` validated as a safe relative
  path), DARA-019 (crypto plaintext fallback removed + APP_KEY entropy warning),
  DARA-016 (`package-lock.json` removed + gitignored, pnpm declared). DARA-015
  **Remediated 2026-06-28** — CI gates (gitleaks, frozen-lockfile + dependency
  audit, CodeQL SAST, CycloneDX SBOM); enforce via branch protection (action #13).
- **Larger, dedicated passes:** ~~DARA-004 (least-privilege DB role + per-tenant
  RLS)~~, ~~DARA-009 (encrypt CUI at rest)~~, and ~~DARA-013 (append-only audit
  trail)~~ **done 2026-06-28**. **DARA-007 (CUI→LLM): Risk accepted** — decision to
  keep the commercial-LLM hosting model with compensating controls: CUI boundary
  notices at every egress/config point, BYOK offered as the option, encryption at
  rest/in transit, per-run provider/mode audit, `DARA-007-data-boundary.md`. ZDR
  agreements on the platform keys (Anthropic/OpenAI/Google) pursued **offline**;
  update the notice copy + status on signing. (No FedRAMP/GovCloud migration.)
- **DARA-002 (secrets handling): Remediated 2026-06-29** — Vercel is the
  authoritative secret store; removed the redundant duplicate `.env` and two dead
  secrets (`STRIPE_PRICING_TABLE_ID`, `CRON_SECRET`) from `.env.local`; restored an
  accurate secret-free `.env.example`; rotation-on-suspicion runbook in
  `prisma/security/DARA-002-secrets.md`. Residual on-disk presence risk-accepted
  with controls.
- **DARA-017 (migration history): Remediated 2026-06-29** — read-only introspection
  confirmed prod is clean (12 `dara_*` tables, no legacy/template tables, no
  `auth.users` trigger); `schema.prisma` matches the DB with zero drift; baselined to
  `prisma/migrations/0_init` (generated + `migrate resolve --applied`, DDL not re-run);
  forward workflow is `migrate dev`/`deploy` (no `db push`). Two-layer schema source of
  truth (Prisma migrations + owner-SQL manifest) documented in
  `prisma/security/DARA-017-migrations.md` + `prisma/migrations/README.md`.
- **Original register (DARA-001..019): no open findings** (DARA-007 risk-accepted). **But the 2026-07-05
  re-audit found net-new gaps SEC-01..23 on surface added since June — tracked in `SECURITY_BACKLOG.md`
  (untracked file). SEC-04 fixed; the rest are open.** See memory `security-reaudit-2026-07`.

### Compliance / docs (new)
- **System Security Plan (SSP)** — started 2026-06-28 as a living in-app document at
  `/app/security/plan` (system overview, authorization boundary, roles, NIST
  800-171 control implementation, POA&M from the findings register; POA&M detail
  gated to platform admins). Moves the PL family to Partial. Remaining: formal
  sign-off + maintenance cadence.

### Feature backlog (security-adjacent)
- **Admin-only audit-log viewer (per company).** `dara_audit_log` is already
  per-company; build a read-only viewer for **company admins** under the **Team**
  tab (filter by actor/action/date; export). Closes the AU "log review" gap.
- **AI codebase security-audit (back-office).** A platform-admin feature that runs
  an automated NIST-800-171 / best-practice vulnerability review of the codebase
  using the **platform API key** (LLM), producing a detailed findings report that
  feeds the register. Backlog.

---

## 6. Key paths

- Engine: `utils/dara/{prompt,providers,evaluator,documents,personas,billing,crypto,admin,provision,teams,platform,platform-ai,ai-catalog}.ts`
- Teams: `app/app/team/{page.tsx,TeamView.tsx,actions.ts}`, `utils/dara/teams.ts` (invite email), invite-accept + `touchLastLogin` in `utils/dara/provision.ts`; RLS `prisma/security/2026-06-29_teams_rls.sql`
- Solicitation access: `utils/dara/sol-access.ts` (rules + `requireViewableSolicitation` gate in the detail page); RLS `prisma/security/2026-06-29_solicitation_departments_rls.sql`; join table `dara_solicitation_departments`
- Application Admin: `utils/dara/platform.ts` (resolve/guard/manage admins + user ban/delete), `app/app/admin/{page.tsx,ai-actions.ts,PlatformAISelect.tsx}`, `components/layout/{PlatformAdminSidebar,AccountDisabled}.tsx`; tables `dara_platform_admins` (RLS `prisma/security/2026-06-30_platform_admins_rls.sql`), `dara_platform_settings` (RLS `…/2026-06-30_platform_settings_rls.sql`)
- Platform AI: `utils/dara/{platform-ai.ts (DB settings),ai-catalog.ts (client-safe MODEL_CATALOG)}`; `resolveCompanyAI(company, platform)` in `providers.ts`; evaluator fetches `getPlatformAI()`
- Onboarding: `app/onboarding/{page.tsx,OnboardingWizard.tsx,actions.ts}`, `app/welcome/{page.tsx,actions.ts}`; gate in `app/app/layout.tsx`; flags `Company.onboardedAt` + `DaraUser.onboardedAt`
- Evaluation engine: `utils/dara/prompt.ts` (review + findings schema/instructions + `parseResult`), `utils/dara/evaluator.ts` (`runEvaluation`, `regenerateResult`, `setResultArchived`, `aiFields`, `EVAL_MAX_TOKENS=8000`)
- Evaluation UI: `components/dara/{ResultCard,ReviewSummary,RationaleBlock,ResultFindings,RunPanel,RunningBanner,SubmitButton}.tsx`; per-section + run server actions in `app/app/solicitations/[id]/page.tsx`
- Result versioning: `Result.{aiReview,regenCount,archivedAt}` + `ResultVersion` (`dara_result_versions`); RLS `prisma/security/2026-06-30_result_versions_rls.sql`
- Company settings: `app/app/company/page.tsx` (profile/address/CMMC); 19 cols on `dara_companies`
- App shell: `app/app/layout.tsx` (admin-vs-company branch), `components/layout/{Sidebar (Organization group),PlatformAdminSidebar,ChromeGate}.tsx`
- Pages: `app/app/{dashboard,solicitations,personas,settings,billing,admin,team,company}/…`
- Webhook: `app/api/webhooks/route.ts`
- Design tokens: `tailwind.config.js`, `styles/main.css`, fonts in `app/layout.tsx`
- Design primitives: `components/dara/{theme.ts,PageHeader.tsx,Tabs.tsx}`
- Security page + content: `app/app/security/page.tsx`, `utils/dara/security-content.ts`
- System Security Plan (SSP): `app/app/security/plan/page.tsx` (renders `SSP` + `CONTROL_POSTURE` + POA&M)
- Security SQL artifact: `prisma/security/2026-06-27_lock_dara_tables.sql`
- Schema: `prisma/schema.prisma`; migrations baseline `prisma/migrations/0_init/` (+ `README.md`)
- Owner-SQL layer + manifest: `prisma/security/*.sql` via `apply-sql.ts` (see `DARA-017-migrations.md`)
- Security headers: `next.config.js`

---

## 7. Session log & handoff

**Session 2026-06-28 (this session) — shipped:**
- Google OAuth sign-in (Supabase provider) with security controls; `safeRelativePath`
  redirect validation (DARA-018); sign-in audited; root/middleware `?code=` forwarders.
- Logout fixed (server-side `SignOut` action clears SSR cookies).
- "Remember me" — both email pre-fill (localStorage) and session-only cookies
  (`dara-remember` cookie strips maxAge/expires in server + middleware).
- Personas page redesign (split-pane), clickable template-variable chips, selectable
  emoji icons, slide-toggle for active; persona toggle bug fixed (auto-persist).
- Light/dark theme tokenization, light default; theme-ordering bug fixed.
- Control posture refreshed to current reality across all families.
- **System Security Plan (SSP)** built at `/app/security/plan` (linked from Security).
- Deployed prod (`668b406`) and pushed to `main`; CI gates running.

**Session 2026-06-29 — shipped:**
- Deleted the stray nested `ci-dara/` directory (working tree clean).
- **DARA-002 (secrets handling) Remediated** — Vercel established as source of truth;
  removed redundant `.env` + two dead secrets; accurate secret-free `.env.example`;
  rotation runbook (`prisma/security/DARA-002-secrets.md`). Committed `b5048d8`,
  deployed prod, pushed.
- **DARA-017 (migration history) Remediated** — verified prod schema is clean (no
  legacy drift) via read-only introspection; baselined to `prisma/migrations/0_init`
  (`migrate resolve`); documented the two-layer schema source of truth
  (`prisma/security/DARA-017-migrations.md`, `prisma/migrations/README.md`).
- **No audit findings remain open** (DARA-007 risk-accepted).
- **Teams feature shipped** (commit `c7a7a5f`, deployed prod). New `/app/team`
  (departments + per-team roles + email invitations); `provisionNewUser` now attaches
  invited users to an existing company/team on first sign-in. First real migration via
  the DARA-017 workflow (`20260629210000_teams_and_invitations`) + per-tenant RLS for
  the 3 new tables (verified: 6 policies + grants). Member management moved out of
  Settings. **Open dependency:** Supabase Auth Site URL (#1) for invite emails.
- **Team page rebuilt to the prototype design** (commit `78953dd`, deployed). Server
  page + client `TeamView` + typed `actions.ts`: header `+ Invite User`, DEPARTMENTS
  filter chips, unified users table (avatar · color-coded role badge · department ·
  last active · kebab menu), invite/new-department modals. Adopted single-department-
  per-user in the UI. Wired `lastLoginAt` (`touchLastLogin` on both sign-in paths) so
  "Last Active" is real — existing users read "Never" until their next sign-in.
- **Email "from" line** is Supabase config, not code — to brand it, configure Custom
  SMTP sender name/email (see action #1).
- **Solicitation department access shipped** (commit `2c6519a`, deployed). New join
  table `dara_solicitation_departments` (migration `20260629230000` + RLS, verified).
  Department-scoped visibility (admins all / creator own / others via assigned dept)
  enforced app-layer (`utils/dara/sol-access.ts`) with the detail gate covering the
  page + all mutations + child data; list/dashboard scoped to match. Assign on create
  and in the detail Overview (admins + creator). **Behavior change on deploy:** existing
  solicitations have no departments, so non-admin/non-creator users stop seeing them
  until an admin/creator assigns departments.

**Session 2026-06-30 — shipped:**
- **Organization sidebar group** (`Sidebar.tsx`): empty-section filter so a group only
  renders when the viewer can access something in it; **Company** + **Team** live under it
  (company-admin only); Admin stays under Account for company users.
- **Onboarding** (commit `4076ec7`, deployed): `/onboarding` 6-step wizard (prefilled from
  Google OAuth) for new org creators; `/welcome` one-screen for invited members.
  `Company.onboardedAt` + `DaraUser.onboardedAt` gate; existing rows backfilled as onboarded.
  Migration `20260630000000_company_user_onboarding`.
- **Company settings** (`/app/company`, commit `4076ec7`): profile/address/CMMC-C3PAO;
  migration `20260630010000_company_profile` (19 cols).
- **Sign-in "Create Account"** (commit `5ecc949`): replaced "Request access"; Google OAuth
  on the create-account view; signup form restyled. Still yields a trial `company_admin`.
- **Invitation email-verification gate** (commit `8fd5ac3`): `provisionNewUser(emailVerified)`
  + `EmailVerificationRequiredError`; defense-in-depth vs invite hijack independent of the
  Supabase Confirm-email setting. Company names intentionally non-unique (tenancy keyed on
  id/slug); cross-tenant isolation still enforced by `withTenant` + RLS (DARA-004).
- **Application Admin role** (commit `d322114`, deployed): company-less platform operator;
  `dara_platform_admins` (migration `20260630020000` + RLS, verified `dara_admin` access);
  `utils/dara/platform.ts`; login routing + admin shell; console with Accounts / Users
  (ban/delete incl. Supabase auth) / Administrators. **Behavior change:** env-listed admin
  emails are now company-less.
- **Platform AI settings** (commit `139368f`, deployed): `dara_platform_settings` singleton
  (migration `20260630030000` + RLS); Application Admin → Platform AI manages platform keys
  (encrypted) + central provider/model; `resolveCompanyAI(company, platform)`; env key
  fallback during transition; client-safe `ai-catalog.ts` split.
- **Operator change:** `PLATFORM_ADMIN_EMAILS` → `islanista@gmail.com` (removed
  `david@crucibleinsight.com`); david deactivated in-console → reverted to normal user
  (company "Proposal Foundry"); david's admin row kept (deactivated). `admin@crucibleinsight.com`
  is a DB admin.
- **Structured evaluation findings** (commit `ae42c0c`, deployed): results now return
  formatted strengths / weaknesses / compliance / suggested-changes-with-rationale.
  `Result` gained `ai_compliance` + `ai_suggested_changes` (migration `20260630040000`,
  no RLS change — existing table). Confirmed platform-mode (non-BYOK) evals already use
  the admin-configured Platform AI key + model. **Populates on next run.**
- **Non-BYOK accounts lose the key/model choice in the UI** (commit `1bfb044`, deployed):
  company Settings AI config is now a client component (`CompanyAIConfig.tsx`) — platform
  mode shows only the key-mode toggle + read-only platform model; provider/model + BYOK key
  fields appear only in BYOK mode. Aligns the UI with the runtime (which already forces the
  admin key+model for non-BYOK).
- **Fixed `david@crucibleinsight.com` still showing as platform admin** (same deploy): root
  cause was his `dara_platform_admins` row was `active=true` (the portal Deactivate hadn't
  persisted — it's blocked while env-pinned), and an active row = admin regardless of the env
  list. Deleted the row; he's back to a normal `company_admin` (Proposal Foundry). See gap #15.
- **Evaluation: 4-part feature** (commit `f361d70`, deployed; per-criterion + live sync
  indicator, per the chosen options): (1) progress indicator (`RunPanel`) + completion notice
  + running-count banner (`RunningBanner`, auto-refresh); (2) regenerate-by-section (snapshot →
  `dara_result_versions`, `regenCount`, History log); (3) archive-not-delete (`archivedAt`);
  (4) reformatted "first part" — a **Review summary** (how/what/measured-against, citing
  specific tasks/requirements) opening each result, findings unchanged. New migration
  `20260630050000_result_versioning` + RLS (DARA-004), verified `dara_app` access.
- **Eval fix 1** (commit `3441f34`): the review-summary addition truncated each criterion's
  JSON at the old 4096 `max_tokens` (parse failed → evaluations reported failed/incomplete).
  Raised to `EVAL_MAX_TOKENS=8000`.
- **Eval fix 2** (commit `c81d576`): formatted the **Assessment** (rationale) into a titled
  card with numbered findings (`RationaleBlock`); strengthened the prompt so `suggested_changes`
  (change + rationale) is produced whenever a weakness/gap exists (the verbose review prompt had
  let the model return an empty list). Strengths/weaknesses/compliance unchanged.
- **Color-team reframing — Phase 1: Requirements + Compliance matrix** (commit `d1836dc`,
  migrated + deployed). `Criterion`→`Requirement` (`dara_criteria`→`dara_requirements`,
  migration `20260701000000_requirements_compliance`); old `criterion_type` migrated into
  `source`+`isScored`; `dara_results.criterion_id` column kept (Prisma field remapped to
  `requirementId`). New AI **shred** (`utils/dara/requirements.ts` + `buildShredPrompt`/
  `parseShred`) turns RFP docs into requirement rows. **Compliance tab** replaces Criteria
  (generate / per-source grouping / compliance status + proposal ref). RLS preserved through
  the rename; DARA-004/005 source files updated to the new name; `2026-07-01_requirements_rls.sql`
  added. Engine + Matrix now run per requirement.
- **Phase 2: Color-team reviews** (commit `9a4e944`, migrated + deployed). `Response`→`Review`
  (`dara_responses`→`dara_reviews`), `ResponseFile`→`ReviewDocument` (per-review frozen
  snapshot), new `ReviewPersona`, `SolDocument.doc_type` (migration
  `20260701010000_color_team_reviews`). Proposal draft lives on the solicitation;
  `captureSnapshot` (`utils/dara/reviews.ts`) freezes it per review; `runReviewAction` runs the
  chosen personas (fallback active) vs the snapshot. Tabs: Documents (RFP + our proposal),
  **Color Teams** (create review + color + reviewers + capture + run), **Review** (results
  grid + cards). New `dara_review_personas` granted via `2026-07-01_reviews_rls.sql`.
- **Phase 3: Amendments + AI reconciliation** (migrated + deployed; migration
  `20260701020000_amendments`). New `Amendment`/`AmendmentChange`/`RequirementVersion` +
  requirement provenance (`removed_at`, `*_by_amendment_id`, `version`) + `SolDocument.amendment_id`.
  **Amendments tab**: upload amendment → "Reconcile with AI" (`utils/dara/amendments.ts` +
  `buildAmendmentDiffPrompt`/`parseAmendmentDiff`) diffs vs the matrix → accept/reject proposed
  add/modify/remove. Accept folds into the matrix (modify versions the prior values; remove sets
  `removed_at`, retained). Reviews predating an applied amendment are flagged **pre-amendment**.
  New tables granted via `2026-07-01_amendments_rls.sql`. **The color-team reframing is complete.**

**Session 2026-07-01 — shipped (bug-fixing the review/eval flow on real solicitation data +
a course-correction to a holistic review model):**
- **Two real prod bugs found via audit-log/runtime-log diagnosis** (commit `f1155b3`):
  (1) a **client-side exception** on the solicitation page — `toLocaleDateString()` on a
  UTC-midnight date renders a different day/locale on server vs client → hydration mismatch;
  fixed with a deterministic UTC `fmtDate`. (2) **"Generate compliance matrix" produced
  nothing** — the shred's requirements JSON overflowed the 8000-token cap and truncated;
  fixed by raising to 16000, shredding **RFP docs only** (was also ingesting the 136 KB
  proposal), a **salvage parser** (`extractArrayObjects` recovers complete items from a
  truncated array), and surfacing AI-action errors in the UI (`AiActionButton`).
- **Amendment-diff recall** (commit `f60017b`): reframed the prompt from "minimal set" to a
  thorough per-requirement pass (prefers recall; the accept/reject UI filters false
  positives) + sends full requirement text. Also flagged: platform model was **Haiku**;
  reconciliation quality wants **Sonnet** (operator sets it in Platform AI).
- **Review-run scaling** (commits `3e410a2`, `7e39b43` — **later superseded**): a shredded
  RFP has 100+ requirements; one-call-per-requirement blew past the 300s function limit and
  died ~8 in (surfaced as "Application error"). Made runs batched/tiered/time-boxed/resumable
  + per-provider output-token clamp (Google 8192 / OpenAI 16384). **Then reverted the review
  half** — see below.
- **Duplicate-review + create-crash** (commit `d57eaa9`): a transient client render error
  after `createReview` made a successful create look failed → users recreated → duplicates.
  Fixed: `createReview` finishes with a **redirect** (fresh navigation, like the manual
  refresh that always worked) instead of an in-place client patch, + a 120s duplicate guard.
- **⭐ Holistic review restored** (commit `8125fd1`): reverted the "compliance-heavy" batching
  of the review. `runEvaluation` is again the **rich per-evaluation-factor** assessment
  (`isScored=true`, few); new `runComplianceSweep` does the **lean pass/fail sweep** over the
  administrative requirements (`isScored=false`, bulk) → `complianceStatus`. Bundled into a
  review run. No schema change. See the §2 review-model decision. **This is the intended model.**
- **Color Review Cycle design imported** (via `DesignSync` MCP, read-only): a 9-stage
  proposal-pipeline UI. **Not built yet — this is "Pass B", the top of the next queue**
  (hybrid: pipeline UX, reuse engine). Reference at `…/scratchpad/ColorReviewCycle.html`.

**Session 2026-07-01 (multi-pass) — shipped** (built the imported `DARA.dc.html` multi-pass
design + requirement disposition + two prod bug fixes; all deployed & pushed):
- **Requirement disposition** (commit `c895da8`): `Requirement.disposition` enum
  (scored/compliance/administrative), AI-classified by the shred, kept in sync with `isScored`.
  The shred prompt (`buildShredPrompt`) now auto-classifies AND **excludes non-requirements**
  (evaluation/scoring methodology, rating-scale defs, boilerplate, Gov responsibilities) — the
  user's "it captures the scoring mechanism as a requirement" complaint. Compliance sweep
  (`runComplianceSweep`/`runComplianceCheck`) targets `disposition=compliance`; administrative
  rows default N/A + skipped. Matrix "Type" dropdown replaces the Scored checkbox. Migration
  `20260701050000`. Also fixed `RequirementVersion` `@map` drift (is_scored/far_reference/
  compliance_status/proposal_ref).
- **Matrix modal centering** (`f20b77e`): `RequirementDetail` + `AddSection` portal to
  `document.body` — the active pipeline panel's `.fade` animation leaves `transform:
  translateY(0)`, making it the containing block for `position:fixed` (modal centered on the
  panel, not the viewport).
- **Create-review crash + modal-not-closing** (`5c1bf8b`): `AddSection` now closes on submit
  (capture-phase `submit` listener — submit doesn't bubble, capture reaches it), unmounting the
  form before the server action re-renders; `createReview` **revalidates instead of redirect**.
  The redirect + open portal modal was throwing a client-side exception (create succeeded — it
  appeared on refresh) and never resetting the modal's open state.
- **★ Multi-pass AI review** (`da370ed`): each color-team `Review` runs three sequential passes
  — **Pass 1 Compliance & Format · Pass 2 Technical Responsiveness · Pass 3 Risk & Competitive**
  — each a 0-100 score + severity-ranked findings (severity·finding·requirementRef·recommended
  action). **Async**: `dara_review_passes` + `dara_findings` (migration `20260701060000` + RLS
  `2026-07-01_review_passes_rls.sql`); engine `utils/dara/passes.ts` (`runPass`,
  `runReviewPasses`, `enqueueReviewRun`/`enqueuePassRun`, `processReviewJobs` worker,
  `triggerWorker`); prompts `PASS_LENS`/`buildPassPrompt`/`parsePassResult`; worker route
  `app/api/cron/passes` + `vercel.json` cron (every minute). UI `ReviewPassPanel` polls live.
  **Decision: layered onto color teams** (each review runs the 3 passes); the old per-persona
  holistic `runEvaluation`/`Result` path is preserved but secondary (collapsed). **`after()` is
  not available in Next 14.2.35** → fire-and-forget fetch + cron backstop. **User-verified in
  prod.**
- **Compliance matrix export + notes** (`4b0d4c1`): `Requirement.notes` (migration
  `20260701070000`), editable Notes column + "Response loc." relabel, **CSV / Word export**
  (`exportMatrixAction` + `MatrixExport`, Blob download, no dep).
- **"Sync from AI review"** (`20d05b6`): `syncMatrixFromPasses` folds the latest completed
  Pass-1 findings into the matrix (no LLM) — fuzzy match ref↔citation, idempotent `AI:` notes
  block, status nudge on unassessed rows.
- **Dashboard pass badges** (`2070c6c`): Recent-Solicitations table shows P1/P2/P3 status
  aggregated across a solicitation's reviews + avg completed-pass score; "Avg Score" stat card.
- **Multi-pass shred + amendment coverage** (`d55ccdf`): `shredRequirements` runs ≤2 coverage
  passes (`buildShredGapPrompt`) after the initial extract to catch missed requirements (stop
  when dry); `reconcileAmendment` runs 1 coverage pass (`buildAmendmentGapPrompt`). Completes
  the original multi-pass ask (evaluations + matrix + amendment impact).

**Session 2026-07-03 — shipped (MVP-launch prompt chain kickoff: a run of prod bug-fixes on
the multi-pass/matrix flow, then Prompt 2 of the launch chain extended into an entitlements
system). All deployed & pushed; HEAD `980cc13`.**

Context: this session runs `DARA_CC_PROMPT_CHAIN.md` (an 11-prompt MVP-launch hardening pass
against `DARA_BUILD_PLAN.md`). **Prompt 1 (read-only audit) done** — one real gap found:
Enterprise plan still creates a Stripe Checkout (Task 8, fix in Prompt 9). **Prompt 2 done +
extended** (below). Prompts 3–11 remain.

Bug-fixes (real prod issues hit while exercising the flow, most recent first):
- `bcc8463` — **shred + amendment reconcile made async** (background worker + live progress),
  the last two synchronous AI actions. New `AsyncJobControl`; worker handles `kind:'shred'` /
  `'reconcile'`. No blocking AI requests remain in the solicitation workspace.
- `29f8f52` — **★ the real compliance-check bug**: the batch prompt lists requirements as
  `#<id>` and says "return the id exactly as given", so Sonnet returns `"id":"#1022"`, but
  `mapBatchItem` required `/^\d+$/` → **every item dropped, 0 graded** (independent of batch
  size / doc size / sync-vs-async — all prior red herrings). Fixed: `mapBatchItem` extracts the
  digit run. **Found by running a real batch against prod data via a throwaway read-only tsx
  script** (`.env.local`); verified 12/12 parse. Batch size 12→30 (fewer full-doc re-sends).
- `750a70c` — **compliance check made async** (JobQueue + live graded/total progress) —
  replaced the synchronous request that stalled the AiActionButton at its 92% simulated ceiling.
  New `ComplianceCheckControl` + `enqueueComplianceCheck` / `isComplianceCheckActive`.
- `0919f79` — compliance sweep hardening (smaller batches, per-batch time budget so a call
  can't overrun the function limit, stop swallowing batch errors, resumable not-assessed-only).
- `14c8b0d` — **multi-pass review hang fixed**: 3 sequential full-doc passes in one worker
  invocation; a pass killed mid-call left the JobQueue row + pass stuck `running` forever (worker
  only claims `pending`). Fixes: `runReviewPasses` won't START a pass without `PASS_BUDGET_MS`
  headroom (else leaves it `queued`); **`reapOrphanedJobs()`** requeues/fails anything `running`
  past 6 min. Self-heals stuck reviews.
- `7973a55` — **AddSection modals not creating on submit** (create review/requirement/amendment):
  the capture-phase `submit` listener unmounted the form mid-dispatch, swallowing the server
  action. Replaced with a `useFormStatus`-based `CloseModalOnComplete` (form stays mounted through
  dispatch, modal closes on completion). **Supersedes the `5c1bf8b` close-on-submit approach.**
- `d7d47c9` — compliance-matrix instructions reformatted (numbered list) + `AiActionButton`
  stepped progress (determinate %, rotating sub-step messages).

★ **Trial fencing + per-company entitlements/gating** (`980cc13`, migrated + deployed) —
**Prompt 2 core + an admin-management extension the user asked for:**
- `utils/dara/trial.ts` — `requireTrialCapacity` (metered trial limits: solicitations 2 / review
  runs 3 / seats 2) + `requireFeature`/`FeatureDisabledError` (feature flags: **amendments,
  personas, team**). **Resolution chain: code defaults → platform default → per-company override.**
- `provision.ts` — trial period **14 → 30 days** (PRD).
- Schema: `Company.entitlements` + `PlatformSetting.defaultEntitlements` JSON columns (migrations
  `20260703000000`, `20260703010000` — column-only, no RLS change; **applied to prod**).
- Admin console (`/app/admin`): new **"Gating"** left-sidebar menu → platform-wide **Default
  gating** (limits + feature toggles every company inherits); per-company **override** forms
  (opt-in, inherit/custom badge, reset-to-defaults) inline in Accounts.
- ⚠️ **NOT YET ENFORCED.** Setting a limit/flag stores it and the admin UI works, but nothing
  blocks until **Prompt 3** wires `requireTrialCapacity`/`requireFeature` into the create actions
  (createSolicitation / enqueueReviewRun / inviteUser) + feature entry points (amendments /
  personas / team). Deployed the management surface early because the user wanted to see it.

**Pick up next session — see `SESSION_HANDOFF.md` + `CONTEXT_HANDOFF.md`.** Top of queue:
1. **★ Prompt 3 — wire trial-fencing + feature-gating enforcement** (the flags/limits are
   deployed but inert). `requireTrialCapacity` into `createSolicitation`, `enqueueReviewRun`,
   `inviteUser` (+ dashboard trial bar); `requireFeature` into amendments / personas / team.
   Placement gotchas noted in the Prompt 1 audit (put `requireTrialCapacity` OUTSIDE the
   `withTenant` tx in createSolicitation; seat check only in the new-invitation branch).
2. Continue the chain: **Prompt 4** onboarding 6→3 steps · **5** solicitation 3-tab nav + sidebar
   · **6–8** navy/gold/Inter reskin · **9** CUI copy + PDF-fail msg + docs page + **Enterprise
   Stripe guard (Task 8, real gap)** · **10–11** CRON_SECRET + quality gates + launch. Hold before
   the Prompt 10 deploy/operator boundary per the user (credential rotation deferred to release).
3. **Operator actions (you):** platform model → **Sonnet** (biggest quality lever); optional
   `CRON_SECRET`; branch protection on `main` (#13); Supabase Auth Site URL + Confirm-email (#1).
4. Backlog: per-company audit-log viewer; AI codebase security-audit; billing polish
   (`starter`→"Base"; `subscription.paused`).
