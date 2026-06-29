# DARA-002 — Secrets handling (local environment files)

_Status: **Remediated** (residual local-disk presence risk-accepted with controls) · 2026-06-29_

NIST SP 800-171: 03.05.x (IA-5 authenticator management), 03.13.x (SC-12 key
management) · OWASP A07.

## Finding

Live production secrets (Stripe secret/webhook keys, Supabase service-role JWT,
platform Anthropic key, `APP_KEY`, database credentials) were present in local
environment files on the developer workstation. Blast radius if the workstation,
a backup, or a malicious dependency reads the working tree.

## Control model (after remediation)

**The Vercel project (`crucible-insight/ci-dara`) is the authoritative secret
store.** Every runtime secret exists in Vercel's encrypted env. Local files are a
convenience mirror for `pnpm dev`, never the system of record.

- **Never tracked.** `.gitignore` ignores `.env` and `.env.*` (re-including only
  `.env.example`). Verified: no env file other than the secret-free `.env.example`
  is tracked in git. The DARA-001 history scrub confirmed no credentials remain in
  git history.
- **`.env.example` is the committed template** — placeholders only, documents every
  variable the app reads. Enforced by review: no real values ever land in it.
- **`.env.local` is regenerable.** It mirrors Vercel and can be rebuilt from the
  dashboard / `vercel env pull`. Caveat: the DARA-004 role URLs
  (`DATABASE_URL_APP` / `DATABASE_URL_ADMIN`) are **Production-scoped** in Vercel,
  so `vercel env pull` (development scope) will not include them — mirror them by
  hand when rebuilding the file.

## What changed this session (2026-06-29)

- Removed the redundant top-level **`.env`** file — a duplicate copy of a live
  owner `DATABASE_URL`. Every consumer (`prisma.config.ts`, the `prisma/security/*`
  scripts) already loads `.env.local` first, so `.env` was shadowed and unused.
- Trimmed two **dead secrets** from `.env.local` that no code reads:
  - `STRIPE_PRICING_TABLE_ID` — the app uses custom plan cards, not the hosted
    pricing table. (Still present in Vercel; harmless, unused.)
  - `CRON_SECRET` — earmarked for the future JobQueue cron worker; no consumer yet
    and not set in Vercel. **Regenerate it when that worker is built.**
- Replaced the stale Supabase-template `.env.example` / removed `.env.local.example`
  with one accurate, secret-free `.env.example` documenting the real variables.

## Rotation-on-suspicion runbook

If a workstation, backup, or dependency may have read the working tree, treat all
local secrets as exposed and rotate. A secret is only fully rotated once the new
value is in **Vercel (all environments)** and redeployed — updating `.env.local`
alone does nothing for production. See `BUILD_STATUS.md` §4 #9 for the per-secret
mechanics (DB password, the three DB role credentials, Stripe, Supabase keys,
`APP_KEY`, `PLATFORM_ANTHROPIC_KEY`).

## Residual risk (accepted)

Live keys still touch disk in `.env.local` while running local dev against the
cloud project — inherent to local development without a separate non-prod stack.
Compensating controls: file is gitignored and never tracked, blast radius bounded
by the documented rotation runbook, DARA-004 least-privilege roles limit what the
runtime credential can do. Standing up a separate dev Supabase + Stripe test-mode
keys (so local disk holds only non-prod secrets) remains an option if the risk
posture tightens.

## Related / known surface (not part of this finding)

- **Unused `DARA_*` / `NEXT_PUBLIC_DARA_*` Vercel vars** (BUILD_STATUS gap #10):
  ~16 Supabase-integration vars no code reads, incl. live `DARA_POSTGRES_PASSWORD`
  / `DARA_SUPABASE_SERVICE_ROLE_KEY`. Left in place this session (deleting
  integration-managed vars can be reverted by the integration); address when the
  Supabase integration is reconnected or removed.
- **Prod Stripe publishable key**: code reads `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  but Vercel only has `STRIPE_PUBLISHABLE_KEY` (no `NEXT_PUBLIC_` prefix) — verify
  the billing page renders the publishable key in production.
