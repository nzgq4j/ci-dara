# DARA — Security Backlog (CMMC L2 / NIST 800-171 r3 re-audit)

_Generated 2026-07-05 · updated 2026-07-06 · multi-domain re-audit (tenant isolation, authN/authZ,
data/crypto, web/DoS, supply-chain/CI, LLM/AI + audit logging) against CMMC 2.0 L2 / NIST 800-171 r3 /
NIST 800-53 r5 / OWASP (Top 10, API, LLM) + SaaS hardening best practice._

> **SENSITIVE — open findings. Do NOT commit to a public repo while items are open** (matches how
> `SECURITY_AUDIT.md` was handled). This file is intentionally untracked.

## Numbering (unified 2026-07-06)
These findings are now folded into the **single DARA-xxx register** used in-app at `/app/security`
(the June register ended at DARA-020, so the re-audit items are **DARA-021…043**). The original
`SEC-0x` id is kept in parentheses for traceability with the older session notes / agent memory.
Summary-level entries for every item below are mirrored in the committed, admin-gated
`utils/dara/security-content.ts`; the **file:line exploit detail lives only here** (untracked).

**Fixed since the re-audit (6):** DARA-024 (SEC-04, `7fe23ab`) · DARA-026 (SEC-06) · DARA-027 (SEC-07)
· DARA-028 (SEC-08) · DARA-030 (SEC-10) · DARA-034 (SEC-14) — the last five this session.

## Baseline: prior hardening still holds
The June 2026 remediations (DARA-001…019) are **intact — no regressions found**. Notably:
- **Tenant isolation: 26/26 `dara_*` tables** carry RLS + least-privilege grants; every new path
  (`direct-review`, `passes`, `annotated-proposal`, `report-data`, export routes, all solicitation
  server actions) routes through `withTenant()` with `companyId`-scoped queries. No missing-RLS drift.
- CUI `extracted_text` encrypted at rest on the **new** per-review upload path too (AES-256-GCM).
- Stripe webhook signature verified (fail-closed); admin gating env-only fail-closed; open-redirect
  (DARA-018) intact; prompt-injection fencing on all **primary** prompt builders; no LLM tool-calling;
  AI token caps + 240s timeout; strong security headers; no SSRF; no secrets in tracked files.

The items below are **net-new attack surface** shipped since June + **best-practice hardening** + a few
**operator config verifications**. Nothing here indicates a live cross-tenant breach.

---

## P1 — High (address next; CMMC L2 gaps or real exposure)

### DARA-021 (SEC-01) · No rate limiting / abuse protection anywhere — NIST SC-5, OWASP A10 / LLM04
No WAF, BotID, Firewall, Attack Mode, or app-level rate limits exist (`vercel.json` has only the cron).
Expensive authenticated endpoints are unbounded per tenant: the `/annotated` route (live LLM call,
`maxDuration=300`, **no trial gate**), **review/pass re-runs** (trial meter only fires on the *first*
run; re-runs are free), `/report/pdf`, DOCX/CSV export, and uploads. On any **non-trial** plan, trial
metering short-circuits entirely, so a paid tenant can drive unlimited LLM egress + spend.
- **Fix:** Vercel WAF rate-limit rules (or Upstash/edge limiter) on AI-run / export / upload / auth
  paths; BotID on auth; a per-tenant AI call/cost budget or re-run throttle.
- _SC-5 (DoS protection) is an expected L2 control._

### DARA-022 (SEC-02) · `next@14.2.35` — 5 HIGH production advisories, 14.x is a patch dead-end — NIST SA-10/11, SR-3, OWASP A06
`pnpm audit --prod --audit-level high` fails (exit 1). `next` prod advisories include **SSRF**
(GHSA-c4j6-fc7j-m34r), **middleware/proxy bypass** (GHSA-3g8h-86w9-wvmq), and multiple **RSC DoS**;
all fixes are on the **15.x** line — 14.2.x will not receive them.
- **Fix (operator/dev):** plan a Next.js **14 → 15** migration with regression testing. Until then,
  the SSRF/middleware-bypass advisories are unpatched in prod.

### DARA-023 (SEC-03) · CI security gates do not block deploys — NIST CM-3, SA-10, SR-4
Branch protection on `main` is still **not enforced** (carried from the prior audit), AND **Vercel
deploys on git push independently of GitHub Actions** — so a red `Security`/`CodeQL` check (currently
red, per DARA-022) does not stop a production deploy. The gates are informational today.
- **Fix (operator):** enable branch protection requiring `Security` + `CodeQL` status checks + block
  force-push/deletion on `main`; gate Vercel prod deploy on CI (Vercel "ignored build step" tied to
  CI, or deployment protection).

### DARA-024 (SEC-04) · Annotated-export CUI→LLM egress is unaudited AND unfenced — NIST AU-2/AU-3, OWASP LLM01, breaks DARA-007 — ✅ FIXED (`7fe23ab`)
`/annotated` → `generateAnnotatedProposal` → `anchorFindings` sends the **full decrypted proposal
(up to 200k chars)** to the commercial LLM. Fixed: (a) `recordAudit({action:'annotated.export', …})`
at the egress records provider/mode/reviewId; (b) the proposal is wrapped with the shared
`fenceUntrusted()` + `INJECTION_GUARD` like every other builder.

---

## P2 — Medium (net-new code gaps; straightforward fixes)

### DARA-025 (SEC-05) · Cross-department BOLA on child mutation/delete actions — NIST AC-3/AC-6, OWASP API1/A01
Department scoping (`sol-access.ts`, app-layer; DB RLS is company-level only) is enforced on *create*
via `requireViewableSolicitation`, but several *mutate/delete* actions authorize the child by
**`companyId` only**, not by the viewable parent solicitation. A `reviewer` or out-of-department member
can act on a sibling department's data with a guessable sequential ID:
- No viewability gate at all: `updateRequirement`, `saveMatrixRow`, `deleteRequirement` (page.tsx:361/397/421),
  `deleteSolDoc` (:698). — _verified: only `requirement.findFirst({id, companyId})`._
- Gate `solId` but act on a separately-supplied child id: `runReviewAction`, `rerunPassAction`,
  `regenerateResultAction`, `archiveResultAction`, `applyChangeAction`, `enqueueReconcileAction`.
- **Impact:** same-tenant only (no cross-company leak), but unauthorized **tamper/delete** + **triggering
  AI runs (cost + CUI egress)** on another department's data.
- **Fix:** resolve each child through its parent solicitation and run `requireViewableSolicitation` on
  that sol before mutating (the `uploadReviewDoc` pattern). Also tie `reviewId`/`passId` to the checked `solId`.
- _Note: line numbers above predate this session's edits to `page.tsx` — re-locate the actions by name._

### DARA-026 (SEC-06) · Deactivated / banned users retain application access — NIST AC-2, IA-4 — ✅ FIXED (this session)
`getDaraUser` (`provision.ts`) did not filter `isActive`, and only the app-shell layout checked it, so
server actions and route handlers that resolve the current user directly stayed reachable for a banned
user (the Supabase-side ban is best-effort + tokens live to `jwt_expiry`).
- **Fix shipped:** `getDaraUser` now returns `null` when `isActive === false` (fail-closed everywhere).
  A new `findDaraUserRaw` is used **only** by `app/app/layout.tsx` so the terminal `AccountDisabled`
  screen still renders. Verify: the disabled screen still appears on navigation, and a direct server-action
  / `/report/pdf` / `/annotated` call from a deactivated account is rejected.

### DARA-027 (SEC-07) · Solicitation delete orphans CUI files in Storage — NIST MP-6, SI-12 — ✅ FIXED (this session)
`deleteSolicitationAction` (`app/app/solicitations/page.tsx`) deleted the row (DB cascade) but **never
`removeStored()`**, leaving raw uploaded PDFs/DOCX (full CUI) in the `dara-documents` bucket.
- **Fix shipped:** before the cascade the action now gathers every `storedFilename` from `SolDocument`
  (rfp/proposal/amendment) **and** `ReviewDocument` (per-review drafts) and `removeStored`s them; the
  audit entry records `removedFiles` count.

### DARA-028 (SEC-08) · CSV formula / DDE injection in matrix CSV export — OWASP A03, CWE-1236 — ✅ FIXED (this session)
`exportMatrixAction` `esc()` only doubled quotes; AI-shredded requirement text like `=cmd|'/c calc'!A1`
executed as a formula/DDE in Excel on a reviewer's workstation.
- **Fix shipped:** cells beginning with `= + - @` / tab / CR are prefixed with `'` before RFC-4180
  quoting. (DOCX export was never affected.)

### DARA-029 (SEC-09) · No crypto key-rotation / rewrap path — NIST SC-12, SC-28
`crypto.ts` derives the key as a bare `SHA-256(APP_KEY)`; the `v1:` prefix is an envelope-format version,
not a **key** version. Rotating `APP_KEY` would render **all** ciphertext (BYOK provider keys + every
`extracted_text`) permanently undecryptable — no key-id tagging, no rewrap migration.
- **Fix:** add a key-id to the envelope + a re-encrypt/rewrap path **before** rotation is ever needed.
  (Optional: move from bare SHA-256 to scrypt/HKDF-with-salt — matters only if `APP_KEY` is ever a passphrase.)

### DARA-030 (SEC-10) · Audit coverage gaps for new CUI egress / exports — NIST AU-2/AU-3 — ✅ FIXED (this session)
Beyond DARA-024, these emitted no audit record: **single-pass re-run** (`rerunPassAction`), and **CUI
export downloads** (`exportMatrixAction` CSV/DOCX, `/report/pdf`).
- **Fix shipped:** `review.pass.rerun` (in `rerunPassAction`), `matrix.export` (in `exportMatrixAction`,
  with format + requirement count), and `report.export` (in the `/report/pdf` route) audit events added —
  action + entity + non-CUI metadata only. _(Per-review upload/delete were already audited.)_

### DARA-031 (SEC-11) · MFA / TOTP 2FA — NIST 800-171 r3 3.5.3 / IA-2 (required for CMMC L2) — 🟡 IN PROGRESS (opt-in shipped this session)
TOTP two-factor is now implemented on **Supabase Auth native MFA** (AAL2): opt-in at
`/app/account/security`, login challenge at `/auth/2fa-challenge`, middleware gates `/app` on AAL2,
10 bcrypt-hashed single-use backup codes, signed httpOnly recovery marker for the backup path,
audited (`mfa.enable/challenge/disable`). The TOTP secret is stored by Supabase, never by us — so no
`TOTP_ENCRYPTION_KEY` and no custom secret columns. Chosen over a hand-rolled parallel TOTP system,
which on a Supabase project would sit beside the already-valid session and be bypassable.
- **Remaining (operator/policy):** turn ON the TOTP factor in the Supabase project
  (Authentication → MFA → TOTP); then move from **opt-in → enforced** (require enrollment for all CUI
  users; optional app-side "must enroll" gate). Password policy/lockout is tracked separately (DARA-040).
- **Files:** `app/api/auth/2fa/{setup,verify,challenge,disable}/route.ts`, `utils/dara/{mfa,mfa-cookie}.ts`,
  `app/app/account/security/*`, `app/auth/2fa-challenge/*`, `middleware.ts` (AAL2 gate), `dara_users`
  migration `20260706000000_user_mfa` (`mfa_enabled`, `mfa_backup_codes`).

### DARA-032 (SEC-12) · Decompression-bomb (zip/xml) risk in doc extraction — NIST SC-5
`assertValidUpload` caps input at 20 MB + magic bytes, but `.docx` (ZIP → mammoth) and PDF (unpdf) are
parsed with **no decompression-ratio / output-size guard** — a crafted 20 MB file can inflate to GBs and
exhaust function memory during `extractText`.
- **Fix:** bound decompressed / extracted-text size during extraction.

### DARA-033 (SEC-13) · CSP allows `'unsafe-inline'` (no nonce) — NIST SC-18, OWASP A05 _(known-deferred)_
`next.config.js` `script-src`/`style-src 'unsafe-inline'`, `img-src https:` (permissive). Little
defense-in-depth against a future injection. This is the previously-deferred nonce item (DARA-011) — still open.
- **Fix:** nonce-based `script-src` to drop `'unsafe-inline'`.

### DARA-034 (SEC-14) · Cron worker fail-open when `CRON_SECRET` unset — NIST AC-3 — ✅ FIXED (this session)
`app/api/cron/passes` allowed unauthenticated calls whenever `CRON_SECRET` was unset.
- **Fix shipped:** `CRON_SECRET` is now **mandatory in production** (500 if it drifts out of env); it stays
  optional outside production. `triggerWorker()` forwards the same bearer, so legit continuations still pass.

---

## P3 — Low / best-practice / hardening

- **DARA-035** (SEC-15) · Add **RLS-drift detection to CI** — query `pg_policies` / grants for every
  `@@map("dara_*")`; fold `dara004-isolation-test.ts` into CI against an ephemeral DB. Currently RLS is
  applied by hand-run scripts with no automated coverage check. · CM-3/CM-6.
- **DARA-036** (SEC-16) · **SHA-pin** third-party GitHub Actions (`gitleaks`, `anchore/sbom-action`) to
  full commit SHAs (currently mutable tags) · SR-3/SR-4.
- **DARA-037** (SEC-17) · **Act on the SBOM** — scan it (e.g. Grype) + add a license allow/deny gate;
  today it's generated but never consumed · SR-3, SA-15.
- **DARA-038** (SEC-18) · Replace the latent `dangerouslySetInnerHTML` (`report/page.tsx:329`, currently
  static literals only) with a plain text node — removes an XSS footgun + fixes a self-assessment
  contradiction · A03.
- **DARA-039** (SEC-19) · **Generic client error messages** — don't surface raw AI-provider error text
  (`failPass` stores `e.message`) or `Webhook Error: ${msg}` to clients; log detail server-side only · A05.
- **DARA-040** (SEC-20) · **Password policy + brute-force lockout** — verify Supabase prod min-length (8+),
  HIBP/leaked-password protection, and auth rate limits; `password.trim()` silently strips edge whitespace · IA-5, AC-7.
- **DARA-041** (SEC-21) · **Audit-log retention/review** — define a retention period + purge/partition
  (unbounded growth) and an AU-6 review cadence (who reads it, when). Append-only integrity is already strong · AU-6/AU-11.
- **DARA-042** (SEC-22) · **Persona-injection residual** — `Persona.systemPrompt` (tenant-admin authored)
  is injected at the system-instruction trust level; the "must not override" framing is soft. Company-scoped,
  so worst case is self-inflicted. Document the trust boundary; optionally constrain persona guidance to
  tone/emphasis or move it out of the system role · LLM01.
- **DARA-043** (SEC-23) · **Tenant/account right-to-delete** — no company-level purge of all CUI (docs,
  findings, storage). Already tracked (GDPR account-deletion backlog) · MP-6, data minimization.
- **DARA-044** · **Company-configurable document retention / archive limits** — uploaded solicitation/
  proposal/amendment docs + per-review drafts (CUI) are retained indefinitely; no per-company policy to
  auto-archive/delete documents after a configurable age. Add a company setting (delete docs + stored
  blobs older than N days/months, optional archive-then-purge window) enforced by a scheduled job that
  `removeStored()`s expired files and audits each purge. Complements DARA-041 (audit retention) +
  DARA-043 (right-to-delete) · SI-12, MP-6, AU-11, data minimization.
- **DARA-045** (Moderate) · **Code-owned transactional email — invites unreliable on built-in email** —
  CONFIRMED 2026-07-06: team invitations don't reliably send on Supabase's built-in email.
  `inviteUserByEmail` fails with **"email rate limit exceeded"** (shared sender caps at a few/hour) and
  **"A user with this email address has already been registered"** when re-sending to an address a prior
  invite already registered (so Resend can't re-email an existing invitee). The **link side is fixed**
  (token_hash `/auth/confirm` flow shipped, commit 2e2e74c); delivery is the blocker. Emails are also
  unbranded / shared-sender (no SPF/DKIM/DMARC). **Fix:** code-owned email via Resend (or Custom SMTP) —
  mint links with `admin.generateLink` (type=invite for new, type=magiclink for existing) + send our own
  branded email; works for first-invites AND resends, no cap. Needs `RESEND_API_KEY` + a verified
  `crucibleinsight.com` from-domain. Interim stopgap: Custom SMTP raises the cap but still can't re-send to
  an existing address. Cover invite + confirm-signup · SI-8, email auth, availability/product.
  _Workaround today: the invitation row is source-of-truth, so an invitee can still join by signing in._

---

## Operator config to verify out-of-band (not visible in repo)
- Supabase **MFA** enforced (DARA-031); **password policy** + leaked-password protection + auth rate limits (DARA-040).
- `dara-documents` storage bucket is **Private** (app never hands out public/signed URLs — good; confirm bucket setting).
- **PITR / backups** retention policy explicitly covers CUI (backups also retain CUI).
- **Branch protection** on `main` (DARA-023).

## Suggested sequence
1. ~~Quick code wins~~ — **DONE this session:** DARA-026 (isActive fail-closed), DARA-027 (removeStored on
   sol delete), DARA-028 (CSV escaping), DARA-030 (export/re-run audit), DARA-034 (cron fail-closed).
   (DARA-024 was fixed in `7fe23ab`.)
2. Bigger code: **DARA-025** (BOLA sweep), **DARA-021** (rate limiting/WAF), **DARA-029** (key rotation),
   **DARA-032**, **DARA-033**.
3. Operator/process: **DARA-023** (branch protection + CI-gated deploy), **DARA-022** (Next 15 migration),
   **DARA-031/DARA-040** (Supabase MFA/password), **DARA-036/DARA-037** (CI hardening).
