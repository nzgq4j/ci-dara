-- 2026-06-30 — Per-tenant RLS for dara_result_versions (result regeneration log).
--
-- Same DARA-004 uniform pattern as the other tenant tables: it carries company_id,
-- so dara_app sees only rows matching the per-transaction GUC app.company_id
-- (fail-closed when unset), and dara_admin gets the permissive cross-tenant policy.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-06-30_result_versions_rls.sql
-- Re-runnable.

begin;

grant select, insert, update, delete on table public.dara_result_versions
  to dara_app, dara_admin;

grant usage, select on all sequences in schema public to dara_app, dara_admin;

alter table public.dara_result_versions enable row level security;

drop policy if exists dara_tenant_isolation on public.dara_result_versions;
create policy dara_tenant_isolation on public.dara_result_versions
  for all to dara_app
  using (company_id = nullif(current_setting('app.company_id', true), '')::bigint)
  with check (company_id = nullif(current_setting('app.company_id', true), '')::bigint);

drop policy if exists dara_admin_all on public.dara_result_versions;
create policy dara_admin_all on public.dara_result_versions
  for all to dara_admin using (true) with check (true);

commit;
