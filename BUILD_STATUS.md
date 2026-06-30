# DARA — Build Status & Decisions

_Last updated: 2026-06-30_

**Production:** https://dara.crucibleinsight.com (alias: https://ci-dara.vercel.app)
**Vercel project:** `crucible-insight/ci-dara` · **Branch:** `main` (committed & deployed)
**Deploy method:** GitHub→Vercel auto-deploy is **not firing**; deploys are done manually via `vercel --prod --yes` after `git push`. (See §4.)
**Stack:** Next.js 14.2.35 (App Router) · Prisma 7 · Supabase (Postgres + Auth + Storage) · Stripe · Vercel

---

## 1. Summary

The app was migrated to a new Supabase project, its (previously never-passing)
build was fixed, the DARA persona + evaluation engine was ported from the
WordPress plugin and wired end-to-end, and admin/billing and a prototype-matched
UID redesign were added. The app builds green and is deployed to production.
The UI redesign was then completed across all pages, and a full NIST 800-171 /
CMMC L2 / OWASP **security audit** was performed (2026-06-27) with an in-app
Security page and the first wave of remediations shipped (see §3 / §5).

---

## 2. Key decisions (with rationale)

| Area | Decision | Why |
|------|----------|-----|
| **Prisma 7 runtime** | `@prisma/adapter-pg` driver adapter, constructed with `DATABASE_URL` | Prisma 7 no longer reads the datasource URL from the schema/`prisma.config.ts` at runtime; a driver adapter is the supported path. `prisma.config.ts` now loads the CLI datasource URL from env (`DIRECT_URL`) — no longer hardcoded (fixed DARA-001). |
| **PDF extraction** | `unpdf` (not `pdf-parse`) | `pdf-parse` v2 works locally but fails in Vercel's serverless runtime (pdfjs worker/asset tracing). `unpdf` ships a worker-free serverless pdfjs build. DOCX still uses `mammoth`. |
| **Auth provisioning** | Call `provisionNewUser` on email+password sign-in too | Provisioning previously only ran in `/auth/callback` (OAuth/magic-link), so password users had "no account information". |
| **Admin model** | **Application Admin** = company-less platform operator (`dara_platform_admins`), DB-backed and bootstrapped from `PLATFORM_ADMIN_EMAILS`; company admin via `UserRole = company_admin` | Formalized 2026-06-30. Separation of duties (CMMC AC-5/AC-6): an app admin manages accounts/users/platform settings but has **no tenant context → no CUI**, by construction. Env-listed emails are auto-provisioned and can't be removed in-app (bootstrap root). **Behavior change:** an email in `PLATFORM_ADMIN_EMAILS` no longer gets a company workspace — use a separate account for company/CUI access. |
| **Platform AI config** | Platform LLM keys (encrypted) + central provider/model live in a singleton `dara_platform_settings`, edited **only** in the Application Admin console; platform-mode evaluations resolve from it (a console key overrides the `PLATFORM_*_KEY` env fallback) | 2026-06-30. One place to manage platform keys + model; `resolveCompanyAI(company, platform)` uses the central provider/model/key in platform mode. Company provider/model selectors apply to **BYOK only**. Env keys remain a transition fallback until moved into the console. |
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
   solicitations; `JobQueue` table exists but is unused (future: cron worker).
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
    was removed from the env allow-list and **deactivated** in the console, reverting it to
    a normal user (company **"Proposal Foundry"**, `company_admin`). Its `dara_platform_admins`
    row was kept (deactivated) per request. Current admins: `islanista@gmail.com` (env-pinned)
    + `admin@crucibleinsight.com` (DB). NOTE: `PLATFORM_ADMIN_EMAILS` is stored **Sensitive**,
    so `vercel env pull` shows it blank — use `vercel env add … --value … --force` to set it.
11. **Open security findings** (full detail + status on `/app/security`). **None
    open.** DARA-007 (CUI→LLM) is **Risk accepted** with controls. Latest closures:
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
- **No open findings remain.** DARA-007 is Risk accepted with controls.

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

**Pick up next session — see `SESSION_HANDOFF.md` for the full plan.** Top of queue:
1. **Operator actions (you):** (a) enable branch protection on `main` (item #13) —
   the only thing gating DARA-015 from "enforced"; (b) set the Supabase Auth Site URL +
   **Confirm email ON** (#1) so Team invite emails resolve and the verification gate is
   real; (c) move the platform Anthropic key into **Application Admin → Platform AI** and
   retire `PLATFORM_ANTHROPIC_KEY` (#14).
2. **Verify in prod:** the full onboarding flow with a brand-new Google account; billing
   page renders (the `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` note); a real multi-criteria
   evaluation end-to-end.
3. Feature backlog: per-company admin **audit-log viewer** (home in the Team page); the
   AI codebase security-audit (back-office, platform key).
4. Product backlog (§5): Reporting phase 2, evaluation robustness (JobQueue + cron),
   billing polish.
