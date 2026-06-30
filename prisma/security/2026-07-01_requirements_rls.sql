-- 2026-07-01 — Per-tenant RLS for dara_requirements (was dara_criteria).
--
-- The 20260701000000_requirements_compliance migration RENAMEs dara_criteria ->
-- dara_requirements. In PostgreSQL a table RENAME preserves the table's grants and
-- RLS policies (they follow the OID), so on the live DB nothing needs re-applying —
-- the dara_tenant_isolation / dara_admin_all policies and the dara_app/dara_admin
-- grants carry over automatically.
--
-- This file re-asserts that end state idempotently for two reasons: (1) it is safe
-- to run on the live DB after the rename as a belt-and-suspenders check, and (2) it
-- documents the new table name in the owner-SQL layer. The canonical DARA-004/005
-- source files were also updated to the new name for disaster-recovery rebuilds.
--
-- Apply as owner (optional on live — rename already preserved the policies):
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-01_requirements_rls.sql
-- Re-runnable.

begin;

grant select, insert, update, delete on table public.dara_requirements
  to dara_app, dara_admin;

grant usage, select on all sequences in schema public to dara_app, dara_admin;

alter table public.dara_requirements enable row level security;

drop policy if exists dara_tenant_isolation on public.dara_requirements;
create policy dara_tenant_isolation on public.dara_requirements
  for all to dara_app
  using (company_id = nullif(current_setting('app.company_id', true), '')::bigint)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::bigint);

drop policy if exists dara_admin_all on public.dara_requirements;
create policy dara_admin_all on public.dara_requirements
  for all to dara_admin using (true) with check (true);

commit;
