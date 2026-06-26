# DARA — Build Status

_Last updated: 2026-06-26_

Production: **https://ci-dara.vercel.app** (Vercel project `crucible-insight/ci-dara`)
Branch: `main` — all work below is committed and deployed.

---

## 1. Summary

The app was migrated to a new Supabase project, its (previously never-passing)
build was fixed, and the DARA persona + evaluation system was ported from the
original WordPress plugin and wired end-to-end. The app builds green and deploys
to production.

---

## 2. Completed

### Infrastructure / migration
- Migrated to new Supabase project `djcgfejogflbqaqtuhtk`.
- Connection strings updated in `.env.local` **and** Vercel env (all envs):
  `DATABASE_URL` (transaction pooler, 6543), `DIRECT_URL` (session pooler, 5432),
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `PLATFORM_ANTHROPIC_KEY`.
- `prisma db push` created all tables in the new DB; `prisma generate` wired into
  the build (`prisma generate && next build`).
- **Prisma 7 runtime fix:** added the `@prisma/adapter-pg` driver adapter — Prisma 7
  no longer reads the datasource URL from the schema/`prisma.config.ts` at runtime,
  so the client is constructed with a pg adapter using `DATABASE_URL`.
- Private Supabase Storage bucket `dara-documents` created.
- Seeded login user `david@crucibleinsight.com` (email pre-confirmed).

### Build fixes (pre-existing breakage)
- Standardized Supabase client typing across `@supabase/ssr` and
  `@supabase/supabase-js` (was a hard type error).
- Deferred the Supabase admin client creation to first use (build-time page-data
  collection was constructing it with an empty key).
- Account provisioning now also runs on **email+password** sign-in (previously only
  on `/auth/callback`, so password users had "no account information").

### Features
- **Solicitation detail page** (`/app/solicitations/[id]`): edit/delete the
  solicitation; full CRUD on **criteria** and **offerors**.
- **Personas** (`/app/personas`): five built-in evaluator personas auto-seeded
  (Technical Evaluator, Contracting Officer, Past Performance, Management & Risk,
  Small Business); full CRUD + active toggle + restore-defaults.
- **Evaluation pipeline** (`utils/dara/`):
  - `prompt.ts` — system/user prompt builder + JSON parser (per-criterion-type
    schemas: scored_factor / compliance / administrative).
  - `providers.ts` — Anthropic / OpenAI / Google clients + company AI-config
    resolution (platform key or BYOK).
  - `evaluator.ts` — runs one evaluation (offeror × persona) across all criteria.
  - `documents.ts` — Storage upload + server-side text extraction (PDF via
    pdf-parse v2, DOCX via mammoth, plain text).
  - Solicitation page wiring: upload RFP/proposal docs, per-offeror **Run
    evaluation** (synchronous, `maxDuration=300`), results view (score /
    determination + confidence + rationale per criterion per persona).

---

## 3. Known gaps / not yet verified

1. **Supabase Auth URL config (dashboard — your action).** Site URL + redirect
   allow-list must be set so confirmation/magic-link emails stop pointing to
   `localhost:3000`. Set Site URL = `https://dara.crucibleinsight.com` and add
   redirect URLs `https://dara.crucibleinsight.com/**` and
   `http://localhost:3000/**`. (Requires dashboard or a Supabase management token.)
2. **Live AI run not yet executed.** Build is green and the platform key is set,
   but no real Anthropic round-trip has been run end-to-end.
3. **BYOK keys not wired.** Only platform mode works (company default). The WP
   key-encryption (`Crypto`) was not ported, so bring-your-own-key needs that.
4. **Synchronous evaluation.** Large solicitations (many personas × criteria) can
   approach the 300s function limit. The `JobQueue` table exists but is unused.
5. **All active personas run all criteria.** The WP plugin's per-criterion persona
   assignment was not ported.
6. **Not ported from WP:** Compliance Matrix, Reports/export, audit log, settings UI.
7. **No OCR.** Scanned/image-only PDFs won't yield text; administrative (font /
   margin) checks are limited by text extraction (same limitation as WP).
8. **Stripe webhooks** won't verify until `STRIPE_WEBHOOK_SECRET` is set (currently
   empty). Only relevant if billing is used.

---

## 4. Next steps (suggested order)

1. Set the Supabase Auth Site URL + redirect URLs (unblocks new signups).
2. Smoke-test one real evaluation end-to-end (upload a proposal, Run evaluation).
3. Build a **Settings** page (`/app/settings`) for company AI config:
   provider/model selection and BYOK key entry (port the `Crypto` encryption).
4. Move evaluations to the **JobQueue + Vercel Cron** model for robustness at scale
   (the original WP design; avoids function timeouts). `CRON_SECRET` is already set.
5. Per-criterion persona assignment.
6. Results aggregation / scoring rollup, plus Reports + Compliance Matrix (port the
   remaining WP modules) and export.
7. (Optional) OCR for scanned PDFs.

---

## 5. Key env vars (set on Vercel, all environments)

`DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`, `PLATFORM_ANTHROPIC_KEY`.
(`STRIPE_WEBHOOK_SECRET` is still empty.)
