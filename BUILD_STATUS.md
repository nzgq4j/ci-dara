# DARA — Build Status & Decisions

_Last updated: 2026-06-27_

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
| **Admin model** | Platform admin via email allow-list (`PLATFORM_ADMIN_EMAILS`, fallback list); company admin via `UserRole = company_admin` | No super-admin concept existed in the schema; email allow-list is simple and explicit. |
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

---

## 3. Completed

### Infrastructure / migration
- New Supabase project `djcgfejogflbqaqtuhtk`; all connection strings + keys in
  `.env.local` and Vercel: `DATABASE_URL`, `DIRECT_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `PLATFORM_ANTHROPIC_KEY`,
  `APP_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `prisma db push` + `prisma generate` (wired into the build); pg driver adapter.
- Private Supabase Storage bucket `dara-documents`.
- Seed login user `david@crucibleinsight.com` (pre-confirmed).

### Build fixes (pre-existing breakage)
- Supabase client typing across `@supabase/ssr` / `supabase-js`; lazy admin
  client; `prisma generate` in the build script; client BigInt/Date no longer
  passed to the client `Header` (fixed a client-side exception on mutations).

### Features
- **Solicitations**: list, create, detail with full CRUD on criteria & offerors.
- **Personas** (`/app/personas`): 5 built-ins auto-seeded; full CRUD + active toggle.
- **Evaluation pipeline** (`utils/dara/`): prompt builder, providers
  (Anthropic/OpenAI/Google + platform/BYOK resolution), evaluator, document
  upload + extraction (unpdf/mammoth), per-offeror **Run evaluation**
  (synchronous, `maxDuration=300`), results view.
- **Settings** (`/app/settings`, company admin): AI config + encrypted BYOK keys
  + company user management.
- **Admin** (`/app/admin`, platform admin): manage all accounts (plan, status,
  trial end, AI config) and all users.
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

1. **Supabase Auth URL config (your action, dashboard).** Set Site URL =
   `https://dara.crucibleinsight.com` and add redirect URLs
   `https://dara.crucibleinsight.com/**`, `http://localhost:3000/**`. Until then,
   confirmation/magic-link emails point at `localhost`.
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
11. **Open security findings** (full detail + status on `/app/security`). Highest
    remaining: DARA-007 (CUI→LLM boundary/retention), DARA-002 (secrets handling),
    DARA-010 (admin model). (DARA-003, DARA-004, DARA-009, DARA-013, and the
    DARA-014/016/018/019 quick wins remediated 2026-06-28; DARA-015 CI gates in
    progress.)
12. **Evaluation ignores the persona active toggle (functional bug, not security).**
    A production run scored against personas that were toggled off; "Run evaluation"
    should use only `isActive: true` personas (and/or the matrix shows stale results
    from prior runs). Investigate `runEvaluations` in `app/app/solicitations/[id]/page.tsx`
    and the matrix/results rendering. Logged 2026-06-28.

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
  **In progress** — CI added (gitleaks secret scan, frozen-lockfile + dependency
  audit, CodeQL SAST); branch protection + SBOM remain.
- **Larger, dedicated passes:** ~~DARA-004 (least-privilege DB role + per-tenant
  RLS)~~, ~~DARA-009 (encrypt CUI at rest)~~, and ~~DARA-013 (append-only audit
  trail)~~ **done 2026-06-28**; remaining: DARA-007 (CUI→LLM data-boundary /
  zero-retention decision).

---

## 6. Key paths

- Engine: `utils/dara/{prompt,providers,evaluator,documents,personas,billing,crypto,admin,provision}.ts`
- App shell: `app/app/layout.tsx`, `components/layout/{Sidebar,ChromeGate}.tsx`
- Pages: `app/app/{dashboard,solicitations,personas,settings,billing,admin}/…`
- Webhook: `app/api/webhooks/route.ts`
- Design tokens: `tailwind.config.js`, `styles/main.css`, fonts in `app/layout.tsx`
- Design primitives: `components/dara/{theme.ts,PageHeader.tsx,Tabs.tsx}`
- Security page + content: `app/app/security/page.tsx`, `utils/dara/security-content.ts`
- Security SQL artifact: `prisma/security/2026-06-27_lock_dara_tables.sql`
- Security headers: `next.config.js`
