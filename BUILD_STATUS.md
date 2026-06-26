# DARA — Build Status & Decisions

_Last updated: 2026-06-26_

**Production:** https://dara.crucibleinsight.com (alias: https://ci-dara.vercel.app)
**Vercel project:** `crucible-insight/ci-dara` · **Branch:** `main` (all work below committed & deployed)
**Stack:** Next.js 14 (App Router) · Prisma 7 · Supabase (Postgres + Auth + Storage) · Stripe · Vercel

---

## 1. Summary

The app was migrated to a new Supabase project, its (previously never-passing)
build was fixed, the DARA persona + evaluation engine was ported from the
WordPress plugin and wired end-to-end, and admin/billing and a prototype-matched
UID redesign were added. The app builds green and is deployed to production.

---

## 2. Key decisions (with rationale)

| Area | Decision | Why |
|------|----------|-----|
| **Prisma 7 runtime** | Use `@prisma/adapter-pg` driver adapter, constructed with `DATABASE_URL` | Prisma 7 no longer reads the datasource URL from the schema or `prisma.config.ts` at runtime; a driver adapter is the supported path. URLs stay in `prisma.config.ts` for the CLI. |
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
- **UI redesign (in progress)**: foundation + shell (IBM Plex, accent, sidebar,
  full-screen app), **sign-in** (two-panel brand layout), **dashboard** (stat
  cards + recent activity + plan panel). `dara-logo.png` in sidebar/sign-in +
  favicon; company name under the DARA badge; `starter`→"Base" label.

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

---

## 5. Next steps (suggested order)

1. **Finish the UI redesign** (task in progress):
   - Solicitations **list** + **detail** (tabs: Overview / Documents / Criteria /
     Offerors / Matrix) to match the prototype.
   - Personas, Settings, Billing, Admin → align cards/tables/badges/mono labels.
   - Optional: rebuild the OAuth button block (Google/Microsoft) to match.
2. **Reporting (phase 2)** — port WP **Reports** + **Compliance Matrix**:
   - Scoring rollup per offeror (weighted by criterion `weight`, aggregated
     across personas), comparison/compliance matrix, PDF/CSV export.
3. **Evaluation robustness** — move runs to the `JobQueue` + a Vercel Cron worker
   (`CRON_SECRET` already set) to avoid function timeouts at scale; add
   per-criterion persona assignment.
4. **Billing polish** — map raw `starter` → "Base" on the billing page; handle
   `customer.subscription.paused`.
5. **Housekeeping** — optimized logo asset; smoke-test a real evaluation run.

---

## 6. Key paths

- Engine: `utils/dara/{prompt,providers,evaluator,documents,personas,billing,crypto,admin,provision}.ts`
- App shell: `app/app/layout.tsx`, `components/layout/{Sidebar,ChromeGate}.tsx`
- Pages: `app/app/{dashboard,solicitations,personas,settings,billing,admin}/…`
- Webhook: `app/api/webhooks/route.ts`
- Design tokens: `tailwind.config.js`, `styles/main.css`, fonts in `app/layout.tsx`
