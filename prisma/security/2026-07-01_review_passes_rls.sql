-- 2026-07-01 — Per-tenant RLS for the multi-pass AI review tables.
--
-- dara_review_passes and dara_findings are NEW and fail-closed for dara_app until granted
-- (the review load/run + worker query them), so this file MUST be applied before the code
-- deploy. Both carry company_id -> the uniform DARA-004 tenant policy.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-01_review_passes_rls.sql
-- Re-runnable.

begin;

do $$
declare
  t text;
  pass_tables text[] := array['dara_review_passes', 'dara_findings'];
begin
  foreach t in array pass_tables loop
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
