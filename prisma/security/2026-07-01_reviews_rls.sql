-- 2026-07-01 — Per-tenant RLS for the color-team review tables.
--
-- dara_reviews (ex dara_responses) and dara_review_documents (ex dara_response_files)
-- are RENAMEs — PostgreSQL carries their grants + RLS policies through the rename, so
-- nothing must re-run on the live DB for those two. dara_review_personas is NEW and is
-- fail-closed for dara_app until granted (the review load/run queries it), so this file
-- MUST be applied before the code deploy.
--
-- All three carry company_id -> the uniform DARA-004 tenant policy. Idempotent; the
-- canonical DARA-004/005 source files are also updated to the new names for rebuilds.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-01_reviews_rls.sql
-- Re-runnable.

begin;

do $$
declare
  t text;
  review_tables text[] := array['dara_reviews', 'dara_review_documents', 'dara_review_personas'];
begin
  foreach t in array review_tables loop
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
