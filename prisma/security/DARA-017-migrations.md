# DARA-017 — Migration history & schema source of truth

_Status: **Remediated** · 2026-06-29_

NIST SP 800-171: 03.04.x configuration management (CM-2 baseline, CM-3 change
control, CM-6 configuration settings).

## Finding (original)

> No migration history; legacy template schema drift. Empty migrations directory;
> legacy template tables and an `auth.users` signup trigger coexist with the Prisma
> schema. No schema change audit/rollback; two schemas of record.

## What we found (read-only introspection, 2026-06-29)

A read-only catalog query against production showed the DB is already clean:

- `public` contains **exactly the 12 `dara_*` tables** — no legacy/template tables,
  no views.
- **No** `auth.users` triggers, **no** template functions (`handle_new_user`, etc.).
- `_prisma_migrations` did **not** exist — confirming the "no migration history" half.

So the "legacy template drift" half of the finding was already resolved by the
earlier migration / DARA-004 work; only the missing migration baseline remained.

A drift check (`prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma`) returned **empty** — `schema.prisma` is an exact, in-sync
representation of the live database (including the personas `icon` column that had
been added via owner-SQL).

## Remediation

Baselined the existing database (standard Prisma workflow for a DB created with
`db push`):

1. Generated `prisma/migrations/0_init/migration.sql` from the current datamodel
   (`migrate diff --from-empty --to-schema`) — 12 tables, 9 enums, 25 indexes,
   15 FKs.
2. Marked it already-applied without running the DDL:
   `prisma migrate resolve --applied 0_init` (writes `_prisma_migrations`; the
   tables already exist).
3. Verified: `prisma migrate status` → *"Database schema is up to date!"*

## The two-layer schema model (single source of truth)

DARA's schema is owned in **two tracked, complementary layers**. Neither is
`prisma db push` (which is no longer used; the build runs only `prisma generate`).

1. **Table structure — Prisma migrations** (`prisma/migrations/`).
   Tables, columns, enums, indexes, foreign keys. `0_init` is the baseline.
   - New change: edit `prisma/schema.prisma` → `prisma migrate dev --name <x>`
     locally → commit the generated migration → apply to prod with
     **`prisma migrate deploy`** as the owner (`DIRECT_URL`). Do **not** add
     `migrate deploy` to the build step — owner DDL stays a deliberate, manual,
     least-privilege action (same boundary as the owner-SQL layer below).

2. **Security DDL — owner-only SQL** (`prisma/security/*.sql`, applied via
   `prisma/security/apply-sql.ts` as `DIRECT_URL`/owner). Prisma's datamodel cannot
   express these, so they are tracked as SQL, in apply order:

   | Order | File | Purpose | Re-apply on a fresh rebuild? |
   |------|------|---------|------------------------------|
   | 1 | `2026-06-27_lock_dara_tables.sql` | Revoke `anon`/`authenticated`; enable RLS (DARA-005) | Yes |
   | 2 | `2026-06-27_dara004_rls_policies.sql` | Per-tenant RLS policies + least-privilege roles (DARA-003/004) | Yes |
   | 3 | `2026-06-28_dara013_audit_log.sql` | Append-only audit-log triggers (DARA-013) | Yes |
   | — | `2026-06-28_personas_icon.sql` | `icon` column — **structural**, now folded into `0_init` | No (already in baseline) |
   | + | `2026-07-01_requirements_rls.sql` | RLS for `dara_requirements` (renamed from `dara_criteria` in `20260701000000_requirements_compliance`) | Yes |
   | + | `2026-07-01_review_passes_rls.sql` | RLS for `dara_review_passes` + `dara_findings` (`20260701060000_review_passes`) | Yes |
   | + | `2026-07-04_direct_reviews_rls.sql` | RLS for `dara_direct_reviews` (`20260704000000_direct_ai_review`); `dara_findings` policy unchanged | Yes |
   | + | `2026-07-08_ai_usage_log_rls.sql` | RLS + grants for `dara_ai_usage_log` (`20260708130000_ai_usage_and_capability`); **admin-only, fail-closed** — no `dara_app` grant. The paired `capability_models` column on `dara_platform_settings` needs no re-grant (existing admin-only policy governs it). | Yes |

   > **Rename note (2026-07-01):** the `20260701000000_requirements_compliance`
   > migration renames `dara_criteria` → `dara_requirements`. PostgreSQL preserves
   > grants + RLS policies through a table RENAME, so no owner-SQL needs re-running on
   > the live DB. Files 1 (`lock_dara_tables`) and 2 (`dara004_rls_policies`) were
   > updated to the new name so a from-scratch rebuild (which runs migrations first,
   > then these files) references the table that then exists.

   The three security files are independent of `0_init` and are layered **after**
   the tables exist. (Roles created by file 2 are rotated via
   `rotate-dara004-roles.sh` — see BUILD_STATUS §4 #9.)

### Rebuilding the schema from scratch (disaster-recovery order)
`prisma migrate deploy` (creates 0_init tables) → apply security files 1→2→3 via
`apply-sql.ts` → `rotate-dara004-roles.sh` to set role passwords.

## Footgun
`package.json` has a `supabase:push` script (`npx supabase db push`) left from the
template — it is **not** part of the build and should not be used to mutate this
schema; it bypasses both layers above.

## Residual
None functional. Going forward, every structural change must ship as a committed
migration (CM-3) and every security-DDL change as a new dated `prisma/security/*.sql`
added to the manifest above.
