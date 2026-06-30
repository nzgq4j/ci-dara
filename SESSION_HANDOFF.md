# DARA — Session Handoff

_Prepared: 2026-06-30 (end of session) · for: next session_

This is the "start here tomorrow" doc. Authoritative status lives in
`BUILD_STATUS.md` (§2 decisions, §3 completed, §4 gaps, §7 session log); open
security findings live on `/app/security` and in `utils/dara/security-content.ts`.

---

## 1. Where we are

- **Branch:** `main`, clean. Last commit `d1836dc` (**color-team reframing Phase 1 —
  Requirements + Compliance matrix**) is **migrated, deployed to prod, and pushed**.
  Earlier this session, in order:
  `4076ec7` (onboarding + Organization group + Company settings), `5ecc949` (Create
  Account), `8fd5ac3` (invite email-verification gate), `d322114` (Application Admin),
  `139368f` (Platform AI), `3d3b15b` (docs), `ae42c0c` (structured findings),
  `e5a5bc7` (docs), `1bfb044` (non-BYOK AI lockdown + david demotion), `6a28608` (docs),
  `f361d70` (eval progress/regenerate/archive/review-summary), `3441f34` (eval token
  fix), `c81d576` (eval assessment formatting + suggested-changes), `d1836dc`
  (reframing Phase 1: Requirements + Compliance matrix).
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

- **Product is being reframed: offerors → color-team gate reviews** (review *our own*
  proposal as it matures, not score competitors). The methodology is **never named** in
  UI/prompts/code/docs — use "color team review", gate names (Pink/Red/Gold/Blue/Green/
  Black/White), "review gate". **Phase 1 (Requirements + Compliance) is SHIPPED**; Phase 2
  (Reviews/color teams: `Response`→`Review`, draft snapshots, persona selection, Color
  Teams + Review tabs) is next; Phase 3 is amendments (AI reconciliation). See BUILD_STATUS
  §2 for the four design decisions.
- **`Criterion` is now `Requirement`** (`dara_requirements`). The old Criteria tab is the
  **Compliance** tab: AI shred ("Generate from solicitation", `utils/dara/requirements.ts`)
  + per-source grouping + compliance status + proposal reference. Evaluations run per
  requirement. `dara_results.criterion_id` column was kept (Prisma field `requirementId`),
  so the FK/unique index are unchanged. If a long RFP truncates the shred JSON, raise
  `SHRED_MAX_TOKENS` in `utils/dara/requirements.ts`.

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
- **Evaluation results are richer now and populate on the next run/regenerate.** Each
  result: **Review summary** (how/what/measured-against, with citations) → **Assessment**
  (formatted rationale) → strengths / weaknesses / compliance / **suggested changes**
  (change + rationale). A "section" = one criterion: **Regenerate** (logs prior versions
  in `dara_result_versions`, shows History(N) + a regen×N badge) and **Archive/Restore**
  (retained, never deleted). Runs are synchronous with a live `RunPanel` spinner +
  `RunningBanner` count. Output budget `EVAL_MAX_TOKENS=8000` (in `utils/dara/evaluator.ts`)
  — if very long criteria ever truncate, raise it or move `suggested_changes` earlier in
  the schema. Older results show only the rationale/findings until re-run.
- **Demoting a platform admin takes two steps.** Removing the email from
  `PLATFORM_ADMIN_EMAILS` is NOT enough: `resolvePlatformAdmin` treats an active
  `dara_platform_admins` row as admin regardless of the env list, and the console
  **Deactivate** is blocked while the email is still env-pinned. To fully demote: remove
  from env **and** delete/deactivate the row. (`david@crucibleinsight.com` was demoted
  this way — row deleted; now a normal `company_admin` of "Proposal Foundry".)
- **Structured evaluation findings are live** (strengths / weaknesses / compliance /
  suggested changes + rationale; `ResultFindings.tsx` in the Matrix tab). They
  **populate on the next evaluation run** — results from before this deploy show only
  the rationale until re-run.
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
- A real **multi-criteria evaluation** end-to-end — confirms both the platform
  key/model path AND the new **structured findings** rendering (strengths /
  weaknesses / compliance / suggested changes) in the Matrix tab.

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
