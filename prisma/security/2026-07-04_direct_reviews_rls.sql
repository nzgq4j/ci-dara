-- 2026-07-04 — Per-tenant RLS for the Direct AI review table.
--
-- dara_direct_reviews is NEW and fail-closed for dara_app until granted (the workspace
-- load, the enqueue/run path, and the async worker all query it), so this file MUST be
-- applied before the code deploy. It carries company_id -> the uniform DARA-004 tenant
-- policy (NIST SP 800-171 03.01.x access control / tenant isolation).
--
-- dara_findings already has tenant-isolation RLS from 2026-07-01_review_passes_rls.sql and
-- is unchanged here: the Direct AI migration only adds a nullable direct_review_id column +
-- FK to it; the company_id-keyed policy already governs every row. No re-grant needed.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-04_direct_reviews_rls.sql
-- Re-runnable.

begin;

do $$
declare
  t text;
  direct_tables text[] := array['dara_direct_reviews'];
begin
  foreach t in array direct_tables loop
    execute format('grant select, insert, update, delete on table public.%I to dara_app, dara_admin', t);
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists dara_tenant_isolation on public.%I', t);
    execute format(
      'create policy dara_tenant_isolation on public.%I'
      || ' for all to dara_app'
      || ' using (company_id = nullif(current_setting(''app.company_id'', true), '''')::bigint)'
      || ' with check (company_id = nullif(current_setting(''app.company_id'', true), '''')::bigint)',
      t);

    execute format('drop policy if exists dara_admin_all on public.%I', t);
    execute format(
      'create policy dara_admin_all on public.%I for all to dara_admin using (true) with check (true)',
      t);
  end loop;
end $$;

grant usage, select on all sequences in schema public to dara_app, dara_admin;

commit;
