# DARA-004 — Status, Decision Log & Next Steps

_Status update · 2026-06-27_
_Finding: least-privilege DB role + per-tenant RLS (HIGH). Closes DARA-003._
_Related: [DARA-004-scope.md](./DARA-004-scope.md) · [DARA-004-handoff.md](./DARA-004-handoff.md)_

---

## 1. Status: code complete, deployment pending

The application code for database-enforced tenant isolation is **fully migrated and
typechecks clean** (`tsc --noEmit` exit 0). What remains is operator action against
the database/platform and behavioral verification — no further app code is required
to ship.

**Why this matters (the finding):** tenant isolation was app-layer only — every
Prisma query carried `where: { companyId }`, and the app connected as the
`BYPASSRLS` owner `postgres`. A single forgotten filter in any of ~100 query sites
was a silent cross-tenant CUI leak with no database-level safety net. DARA-004 makes
the database enforce isolation independently, so a missing filter returns **zero
rows**, not another tenant's data.

### Done
- **Two-client model** in `utils/prisma.ts`: `prismaTenant` (restricted `dara_app`),
  `prismaAdmin` (cross-tenant `dara_admin`), and the `withTenant(companyId, fn)`
  primitive (interactive transaction + `SET LOCAL` GUC). Deprecated `prisma` alias
  removed.
- **All ~16 call sites migrated** to `withTenant` (tenant paths) or `prismaAdmin`
  (the 3 audited cross-tenant paths). Evaluator restructured into read/LLM/write
  bursts so no transaction is held across an LLM call.
- **SQL artifact** `2026-06-27_dara004_rls_policies.sql`: roles, least-privilege
  grants, RLS policies on all 11 tables (fail-closed via `nullif(current_setting…)`).
- **Operational tooling**: `rotate-dara004-roles.sh` (secret-free) + rotation runbook
  entry in `BUILD_STATUS.md` gap #9.

### Audit (post-migration)
- 0 importers of the old `prisma` alias remain.
- `prismaAdmin` appears in **exactly** 3 files: `provision.ts`, `admin/page.tsx`,
  `billing.ts` (webhook) — each authz-gated, none on a normal user render path.

---

## 2. Decision log (with rationale)

| # | Decision | Rationale | Standard |
|---|----------|-----------|----------|
| D1 | **Evaluation runs on `dara_app`, restructured into short `withTenant` bursts** (not on the privileged role) | It's the highest-CUI-volume path (proposal text in, scores out) — running it on a bypass role would gut DARA-004 exactly where it matters most. The burst shape (read → LLM outside tx → write) is also the correct architecture for the future JobQueue/cron worker. | AC-3, AC-6 |
| D2 | **Three roles** — `dara_app` (restricted runtime), `dara_admin` (cross-tenant runtime, no DDL), `postgres` (DDL/migrations only, never serves a request) | Least privilege + separation of duties: each credential has exactly its function's rights. Runtime credentials cannot alter schema; cross-tenant ≠ schema ≠ normal traffic. Reaffirmed over lower-overhead 1-role / 2-role options **because** the standards (CUI / CMMC L2) mandate least privilege over operational convenience. | AC-5, AC-6, SC-2 |
| D3 | **Apply via checked-in SQL artifact**, not `prisma migrate` (for now) | Migration mechanism is orthogonal to runtime security — the policies enforce identically either way. Don't block a security fix on a tooling migration that needs careful baselining of a live DB. Adopt `migrate` later as its own CM task. | CM-* (deferred) |
| D4 | **Keep the app-layer `companyId` filters** (defense-in-depth), do not remove them | The filter is the belt that survives if RLS is ever bypassed — the transitional owner fallback, a future `BYPASSRLS`/admin mistake, or a policy bug. Cost is nil (redundant indexed predicate). Advisory guidance to strip them was declined for this reason. | Defense in depth |
| D5 | **`dara_admin` cross-tenant access via a permissive `using(true)` policy**, not the `BYPASSRLS` attribute | Managed Postgres can withhold the privilege to confer `BYPASSRLS`, which would make the artifact fail. A policy is platform-agnostic and visible/auditable in `pg_policies`. | AU-*, AC-3 |
| D6 | **`withTenant` = interactive transaction + `set_config(…, true)` (`SET LOCAL`)** | Runtime uses Supabase's transaction-mode pooler; a session-level `SET` leaks across pooled connections. An interactive transaction pins one connection, and `SET LOCAL` dies with it — the only pooler-safe way to carry the tenant GUC. | AC-3 |
| D7 | **Shared helpers take a `tx` parameter** (e.g. `seedBuiltinPersonas(tx, …)`) | Caller owns the tenant context; prevents nested interactive transactions (which Prisma rejects). | — |
| D8 | **Transitional fallback to `DATABASE_URL` with a console warning** when new env vars are unset | Avoids a hard prod outage if code deploys before the env vars are provisioned; the warning keeps it from being silent. To be replaced by a prod hard-fail after validation (see Next Steps). | — |
| D9 | **Removed the deprecated `prisma` alias** once all sites migrated | Footgun removal — a stray `import { prisma }` would silently get the unguarded cross-tenant client. | AC-6 |
| D10 | **Address credential overhead via tooling, not consolidation** (rotation script + runbook) | IA-5 calls for *managing* authenticators, not minimizing their count. Collapsing roles to reduce passwords moves away from AC-6. Net recurring cost is low — `dara_app`/`dara_admin` are low-privilege and rarely rotate. | IA-5 |

---

## 3. Next steps (operator + verification — ordered)

> Detailed runbook in [DARA-004-handoff.md](./DARA-004-handoff.md). Summary order:

1. **Apply the SQL artifact** in the Supabase SQL Editor — creates roles, grants,
   RLS policies. Run the verification queries at its bottom.
2. **Set the two role passwords** — `rotate-dara004-roles.sh` (or two manual
   `ALTER ROLE … WITH LOGIN PASSWORD` statements). Two distinct strong secrets.
3. **Add env vars** — `DATABASE_URL_APP`, `DATABASE_URL_ADMIN` (pooler, usernames
   `dara_app.<ref>` / `dara_admin.<ref>`) to Vercel (all envs) + `.env.local`.
   Keep `DIRECT_URL` (owner) for migrations.
4. **Deploy to preview** and run the **two-tenant isolation tests** (the critical
   security gate): tenant A cannot read/update/delete tenant B; unscoped queries
   return zero rows; the 3 admin paths still work.
5. **Promote to production**, re-verify.
6. **Harden the fallback** — change `utils/prisma.ts` to hard-fail in production
   when `DATABASE_URL_APP`/`_ADMIN` are missing (removes D8's safety net once it's
   no longer needed).
7. **Flip status** — DARA-004 → Remediated and DARA-003 → closed in
   `utils/dara/security-content.ts`; update `BUILD_STATUS.md` §3/§5.

### Not in scope here (tracked elsewhere)
- Adopt `prisma migrate` (D3 deferral) — pairs with DARA-015 (CI gates).
- DARA-009 (encrypt CUI at rest), DARA-007 (CUI→LLM boundary), DARA-013 (audit
  logging) remain separate findings.

---

## 4. Risk posture
Low rollout risk: app-layer scoping stays in place (D4), so RLS is **additive**.
The worst case during cutover is a *too-strict* (fail-closed) query that returns
nothing — caught immediately in preview smoke tests, never a leak. The one real
hazard (holding a DB transaction across an LLM call) was designed out via the
evaluator burst restructure (D1).
