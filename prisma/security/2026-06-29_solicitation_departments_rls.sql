-- 2026-06-29 — Per-tenant RLS for dara_solicitation_departments (DARA-004 model)
--
-- The solicitation↔department join table that backs department-scoped solicitation
-- visibility. Department-level access is enforced in the app layer (see
-- utils/dara/sol-access.ts); this RLS is the same company-level tenant backstop the
-- other dara_* tables have, so a leaked app credential still can't cross companies.
-- Carries company_id, so it uses the uniform tenant policy.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-06-29_solicitation_departments_rls.sql
-- Re-runnable: grants additive, policies dropped-if-exists then recreated, RLS idempotent.

begin;

grant select, insert, update, delete on table
  public.dara_solicitation_departments
to dara_app, dara_admin;

grant usage, select on all sequences in schema public to dara_app, dara_admin;

alter table public.dara_solicitation_departments enable row level security;

drop policy if exists dara_tenant_isolation on public.dara_solicitation_departments;
create policy dara_tenant_isolation on public.dara_solicitation_departments
  for all to dara_app
  using      (company_id = nullif(current_setting('app.company_id', true), '')::bigint)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::bigint);

drop policy if exists dara_admin_all on public.dara_solicitation_departments;
create policy dara_admin_all on public.dara_solicitation_departments
  for all to dara_admin using (true) with check (true);

commit;
