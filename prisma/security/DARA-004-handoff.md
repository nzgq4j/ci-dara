# DARA-004 — Handoff

_2026-06-27 · for whoever deploys/operates this next_
_Read with: [DARA-004-status.md](./DARA-004-status.md) (decisions) · [DARA-004-scope.md](./DARA-004-scope.md) (design)_

This document is written to be picked up cold. It covers what changed, how the
system now works, the exact deployment runbook, how to verify, and how to roll back.

---

## 1. One-paragraph summary

DARA's tenant isolation used to live only in application code (`where: { companyId }`)
while the app connected as the all-powerful `postgres` owner. DARA-004 moves
enforcement into the database with Row-Level Security and least-privilege roles.
Application code is **done and merged-ready**; the database roles/policies and
environment variables are **not yet applied** — that's the work below. Nothing is
live until you complete the runbook in §4.

---

## 2. How it works now (mental model)

Three database roles, by least privilege:

| Role | Used by | RLS | Connection string |
|------|---------|-----|-------------------|
| `dara_app` | all normal tenant requests | **enforced** — sees only the row whose company = the per-transaction GUC | `DATABASE_URL_APP` (pooler) |
| `dara_admin` | 3 audited cross-tenant paths only | bypassed via an explicit permissive policy | `DATABASE_URL_ADMIN` (pooler) |
| `postgres` | migrations only (`prisma db push`) | owner — bypasses RLS automatically | `DIRECT_URL` (owner) |

Application entry points:
- **`withTenant(companyId, async (tx) => …)`** — opens an interactive transaction on
  `dara_app`, sets `app.company_id` for that transaction (`SET LOCAL`), runs your
  queries. RLS policies read that GUC. If the GUC is unset, queries return **zero
  rows** (fail-closed). Use for everything tenant-scoped.
- **`prismaAdmin`** — the cross-tenant client. Allowed in exactly three places:
  user provisioning, the Stripe webhook, and the platform-admin page. Each is
  authz-gated. Do **not** use it as a convenience escape hatch.

Rules that keep it correct:
- Never `await` slow work (LLM, Stripe, Storage) **inside** `withTenant` — split into
  read-burst → slow call → write-burst (see `evaluator.ts`, the upload actions).
- Never nest `withTenant` (Prisma rejects nested interactive transactions). Helpers
  that run tenant queries take a `tx` param instead.
- `redirect()` / `notFound()` / `revalidatePath()` go **outside** `withTenant`
  (they throw; inside a tx they'd roll it back).
- Keep `where: { companyId }` and ownership checks — they're intentional
  defense-in-depth, not redundant (see decision D4).

---

## 3. Files changed

**Core:**
- `utils/prisma.ts` — `prismaTenant`, `prismaAdmin`, `withTenant`, `TenantTx`; old
  `prisma` alias removed; transitional fallback to `DATABASE_URL` (with warning).

**Tenant call sites → `withTenant`:**
- `app/app/dashboard/page.tsx`
- `app/app/solicitations/page.tsx`
- `app/app/solicitations/new/page.tsx`
- `app/app/solicitations/[id]/page.tsx` (largest — 14 server actions + render)
- `app/app/personas/page.tsx`
- `app/app/settings/page.tsx`
- `app/app/billing/page.tsx`
- `utils/dara/personas.ts` (`seedBuiltinPersonas` now takes `tx`)
- `utils/dara/evaluator.ts` (burst restructure)
- `utils/dara/billing.ts` — `getOrCreateCustomer` (tenant, split around Stripe)

**Cross-tenant call sites → `prismaAdmin`:**
- `utils/dara/provision.ts` (bootstrap; `getDaraUser` is the companyId source)
- `app/app/admin/page.tsx` (platform admin)
- `utils/dara/billing.ts` — `syncSubscriptionToCompany` (webhook)

**New artifacts:**
- `prisma/security/2026-06-27_dara004_rls_policies.sql` — roles, grants, policies.
- `prisma/security/rotate-dara004-roles.sh` — sets/rotates role passwords (no
  secrets in the file).
- `BUILD_STATUS.md` gap #9 — rotation runbook entry.

---

## 4. Deployment runbook (do in this order)

Order matters: roles+policies must exist before connection strings authenticate,
and policies must exist before `dara_app` queries return rows.

### Step 1 — Apply roles & policies
Supabase dashboard → **SQL Editor** → paste & run
`prisma/security/2026-06-27_dara004_rls_policies.sql`.
Then run its verification queries (bottom of the file). Expect:
- `dara_app`: `rolbypassrls = false`; `dara_admin`, `postgres` present.
- Each `dara_*` table shows two policies: `dara_tenant_isolation`, `dara_admin_all`.

### Step 2 — Set the two role passwords
The roles exist but can't log in yet. Set distinct strong passwords. Either:
- **Script:** in a shell with `psql`:
  ```bash
  export DIRECT_URL='postgresql://postgres.<ref>:<owner_pw>@<host>:5432/postgres'
  export DARA_APP_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=@:#?')"
  export DARA_ADMIN_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=@:#?')"
  bash prisma/security/rotate-dara004-roles.sh
  ```
- **Manual:** in the SQL Editor:
  ```sql
  alter role dara_app   with login password 'STRONG_PW_1';
  alter role dara_admin with login password 'STRONG_PW_2';
  ```

### Step 3 — Build & set env vars
Copy your existing **pooler** connection string (Settings → Database → Connection
pooling) and change only the username + password (host/port/db unchanged). Supabase
pooler username format is `role.<project_ref>`:
```
DATABASE_URL_APP=postgresql://dara_app.<ref>:STRONG_PW_1@<pooler-host>:6543/postgres
DATABASE_URL_ADMIN=postgresql://dara_admin.<ref>:STRONG_PW_2@<pooler-host>:6543/postgres
```
Add both to **Vercel → all environments** and to local `.env.local`. Keep
`DIRECT_URL` (owner) for migrations. The old runtime `DATABASE_URL` is retired
(the fallback still reads it transitionally — see Step 6).

### Step 4 — Deploy to preview & verify (§5).

### Step 5 — Promote to production, re-verify.

### Step 6 — Harden the fallback (after prod is confirmed good)
In `utils/prisma.ts`, replace the transitional fallback with a production hard-fail:
```ts
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL_APP) {
  throw new Error('DATABASE_URL_APP is required in production');
}
// same for DATABASE_URL_ADMIN
```

### Step 7 — Close out
Flip DARA-004 → Remediated and DARA-003 → closed in
`utils/dara/security-content.ts`; update `BUILD_STATUS.md` §3/§5.

---

## 5. Verification — the security gate (do not skip)

Typecheck passing is NOT sufficient; RLS needs behavioral proof.

**Fail-closed (SQL Editor):**
```sql
set role dara_app;
select set_config('app.company_id', '1', true);
select count(*) from public.dara_solicitations;   -- only company 1's rows
select set_config('app.company_id', '', true);
select count(*) from public.dara_solicitations;   -- 0  (fail-closed)
reset role;
```

**Two-tenant (in-app, two test companies A and B):**
1. A's user sees only A's solicitations/personas/etc.; never B's.
2. A cannot update or delete B's records (attempts affect 0 rows).
3. Repeat as B.

**Admin paths still work:** provision a new company (sign up a new user), fire a
Stripe webhook (subscription update reflects on the company), load `/app/admin`
(lists all tenants).

**Automated harness:** `prisma/security/dara004-isolation-test.ts` runs all of the
above programmatically against the live DB (creates two throwaway tenants, asserts
isolation, cleans up). Requires `DATABASE_URL_APP`/`DATABASE_URL_ADMIN` in
`.env.local`:
```bash
npx tsx prisma/security/dara004-isolation-test.ts   # exit 0 = all checks passed
```
It refuses to run (exit 2) if it isn't connected as the non-bypass `dara_app` role,
so it can't report a false pass against the owner fallback.

---

## 6. Rollback

Fast and clean, because app-layer scoping never left:
- **App keeps working without the DB changes:** before Step 1, the transitional
  fallback (D8) routes both clients to `DATABASE_URL` (owner), so the app runs with
  today's behavior. Reverting the env vars (removing `DATABASE_URL_APP/_ADMIN`)
  returns to that state.
- **To undo enforcement at the DB** without dropping roles:
  ```sql
  alter table public.dara_<t> disable row level security;  -- per table, or
  drop policy dara_tenant_isolation on public.dara_<t>;
  ```
- **Do NOT** point runtime back at `postgres` long-term — that reopens the finding.
- Roles themselves are harmless to leave in place if you pause the rollout.

---

## 7. Gotchas
- **Supabase pooler username** must be `role.<project_ref>`, not bare `role`.
- **Password URL-safety:** avoid/percent-encode `@ : / # ?` in passwords or the
  connection string breaks (the `tr` in Step 2 strips them).
- **`prisma db push`** must keep running as the owner via `DIRECT_URL` — it manages
  schema, not roles/policies. New `dara_*` tables added later need grants + policies
  added to the artifact (until then they're fail-closed for `dara_app` — safe).
- **Don't add `prismaAdmin`** to a 4th place without re-auditing; it bypasses RLS.
