# DARA — Session Handoff

_Prepared: 2026-06-30 (end of session) · for: next session_

This is the "start here tomorrow" doc. Authoritative status lives in
`BUILD_STATUS.md` (§2 decisions, §3 completed, §4 gaps, §7 session log); open
security findings live on `/app/security` and in `utils/dara/security-content.ts`.

---

## 1. Where we are

- **Branch:** `main`, clean. Last commit `ae42c0c` (structured evaluation findings)
  is **deployed to prod and pushed**. This session, in order: `4076ec7` (onboarding +
  Organization group + Company settings), `5ecc949` (Create Account), `8fd5ac3`
  (invite email-verification gate), `d322114` (Application Admin), `139368f`
  (Platform AI), `3d3b15b` (docs), `ae42c0c` (structured findings).
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
  catalog: `utils/dara/ai-catalog.ts`.
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
