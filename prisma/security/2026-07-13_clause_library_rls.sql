-- 2026-07-13 — RLS + grants for the global regulatory clause library (Pass 3 IbR source of truth).
--
-- dara_clause_library / dara_clause_versions are SHARED reference data (public FAR/DFARS/agency-supp
-- clause text from the GSA DITA repos) — NOT tenant data, so there is no company_id and no per-tenant
-- isolation. Any authenticated tenant may READ any clause; only the admin sync job WRITES. Therefore:
--   • dara_app  — SELECT only (read the library during a shred's Pass 3).
--   • dara_admin — full CRUD (the sync job upserts as the platform-admin client).
--   • anon/authenticated — no grant (fail-closed).
-- RLS is enabled per the project's "every dara_* table RLS-fail-closed" convention; the policies are
-- permissive (using true) because the data is intentionally global — the isolation is at the GRANT
-- level (dara_app cannot write). NIST SP 800-171 03.01.x.
--
-- NEW tables — apply BEFORE the code deploy that reads/writes them:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-13_clause_library_rls.sql
-- Re-runnable.

begin;

-- Reads for tenants; full CRUD for the admin sync job.
grant select on table public.dara_clause_library, public.dara_clause_versions to dara_app;
grant select, insert, update, delete on table public.dara_clause_library, public.dara_clause_versions
  to dara_admin;
grant usage, select on sequence public.dara_clause_library_id_seq  to dara_admin;
grant usage, select on sequence public.dara_clause_versions_id_seq to dara_admin;

alter table public.dara_clause_library  enable row level security;
alter table public.dara_clause_versions enable row level security;

drop policy if exists dara_app_read on public.dara_clause_library;
create policy dara_app_read on public.dara_clause_library
  for select to dara_app using (true);
drop policy if exists dara_admin_all on public.dara_clause_library;
create policy dara_admin_all on public.dara_clause_library
  for all to dara_admin using (true) with check (true);

drop policy if exists dara_app_read on public.dara_clause_versions;
create policy dara_app_read on public.dara_clause_versions
  for select to dara_app using (true);
drop policy if exists dara_admin_all on public.dara_clause_versions;
create policy dara_admin_all on public.dara_clause_versions
  for all to dara_admin using (true) with check (true);

commit;

-- ── Verification ────────────────────────────────────────────────────────────
--   select tablename, policyname, roles, cmd from pg_policies
--     where schemaname='public' and tablename like 'dara_clause%';
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--     where table_name like 'dara_clause%' order by table_name, grantee;
