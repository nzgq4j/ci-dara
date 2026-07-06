# DARA — Session Handoff

_Prepared: 2026-07-06 · HEAD `1754cf6` · branch `main` (clean) · last DEPLOYED commit `2e2e74c` · for: next session_

Start-here doc. Everything below is **live on production** (`dara.crucibleinsight.com`) unless flagged
otherwise. NOTE: HEAD `1754cf6` is one commit ahead of the last deploy — it's just the DARA-045 register
text (`security-content.ts`); deploy it with the next change. **Top priority next: DARA-045 (team invites
don't email — see §5/§8) and the rest of the security backlog** (`SECURITY_BACKLOG.md`, §5). Agent memory
(load first): `security-reaudit-2026-07.md`, `mfa-totp.md`, `legal-tos.md`, `personas-review-lens.md`,
`billing-and-backlog.md`. Deep decision log: `BUILD_STATUS.md`.

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

## 2. What shipped THIS session (2026-07-06) — security fixes, 2FA, legal/TOS, invites, auth

Commits `258a5eb` → `1754cf6`. All DEPLOYED through `2e2e74c` (last two are register-text only). **Two prod
migrations applied this session** (`20260706000000_user_mfa`, `20260706010000_user_legal_acceptance`).

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
- **⚠️ Team invite emails don't reliably send (DARA-045, §8)** — Supabase built-in email rate-limits + can't
  re-send to an already-registered address. Not yet fixed (user deferred).

---

## 4. Backlog (non-security)

1. **PDF-export minor format polish** — user reported small issues, **deferred by them** ("tweak later").
2. **SAM.gov import** — dashboard button disabled; blocked on a SAM.gov API key/entitlement (operator).
3. **Annotated export follow-ups** — per-direct-review persona selector; annotate the *original* uploaded
   `.docx` in place (preserve formatting) instead of rebuilding from text; batch anchoring for huge finding sets.
4. Nice-to-haves: rename/edit metadata from the solicitations LIST; richer built-in persona templates.
5. **New Solicitation — review-mode path selection up front** — make the **first** modal after clicking
   "New Solicitation" a **path picker** presented as **two cards** that explain each path, chosen *before*
   the solicitation is built:
   - **Color Team review** — process-mode gate reviews. In this path the creator does **not** upload response
     (proposal) documents during creation; response drafts are attached per-review later (`ReviewDocument`).
   - **Direct AI review** — the one-click unified review. In this path the creator **does** upload response
     documents as part of creation (they feed the `direct_ai` review).
   Each card = a short title + 2–3 line description of what the path does, so the user picks intentionally.
   The choice sets `solicitation.mode` (`color_team` vs `direct_ai`) and branches the rest of the create
   wizard (show/hide the response-doc upload step). Files: `app/app/solicitations/new/page.tsx` (+ its create
   flow/components); mode field already exists on `Solicitation` and is read across the detail page
   (`isDirect = solicitation.mode === 'direct_ai'`). Requested by user 2026-07-06.

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
- **Suggested next:** DARA-045 (unblock invites) + DARA-025 (BOLA sweep) on code; **operator:** DARA-023
  (branch protection), DARA-022 (Next 15), DARA-031/040 (enforce MFA / password policy).

---

## 6. Fast restart

```bash
git status                       # expect clean main, HEAD 1754cf6 (1 ahead of deploy = register text)
git log --oneline -14
pnpm install
pnpm exec tsc --noEmit
pnpm build                       # must pass; newest routes: /auth/confirm, /app/account/{security,legal}, /auth/2fa-challenge
# Deploy (prod = main, MANUAL): git push origin main && vercel deploy --prod --yes ; confirm via MCP list_deployments
# Schema first: pnpm prisma migrate deploy (targets prod via .env.local) BEFORE the code deploy
# Diagnose prod: Vercel MCP get_runtime_errors / get_runtime_logs
#   (projectId prj_I6CLDhGJlbjro2Mc67i1AyyHpciP, teamId team_hluvXIDuWYVTRTyXnqxTbfWg)
```

## 7. Key files (this session)

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

## 8. ⚠️ DARA-045 — team invite emails don't send (deferred by user 2026-07-06)

Confirmed: Supabase's **built-in email** blocks invites — `inviteUserByEmail` fails with **"email rate limit
exceeded"** (shared sender, a few/hour) and **"A user with this email address has already been registered"**
when re-sending to an address a prior invite already registered. **The link side is FIXED** (`/auth/confirm`
token_hash, so once an email lands the link completes → onboarding). **User deferred the fix.**

**The real fix = code-owned email via Resend:** send our own branded email, minting links with
`admin.generateLink` (`type=invite` for new users, `type=magiclink` for existing) — works for first-invites
AND resends, no rate cap. Needs `RESEND_API_KEY` in Vercel + a verified `crucibleinsight.com` from-domain
(SPF/DKIM/DMARC). Interim stopgap: Custom SMTP in Supabase raises the cap but still can't re-send to an
existing address. **Workaround today:** the invitation ROW is source-of-truth, so an invitee can still join
by signing in. Also: the branded `supabase/templates/invite.html` still needs pasting into the Supabase
dashboard (its link now uses `/auth/confirm`).
```
