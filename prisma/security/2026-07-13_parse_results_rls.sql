-- 2026-07-13 — Per-tenant RLS + grants for dara_parse_results (Modal structural parse output).
--
-- The table holds a company's parsed solicitation/proposal document structure (potentially CUI
-- in `result`). It is tenant data, written by the upload/re-parse paths and read by the shred —
-- both run on the tenant role (dara_app) under withTenant(), which sets the app.company_id GUC.
-- The platform-admin parse-history viewer reads it cross-tenant via dara_admin. This mirrors the
-- dara_requirements RLS: a tenant-isolation policy for dara_app + a permissive policy for
-- dara_admin. anon/authenticated get NO grant (fail-closed).
--
-- The table is NEW and fail-closed until granted, so this file MUST be applied before the code
-- deploy that starts writing to it. NIST SP 800-171 03.01.x (access control).
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-13_parse_results_rls.sql
-- Re-runnable.

begin;

grant select, insert, update, delete on table public.dara_parse_results
  to dara_app, dara_admin;

grant usage, select on sequence public.dara_parse_results_id_seq to dara_app, dara_admin;

alter table public.dara_parse_results enable row level security;

drop policy if exists dara_tenant_isolation on public.dara_parse_results;
create policy dara_tenant_isolation on public.dara_parse_results
  for all to dara_app
  using (company_id = nullif(current_setting('app.company_id', true), '')::bigint)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::bigint);

drop policy if exists dara_admin_all on public.dara_parse_results;
create policy dara_admin_all on public.dara_parse_results
  for all to dara_admin using (true) with check (true);

commit;

-- ── Verification ────────────────────────────────────────────────────────────
--   select policyname, roles from pg_policies
--     where schemaname='public' and tablename='dara_parse_results';
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name='dara_parse_results';
