# DARA-004 — Least-privilege DB role + per-tenant RLS policies

_Scoping document · 2026-06-27_

**Finding (HIGH):** Tenant isolation on `dara_*` tables is enforced only in the
application layer (every Prisma query carries `where: { companyId }`). The app
connects as the Supabase project-owner role `postgres`, which has `BYPASSRLS`, so
the RLS enabled in DARA-005 is an inert backstop — a missing or wrong `companyId`
filter in any one of ~100 query sites is a silent cross-tenant data leak with no
database-level safety net.

**Goal:** Make the database enforce tenant isolation independently of app code, so
that a forgotten `companyId` filter returns *nothing* (or errors) instead of
another tenant's rows. Keep the app-layer `companyId` scoping as defense-in-depth.

---

## 1. Current state (verified)

| Aspect | Today |
|--------|-------|
| Runtime connection | `utils/prisma.ts` → single global `PrismaClient` with `PrismaPg` adapter on **`DATABASE_URL`** (Supabase **transaction pooler**). |
| Connecting role | `postgres` — project owner, **`rolbypassrls = true`**. |
| CLI / migrations | `prisma.config.ts` → **`DIRECT_URL`** (also owner). Build runs `prisma db push`. |
| RLS state | Enabled on all 11 `dara_*` tables, **zero policies** (deny-by-default), from `2026-06-27_lock_dara_tables.sql`. Inert because the app role bypasses it. |
| Tenant column | **Every** `dara_*` table has a denormalized `company_id` (BigInt) — incl. `dara_sol_documents`, `dara_response_files`, `dara_results`. Policies can be uniform. |
| Scoping pattern | `where: { companyId }` threaded by hand. **106 `companyId` occurrences across 16 files.** `companyId` resolved per-request via `getDaraUser(user.id).companyId`. |
| Raw SQL / GUC use | None today. No `$transaction`, no `set_config`, no `current_setting` in app code. |

### Access paths are NOT all tenant-scoped (the key complication)
Three paths legitimately read/write **across** tenants and therefore cannot run
under an RLS-restricted, GUC-pinned role:

1. **Provisioning** (`utils/dara/provision.ts`) — creates a `Company` + first
   `DaraUser`; runs *before* a tenant context exists.
2. **Stripe webhook** (`utils/dara/billing.ts:71`) — `findFirst({ where: { stripeCustomerId } })`
   looks up the company by Stripe ID with no `companyId` in hand.
3. **Platform admin** (`app/app/admin/page.tsx:65`) — `company.findMany()` /
   `daraUser.findMany()` over *all* tenants by design.
4. (Future) **Cron/JobQueue worker** — runs detached from any user session; would
   set the GUC from each job's `companyId`, but the queue *poller* itself reads
   across tenants.

**Consequence:** this is a **two-role** design, not one. A restricted tenant role
*and* a retained privileged path.

---

## 2. Core technical challenge: GUC + transaction pooler

RLS policies read the active tenant from a runtime parameter, e.g.
`current_setting('app.company_id')`. The question is *how that value gets onto the
connection that runs the query.*

- **Session-level `SET app.company_id = …`** does NOT work: `DATABASE_URL` is the
  **transaction-mode pooler (pgBouncer)**. A connection is handed back to the pool
  after every statement, so a session `SET` leaks to / is lost by other requests.
- **`SET LOCAL` / `set_config(…, true)` inside an interactive transaction** *does*
  work: Prisma's `$transaction(async (tx) => …)` pins one physical connection for
  the duration, the `LOCAL` setting dies with the transaction, and the pooler stays
  safe. **This is the supported pattern and the one we'll use.**

```ts
// the unit-of-work primitive
export function withTenant<T>(companyId: bigint, fn: (tx: TenantTx) => Promise<T>) {
  return prismaTenant.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.company_id', ${companyId.toString()}, true)`;
    return fn(tx);
  });
}
```

Every tenant query then runs as `withTenant(companyId, (tx) => tx.solicitation.findMany())`.

### The long-running-evaluation conflict (must design around)
`runEvaluation` (`utils/dara/evaluator.ts`, `maxDuration=300`) interleaves DB
writes with **slow LLM API calls** per criterion. We must **not** hold a DB
transaction open across those network calls (connection starvation + Prisma's
interactive-transaction timeout, default 5 s). Options for that path:
- Wrap only the discrete DB read/write bursts in `withTenant`, doing LLM calls
  *outside* the transaction; **or**
- Run evaluation under the **privileged role** with an explicit, audited
  `companyId` (it already filters by `companyId` everywhere), treating it like the
  webhook/admin path.

Recommendation: keep evaluation on the tenant role but restructure into
short `withTenant` bursts (load inputs → call LLM → `withTenant` to persist
results). Decision needed (see §6).

---

## 3. Proposed design

### 3.1 Two Postgres roles
- **`dara_app`** (new): `LOGIN`, **NOT** `BYPASSRLS`. `GRANT SELECT, INSERT,
  UPDATE, DELETE` on the 11 `dara_*` tables + `USAGE, SELECT` on their sequences.
  No DDL. This becomes the runtime role.
- **`dara_owner`** (= existing `postgres`, or a dedicated owner): retains
  `BYPASSRLS`. Used only by migrations and the three privileged paths.

### 3.2 Two Prisma clients (`utils/prisma.ts`)
- `prismaTenant` — adapter on a new **`DATABASE_URL_APP`** (pooler, user
  `dara_app`). **Only** reachable through `withTenant()` (consider a lint/types
  guard so a bare `prismaTenant.model.findMany()` outside a tenant tx is hard to
  write by accident).
- `prismaAdmin` — adapter on the existing owner URL. Used by provision, webhook,
  admin pages, and DB migrations’ runtime equivalents. Every `prismaAdmin` call
  site gets a one-line justification comment (these are the audited cross-tenant
  exceptions).

### 3.3 RLS policies (new SQL artifact)
Uniform per table (all have `company_id`):
```sql
create policy dara_isolation on public.dara_solicitations
  for all to dara_app
  using      (company_id = current_setting('app.company_id', true)::bigint)
  with check (company_id = current_setting('app.company_id', true)::bigint);
```
- `for all` covers SELECT/INSERT/UPDATE/DELETE; `with check` blocks writing a row
  into another tenant.
- `current_setting(…, true)` (missing_ok) → returns NULL when unset, so a query
  with no tenant context matches **zero** rows (fail-closed) rather than erroring.
- Applies `to dara_app` only; `dara_owner` bypasses regardless.
- `dara_companies` / `dara_users`: policy keys on `id` / `company_id` respectively.

### 3.4 Migrations & build
- Keep **`DIRECT_URL` = owner** so `prisma db push` (in the build) keeps DDL
  rights. The new RLS/role SQL is a checked-in artifact applied out-of-band (like
  the DARA-005 lock script), since `db push` won't manage roles/policies.
- Document role + grant + policy SQL as a single re-runnable script:
  `prisma/security/2026-06-2X_dara004_rls_policies.sql`.

---

## 4. Work breakdown

1. **SQL artifact** — create `dara_app` role, grants on tables+sequences, default
   privileges, and the 11 isolation policies. Re-runnable (drop-if-exists guards).
2. **Provision `dara_app` credentials** in Supabase; add `DATABASE_URL_APP`
   (pooler/`dara_app`) to Vercel (all envs) + `.env.local`. (Rotation runbook,
   gap #9.)
3. **`utils/prisma.ts`** — export `prismaAdmin` + `prismaTenant` + `withTenant()`
   helper (+ `TenantTx` type).
4. **Migrate tenant call sites** (the bulk) — wrap the ~13 tenant-facing files'
   queries in `withTenant(companyId, …)`; keep the existing `companyId` filters.
   Pages: dashboard, solicitations (+`/new`, `/[id]`), personas, settings,
   billing. Engine: personas, documents, evaluator (special-cased), providers’
   key reads.
5. **Privileged call sites** — point provision, webhook, admin at `prismaAdmin`
   with justification comments.
6. **Evaluation restructure** — per §2 decision.
7. **Verification** (§5).
8. **Docs** — update `security-content.ts` (DARA-004 → Remediated; DARA-003 closed),
   `BUILD_STATUS.md`, and the secret-rotation runbook (new role creds).

---

## 5. Verification plan
- **Negative (the whole point):** with `app.company_id` set to tenant A, a raw
  `select` / Prisma read of tenant B's row returns 0 rows; an `insert` with B's
  `company_id` raises `with check` violation. Add an automated test that connects
  as `dara_app`, sets the GUC, and asserts isolation on every table.
- **No-context:** queries with GUC unset return 0 rows (fail-closed), proving the
  app *cannot* silently run unscoped.
- **Privileged paths still work:** provision a new company, fire a Stripe webhook
  (`stripeCustomerId` lookup), load `/app/admin`.
- **Bypass check:** confirm `dara_app` is `rolbypassrls = false`
  (`select rolname, rolbypassrls from pg_roles`).
- **Regression:** full smoke test of each tenant page + one evaluation run.

---

## 6. Open decisions (need your call)
1. **Evaluation path:** restructure `runEvaluation` into short `withTenant` bursts
   (keeps it on the restricted role — preferred), **or** run it under `prismaAdmin`
   with explicit `companyId` (less safe, less work)?
2. **Owner role:** keep using `postgres` as the privileged role, or create a
   dedicated `dara_owner` and stop using `postgres` directly (cleaner, also helps
   DARA-002 secrets posture)?
3. **Migration mechanism:** continue with the checked-in SQL-artifact approach
   (consistent with DARA-005), or take this finding as the trigger to adopt real
   `prisma migrate` migrations (roles/policies live in version-controlled
   migrations)?
4. **Connection budget:** `prismaAdmin` over the **direct**/session URL is fine for
   low-volume webhook/admin, but if the cron worker lands it should use a pooled
   owner URL. Provision a pooled `DATABASE_URL_ADMIN` now or defer?

---

## 7a. Recommended decisions (#1 and #2)

### Decision #1 — Evaluation path → **restructure into short `withTenant` bursts; keep it on `dara_app`.**

Do **not** run evaluation under the privileged role. Rationale:
- Evaluation is the **highest-CUI-volume path in the app** — it reads proposal /
  solicitation text and writes scored results. That is *exactly* the data RLS
  exists to fence. Running it on a `BYPASSRLS` role would leave the single most
  sensitive operation with no DB-level isolation, defeating DARA-004 where it
  matters most.
- The "burst" shape is the **correct architecture anyway**, and is the same shape
  the future `JobQueue` + cron worker (gap #4, next-steps §3) will need — so this
  isn't throwaway work.

Concrete transaction boundaries for `runEvaluation` (`utils/dara/evaluator.ts`):
1. **Burst A (read):** `withTenant(companyId, tx => …)` — load the evaluation +
   solicitation/criteria/docs + response/files; set status `running`.
2. **No transaction:** resolve provider/keys (a tenant read — wrap that lookup in
   its own short `withTenant`), then loop the criteria calling the LLM. **No DB
   transaction is held across any LLM call.**
3. **Burst C (write):** `withTenant(companyId, tx => …)` — persist `Result` rows
   (batch the upserts) and set the final `complete` / `failed` status.

This keeps each transaction sub-second, well inside Prisma's interactive-tx
timeout, and never pins a pooled connection across the network. The existing
`companyId` filters stay as defense-in-depth.

### Decision #2 — Roles → **three roles; runtime never touches the DDL role.**

More than the two-role split in §3.1. Separate *runtime-privileged* from
*DDL/migration* so a leaked runtime connection string can't alter the schema:

| Role | `BYPASSRLS` | Rights | Used by | Connection |
|------|:-----------:|--------|---------|------------|
| **`dara_app`** | ❌ no | `SELECT/INSERT/UPDATE/DELETE` + sequence `USAGE,SELECT` on `dara_*` only; **no DDL** | All tenant requests, via `withTenant()` | `DATABASE_URL_APP` (pooler) |
| **`dara_admin`** | via policy | Same DML/sequence grants on `dara_*`; **no DDL**. Cross-tenant access via an explicit permissive `using(true)` policy, **not** the `BYPASSRLS` attribute — so the SQL doesn't depend on the (often-withheld) privilege to confer `BYPASSRLS`, and the grant is visible in `pg_policies`. | The 3 audited cross-tenant paths: provision, Stripe webhook, platform admin | `DATABASE_URL_ADMIN` (pooler) |
| **`postgres`** (existing owner) | ✅ yes | Owner / full DDL | **Migrations only** (`prisma db push`), never at runtime | `DIRECT_URL` |

Why three rather than "keep using `postgres` for the privileged path":
- The privileged runtime paths genuinely need to cross tenants, so they need
  `BYPASSRLS` — but they do **not** need DDL. Giving them a DML-only `dara_admin`
  means a leaked webhook/admin connection string can read/write tenant rows
  (unavoidable for those features) but **cannot drop tables or alter schema** —
  real blast-radius reduction.
- `prismaAdmin` therefore points at `dara_admin`, **not** `postgres`. `postgres`
  credentials live only in `DIRECT_URL`, used by the build/migrations and nothing
  that serves a request.
- This directly advances **DARA-002** (secrets/role hardening) at no extra
  refactor cost.

Low-risk to implement: **do not reassign table ownership.** Tables stay owned by
`postgres`; `dara_app` and `dara_admin` are created with `GRANT`s + (for admin)
`BYPASSRLS` in the same checked-in SQL artifact. `prisma db push` keeps running as
the owner via `DIRECT_URL`, unchanged.

**New env vars (Vercel all-envs + `.env.local`, per the rotation runbook, gap #9):**
`DATABASE_URL_APP` (pooler / `dara_app`) and `DATABASE_URL_ADMIN` (pooler /
`dara_admin`). `DATABASE_URL` (today's pooled `postgres`) is retired from runtime;
`DIRECT_URL` (owner) stays for migrations.

---

## 7. Effort & risk
- **Size:** Medium–Large. The role/policy SQL and two-client split are ~½ day; the
  ~13-file `withTenant` migration + evaluation restructure + tests are the bulk
  (est. 1–2 focused days).
- **Risk:** Mostly contained — app-layer scoping stays in place, so RLS is additive
  defense-in-depth; worst case during rollout is a *too-strict* (fail-closed) query,
  caught immediately in smoke tests, not a leak. The one genuine footgun is the
  long-running transaction in evaluation (§2) — addressed by the restructure.
- **Standards payoff:** closes DARA-004 **and** fully closes DARA-003; directly
  satisfies NIST 800-171 **3.1.x** (access enforcement / least privilege) and
  CMMC L2 **AC** controls at the data tier.
