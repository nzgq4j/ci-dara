# DARA — Session Handoff

_Prepared: 2026-07-06 (night) · last DEPLOYED code `6eeb625` (`dpl_DcLvK6wz4VAzSjguZydca3dcXTCU`) · branch `main` · for: next session_

Start-here doc. Everything below is **live on production** (`dara.crucibleinsight.com`) unless flagged
otherwise. Last deployed code commit is `6eeb625`. **Invites now WORK** — the dead-link bug was config, fixed
this session (Option A, see §2.0). **Top priority next: the security backlog** (`SECURITY_BACKLOG.md`, §5) —
DARA-025 BOLA (code) + DARA-022/023 (operator). Agent memory (load first): `account-self-service.md`,
`security-reaudit-2026-07.md`, `mfa-totp.md`, `legal-tos.md`, `personas-review-lens.md`,
`billing-and-backlog.md`. Deep decision log: `BUILD_STATUS.md`.

> ⚠️ **Two operator steps pending in the Supabase dashboard** (from this session): (a) **enable Manual
> Linking** so account "Connect Google" works (until then that button shows a friendly "not enabled yet"
> message); (b) **paste the 12 branded email templates** (`supabase/templates/` → dashboard; `README.md` maps
> each file to its slot).

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

## 2. What shipped

### 2.0 Most recent (2026-07-06, night) — invites verified, account self-service, avatars, dept editor, email templates

Commits `21fcae9` (account + dept editor + templates + avatar migration) → `6eeb625` (avatars in Teams/welcome).
Both DEPLOYED to prod. **One prod migration applied** (`20260707000000_user_avatar` — additive `avatar_url` on
`dara_users`; existing RLS covers it) + **new public Storage bucket `dara-avatars`** (created via
`node --env-file=.env.local scripts/create-avatars-bucket.mjs`). See memory `account-self-service.md`.

1. **Invite flow VERIFIED working — DARA-045 link side CLOSED.** The earlier dead link (`/signin/...#access_token=…`)
   was Supabase's *default implicit-flow* template returning the session in the URL `#fragment`, which no server
   route can read (our `/auth/confirm` reads `?token_hash=`, `/auth/callback` reads `?code=`). **Fix = Option A,
   operator config (done this session):** Site URL = bare `https://dara.crucibleinsight.com`, redirect allowlist
   `…/**`, and the branded token_hash "Invite user" template. A test invite now lands on `/welcome` signed in.
   Delivery is via **Resend Custom SMTP** (operator-configured), so the built-in rate limit no longer applies.
2. **Account self-service — `/app/account/profile`** (new sidebar "Profile" link, 3 panels): edit display name +
   upload/remove **avatar**; **set/change password** (`updateUser` — fixes OTP-invited users with no password);
   **link/unlink Google** (`linkIdentity`/`unlinkIdentity`, client-side). All audited (`account.*`). Server actions
   in `app/app/account/profile/actions.ts`. The **Reset Password** email lands here so users set a new password.
3. **Avatars wherever an account circle shows** — shared `components/dara/Avatar.tsx` (image-or-initials); rendered
   in the sidebar, the **Teams member list**, and the welcome screen (uploaded avatar preferred over the OAuth
   picture). Public bucket (non-CUI, public read, no signed URLs); uploads via service-role with magic-byte checks
   (`utils/dara/avatar.ts`). Onboarding wizard + platform-admin sidebar intentionally left initials-only.
4. **Per-solicitation department editor on the LIST** — `components/dara/DepartmentEditor.tsx` modal +
   `setDepartmentsAction` in `app/app/solicitations/page.tsx`, gated to **admin + creator**
   (`canManageDepartments` — user chose to keep the creator, not admin-only). Mirrors the Overview-tab card.
5. **12 branded Supabase email templates** in `supabase/templates/` (+ `README.md` slot map): confirm-signup,
   magic-link, email-change, recovery, reauthentication, and 7 security notices. All link-based ones use the
   `/auth/confirm?token_hash=…` flow (NOT the implicit `#access_token` flow). **Must be pasted into the Supabase
   dashboard to take effect** — the folder is source-of-truth only.

⚠️ **Pending operator (Supabase dashboard):** (a) **enable Manual Linking** so "Connect Google" works;
(b) **paste the 12 email templates**. Everything else above is fully live.

### 2.1 Earlier session (2026-07-06) — security fixes, 2FA, legal/TOS, invites, auth

Commits `258a5eb` → `1754cf6`. All DEPLOYED through `2e2e74c` (last two are register-text only). **Two prod
migrations applied that session** (`20260706000000_user_mfa`, `20260706010000_user_legal_acceptance`).

1. **Security quick-wins** (`258a5eb`) — DARA-026 (`getDaraUser` fail-closed on `isActive`; layout uses new
   `findDaraUserRaw` so the disabled screen still renders), DARA-027 (sol delete now `removeStored`s all
   CUI blobs), DARA-028 (CSV formula/DDE injection escaping), DARA-030 (audit `matrix.export`/`report.export`/
   `review.pass.rerun`), DARA-034 (cron `CRON_SECRET` mandatory in prod). **Unified the findings register:**
   the re-audit's `SEC-01..23` are now `DARA-021..045` in `security-content.ts` + `SECURITY_BACKLOG.md`.
2. **TOTP 2FA — DARA-031** (`8fed6c3`, + onboarding step `a5e1d9e`) — Supabase-native MFA (AAL2), NOT a
   custom system. Opt-in at `/app/account/security`, login challenge `/auth/2fa-challenge`, middleware gates
   `/app` on AAL2, 10 bcrypt backup codes, signed httpOnly recovery marker for the backup path. Also an
   optional step in the onboarding wizard. TOTP factor enabled in Supabase (operator, done). See `mfa-totp.md`.
   **Still opt-in, not enforced** — tenant-wide enforcement is the remaining step.
3. **Legal / TOS acceptance** (`9418c7e`) — required "Agreement" step in onboarding + `/app/account/legal`
   viewer (sidebar "Legal"). Source `.docx` in `public/legal/`; `node scripts/gen-legal.mjs` regenerates
   `utils/dara/legal-content.ts` (v1.0). Acceptance = typed name + checkbox → `acceptLegal()` writes
   `dara_users.tos_*` + immutable `legal.accept` audit (version, name, IP). See `legal-tos.md`.
4. **Team invitation Resend** (`18000bb`) — `resendInvitation` next to Revoke (refresh expiry + re-send).
   **⚠️ but see §8 — invite emails don't reliably send on Supabase built-in email (DARA-045).**
5. **ChromeGate fix** (`5e0aa4b`) — the marketing navbar/footer was bleeding onto full-screen auth/setup
   pages (the `/auth/2fa-challenge` "Pricing/Account/Sign out" bar, plus `/onboarding` + `/welcome`). Now
   bares `/app`, `/signin`, `/auth`, `/onboarding`, `/welcome`.
6. **Auth email-link flow — `/auth/confirm`** (`2e2e74c`) — invite links failed (`otp_expired` → `/signin`)
   because `/auth/callback` only does the PKCE `?code` exchange, which doesn't work for admin invites (no
   browser verifier). Added `/auth/confirm` (`verifyOtp` token_hash) — works for invite links, no verifier /
   allow-list dependency. Shared post-auth provisioning extracted to `utils/dara/auth-finalize.ts`. Invite
   template link now points at `/auth/confirm`. Invite-send errors now logged + surfaced to the admin.
7. **Branded invite email template** (`e2a9b11`) — `supabase/templates/invite.html` (navy/gold, table-based).
   Committed + wired in `config.toml`; **must be pasted into the hosted Supabase dashboard** to take effect
   (Auth → Email Templates → "Invite user"). NOTE: since `2e2e74c` its link uses the `/auth/confirm` token_hash
   format — re-paste the current version.

### Evening batch (2026-07-06) — compliance-matrix reliability + New Solicitation path picker (`6b12d74` → `c282963`)

8. **Shred timeout → empty matrix + infinite `_rsc` poll — FIXED** (`c282963`). The "Generate from solicitation"
   shred made ONE AI call for up to **16000** output tokens; on a requirement-dense RFP that generation exceeded
   the **240s** provider timeout, threw before writing any row, and left the JobQueue row stuck `running` — the
   page then polled `/app/solicitations/<id>?_rsc=…` forever (hit on sol 18 + 19). Fix: `SHRED_MAX_TOKENS`
   16000→8000 + the shred is now **resumable across worker ticks** (first tick extracts, later ticks only run
   gap passes, reports `exhausted`, 800-req cap; worker requeues while `!exhausted`) so no single call nears
   240s and a dense RFP finishes across ticks. Also `reapOrphanedJobs` wrapped in try/catch so a dead job always
   surfaces as `failed` (releasing the poll) instead of pinning it. Files: `utils/dara/requirements.ts`,
   `utils/dara/passes.ts`. **Diagnosis note:** output-bound (requirement density), NOT input size — input is
   capped at 50k words; larger-but-sparser RFPs shredded fine. See BUILD_STATUS §0 "Later same day".
9. **Compliance-check grading could loop forever — FIXED** (`6b12d74`). `mapDetermination` wrote any non-exact
   AI determination back to `not_assessed`, so `runComplianceJob`'s `checked===0` guard never tripped and the
   job requeued every tick. Now normalizes the determination + maps unknowns to `partial` (terminal), and the
   job terminates on **net progress** (not-assessed count before vs after). Files: `evaluator.ts`, `passes.ts`.
10. **New Solicitation review-path picker — SHIPPED** (`6b12d74`, `components/dara/UploadAndReview.tsx`). First
    screen is two explanatory cards, **Direct AI** vs **Color Team**, chosen before the sol is created. Direct AI
    uploads a response draft now; Color Team hides the proposal dropzone (per-review drafts later). Replaces the
    buried "Advanced → Switch to Color Team" checkbox. (This was backlog §4.5 — now done.)
11. **Signin footer copyright** (`2ceb0ce`) — now "© 2026 The Daniel Group LLC". **Open follow-up:** privacy
    policy + TOS pages (`app/security/privacy-policy`, `app/security/tos`, `security-content.ts owner`) still say
    "Crucible Insight LLC" — user asked to reconcile these to "The Daniel Group LLC"; not yet done.

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
  (DARA-021) — flagged in the backlog.
- **`getDaraUser` is now fail-closed on `isActive`** (returns null → treated as unauthenticated). The **app
  layout uses `findDaraUserRaw`** on purpose so a deactivated user still gets the AccountDisabled screen.
  Don't switch the layout back to `getDaraUser` or you'll bounce disabled users to signin.
- **Middleware gates `/app` on Supabase AAL2** (`getAuthenticatorAssuranceLevel`). A user with a verified
  TOTP factor but an AAL1 session is redirected to `/auth/2fa-challenge`. The **backup-code path** sets a
  signed httpOnly `dara-mfa` marker (HMAC of userId via APP_KEY, Web-Crypto so it's Edge-safe) that the
  gate also accepts; cleared on sign-out/disable. `mfa-cookie.ts` must stay node:crypto-free (Edge bundle).
- **2FA needs the Supabase project TOTP factor ON** (done). 2FA + TOS are **opt-in, not enforced** app-wide.
- **Email links use TWO routes:** `/auth/callback` (PKCE `?code`, OAuth/magic-link) and `/auth/confirm`
  (`verifyOtp` token_hash, invite/confirmation). Shared provisioning in `utils/dara/auth-finalize.ts`.
- **Legal docs:** edit `.docx` in `public/legal/`, run `node scripts/gen-legal.mjs`, commit both. Bumping
  the ToS "Version x.y" line auto-prompts users to re-accept on `/app/account/legal`.
- **Invites now work (DARA-045, §8)** via Resend SMTP + the `/auth/confirm` token_hash flow. Do NOT revert any
  email template to Supabase's `{{ .ConfirmationURL }}` — that's the implicit `#access_token` flow our routes
  can't read. Site URL must stay the **bare origin** (`{{ .SiteURL }}/auth/confirm` links break with a path).
- **Avatars live in a PUBLIC bucket `dara-avatars`** (non-CUI; public read, no signed URLs). Uploads go through
  the **service-role** client with magic-byte checks (`utils/dara/avatar.ts`); the DB `avatar_url` is a public
  URL with a `?v=` cache-bust. Shared render via `components/dara/Avatar.tsx`.
- **"Connect Google" needs Manual Linking ON** in Supabase (operator). Until then the button fails gracefully
  with a "not enabled yet" message — the rest of `/app/account/profile` works regardless.

---

## 4. Backlog (non-security)

1. **PDF-export minor format polish** — user reported small issues, **deferred by them** ("tweak later").
2. **SAM.gov import** — dashboard button disabled; blocked on a SAM.gov API key/entitlement (operator).
3. **Annotated export follow-ups** — per-direct-review persona selector; annotate the *original* uploaded
   `.docx` in place (preserve formatting) instead of rebuilding from text; batch anchoring for huge finding sets.
4. Nice-to-haves: rename/edit metadata from the solicitations LIST; richer built-in persona templates.
5. ~~**New Solicitation — review-mode path selection up front**~~ — **SHIPPED 2026-07-06** (`6b12d74`), see §2.10.
   First screen is now two explanatory cards (Direct AI vs Color Team); Color Team hides the response-doc upload.

---

## 5. SECURITY BACKLOG — top priority (`SECURITY_BACKLOG.md`)

CMMC L2 / NIST 800-171 / OWASP re-audit (2026-07-05). **Prior hardening holds — no regressions**
(26/26 `dara_*` tables RLS, `withTenant` everywhere, Stripe webhook verified, CUI encrypted, admin gating
fail-closed, prompt-injection fencing, no LLM tool-calling). Re-audit findings are now **unified into the
DARA-xxx register as `DARA-021..045`** (was `SEC-01..23`) — in `security-content.ts` (admin-gated
`/app/security`) + the untracked `SECURITY_BACKLOG.md` (file:line evidence; don't commit while open).

- **Fixed this session:** DARA-024 (annotated egress, prior), DARA-026 (isActive fail-closed), DARA-027
  (sol-delete removeStored), DARA-028 (CSV escaping), DARA-030 (export/re-run audit), DARA-034 (cron fail-closed).
- **In progress:** DARA-031 (MFA/2FA — opt-in shipped; **tenant-wide enforcement** is the remaining step).
- **P1 open:** DARA-021 **no rate limiting / WAF** (SC-5). DARA-022 **`next@14.2.35` HIGH advisories** (SSRF,
  middleware bypass) → 14→15 migration. DARA-023 **CI gates don't block deploys** (branch protection + CI-gated deploy).
- **P2 open:** **DARA-025 cross-department BOLA** on child mutation/delete actions (authorize child by
  `companyId` only, not the viewable parent sol) — the next code chunk. DARA-029 crypto key-rotation.
  DARA-032 decompression-bomb guard. DARA-033 CSP nonce.
- **P3 open:** DARA-035 CI RLS-drift + isolation test · DARA-036 SHA-pin Actions · DARA-037 scan SBOM ·
  DARA-038 kill latent `dangerouslySetInnerHTML` · DARA-039 generic client errors · DARA-040 password policy ·
  DARA-041 audit retention · DARA-042 persona-injection residual · DARA-043 tenant right-to-delete ·
  DARA-044 company doc retention/archive limits · **DARA-045 (Moderate) invite email — see §8**.
- **Suggested next:** DARA-025 (BOLA sweep) on code; **operator:** DARA-023 (branch protection), DARA-022
  (Next 15), DARA-031/040 (enforce MFA / password policy). _(DARA-045 invites now work end-to-end — see §2.0/§8.)_

---

## 6. Fast restart

```bash
git status                       # expect clean main, HEAD 6eeb625 (== last deployed)
git log --oneline -14
pnpm install
pnpm exec tsc --noEmit
pnpm build                       # must pass; newest route: /app/account/profile (name/avatar/password/link Google)
# Deploy (prod = main, MANUAL): git push origin main && vercel deploy --prod --yes ; confirm via MCP list_deployments
# Schema first: pnpm prisma migrate deploy (targets prod via .env.local) BEFORE the code deploy
# Diagnose prod: Vercel MCP get_runtime_errors / get_runtime_logs
#   (projectId prj_I6CLDhGJlbjro2Mc67i1AyyHpciP, teamId team_hluvXIDuWYVTRTyXnqxTbfWg)
```

## 7. Key files

- **Account self-service (2.0):** `app/app/account/profile/{page,ProfilePanel,PasswordPanel,SignInMethodsPanel,actions}.tsx|ts`;
  avatar storage `utils/dara/avatar.ts` (public `dara-avatars` bucket) + `scripts/create-avatars-bucket.mjs`;
  shared `components/dara/Avatar.tsx`; `dara_users.avatar_url` migration `20260707000000_user_avatar`.
- **Dept editor on the list (2.0):** `components/dara/DepartmentEditor.tsx` + `setDepartmentsAction` in
  `app/app/solicitations/page.tsx` (gate `canManageDepartments`, `utils/dara/sol-access.ts`).
- **Email templates (2.0):** `supabase/templates/*.html` (12) + `README.md` (dashboard slot map); all link
  templates target `/auth/confirm` token_hash. Sidebar avatar/Profile link in `components/layout/Sidebar.tsx`.
- **2FA (DARA-031):** `app/api/auth/2fa/{setup,verify,challenge,disable}/route.ts`, `utils/dara/mfa.ts`
  (bcrypt backup codes), `utils/dara/mfa-cookie.ts` (Edge-safe HMAC marker), `app/app/account/security/*`,
  `app/auth/2fa-challenge/*`, `middleware.ts` (AAL2 gate), onboarding step `app/onboarding/OnboardingTwoFactor.tsx`.
- **Legal/TOS:** `public/legal/*.docx` + `scripts/gen-legal.mjs` → `utils/dara/legal-content.ts`;
  `components/dara/LegalDocument.tsx`; `app/onboarding/OnboardingAgreement.tsx`; `app/app/account/legal/*`;
  `acceptLegal()` in `app/onboarding/actions.ts`; `dara_users.tos_*`.
- **Auth email links:** `app/auth/callback/route.ts` (PKCE), `app/auth/confirm/route.ts` (token_hash),
  shared `utils/dara/auth-finalize.ts`; `supabase/templates/invite.html`; invite send in `utils/dara/teams.ts`.
- **Invites:** `resendInvitation`/`revokeInvitation`/`inviteUser` in `app/app/team/actions.ts`, UI `TeamView.tsx`.
- **Security register:** `utils/dara/security-content.ts` (renders `/app/security` + `/plan`), `SECURITY_BACKLOG.md`
  (untracked), `utils/dara/audit.ts`, `utils/prisma.ts` (`withTenant`), `utils/dara/provision.ts` (getDaraUser/findDaraUserRaw).
- **Chrome:** `components/layout/ChromeGate.tsx` (bares /app, /signin, /auth, /onboarding, /welcome).

---

## 8. DARA-045 — team invites now WORK (link side closed 2026-07-06 night)

**Resolved for the normal flow.** A test invite delivers and lands the invitee on `/welcome` signed in.
Two things closed it this session:

1. **Delivery** — operator configured **Resend Custom SMTP** in Supabase, so the built-in "email rate limit
   exceeded" cap no longer applies.
2. **The link** — the earlier dead link was Supabase's *default implicit-flow* template dumping the session in
   the URL `#fragment` on `/signin/...`, which no server route can read. Fixed by **Option A config**: Site URL
   = bare `https://dara.crucibleinsight.com`, redirect allowlist `…/**`, and the branded token_hash "Invite
   user" template (`supabase/templates/invite.html`) pasted into the dashboard. Links now hit `/auth/confirm`
   (`verifyOtp` on `token_hash`) → provision → onboarding/welcome.

**Residual (minor, optional):** `inviteUserByEmail` still errors "A user with this email address has already
been registered" when re-inviting an address that a prior invite already registered. The invitation ROW is
source-of-truth, so that person can just sign in. If you want clean **resend-to-existing**, the code-owned path
is `admin.generateLink` (`type=invite` for new / `type=magiclink` for existing) sent via Resend — needs
`RESEND_API_KEY` + a verified `crucibleinsight.com` from-domain. Not built (not needed for the normal flow).
Remember to **paste the other 11 branded templates** too (§2.0) so all auth emails match.
```
