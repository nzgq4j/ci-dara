# Prisma migrations

`0_init` is the **baseline** — it represents the production schema as of 2026-06-29
and was marked already-applied (`prisma migrate resolve --applied 0_init`), not run.

This directory tracks **table structure only**. Row-Level Security, grants,
least-privilege roles, and audit-log triggers live in the owner-only SQL layer at
`../security/*.sql` (applied via `../security/apply-sql.ts`). Both layers, the
change workflow, and the disaster-recovery order are documented in
[`../security/DARA-017-migrations.md`](../security/DARA-017-migrations.md).

**Workflow:** edit `schema.prisma` → `prisma migrate dev --name <x>` (local) →
commit → `prisma migrate deploy` against prod as owner (`DIRECT_URL`). Do not use
`prisma db push` or `supabase db push`.
