-- 2026-06-27 — Security remediation DARA-004 (closes DARA-003)
--
-- Least-privilege DB roles + per-tenant Row-Level Security policies.
--
-- Background: DARA-005 enabled RLS on all dara_* tables but left it INERT,
-- because the app connects as the project owner `postgres` (rolbypassrls = true).
-- This script introduces two non-owner runtime roles and the policies that make
-- the database enforce tenant isolation independently of application code.
--
--   dara_app    — normal tenant requests. NOT bypassrls. Sees only rows whose
--                 company matches the per-transaction GUC `app.company_id`.
--   dara_admin  — the three audited cross-tenant paths (provisioning, Stripe
--                 webhook, platform admin). Granted an explicit permissive
--                 policy (using(true)) rather than the BYPASSRLS *attribute*, so
--                 this script does not depend on the privilege to confer
--                 BYPASSRLS (which managed Postgres platforms may withhold) and
--                 the cross-tenant grant is visible in pg_policies.
--   postgres    — owner; used by migrations only (prisma db push via DIRECT_URL).
--                 Table owners bypass RLS by default (tables are NOT FORCED), so
--                 migrations keep working with no policy of their own.
--
-- The tenant key is read with current_setting('app.company_id', true) (missing_ok),
-- wrapped in nullif(...,'') so an unset/empty GUC yields NULL -> the row predicate
-- is never true -> queries with no tenant context return ZERO rows (fail-closed),
-- never another tenant's data.
--
-- Re-runnable: role creation is guarded; policies are dropped-if-exists then
-- recreated; enabling RLS is idempotent.
--
-- ┌─ OPERATOR STEP (do NOT commit secrets) ───────────────────────────────────┐
-- │ After running this script, set login + password for each role in the      │
-- │ Supabase SQL editor (these lines are intentionally NOT in this file):     │
-- │     alter role dara_app   with login password '<generated-strong-secret>';│
-- │     alter role dara_admin  with login password '<generated-strong-secret>';│
-- │ Then add the pooled connection strings to Vercel (all envs) + .env.local:  │
-- │     DATABASE_URL_APP    (Supavisor user  dara_app.<project_ref>)           │
-- │     DATABASE_URL_ADMIN  (Supavisor user  dara_admin.<project_ref>)         │
-- │ Keep DIRECT_URL (owner) for migrations. Retire runtime use of DATABASE_URL.│
-- └────────────────────────────────────────────────────────────────────────────┘

begin;

-- 1) Roles (no LOGIN/PASSWORD here; set out-of-band per the operator step above).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dara_app') then
    create role dara_app;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dara_admin') then
    create role dara_admin;
  end if;
end $$;

-- 2) Least-privilege grants. dara_* tables only — no access to auth/storage/other
--    schemas, no DDL. New tables added later are fail-closed for dara_app (RLS on
--    + no policy = deny) and inaccessible until granted; add grants+policies when
--    a new dara_* table is introduced.
grant usage on schema public to dara_app, dara_admin;

grant select, insert, update, delete on table
  public.dara_companies, public.dara_users, public.dara_solicitations,
  public.dara_sol_documents, public.dara_requirements, public.dara_personas,
  public.dara_reviews, public.dara_review_documents, public.dara_review_personas,
  public.dara_evaluations, public.dara_results, public.dara_job_queue
to dara_app, dara_admin;

grant usage, select on all sequences in schema public to dara_app, dara_admin;

-- 3) Ensure RLS is on (idempotent; DARA-005 already enabled these).
alter table public.dara_companies      enable row level security;
alter table public.dara_users          enable row level security;
alter table public.dara_solicitations  enable row level security;
alter table public.dara_sol_documents  enable row level security;
alter table public.dara_requirements       enable row level security;
alter table public.dara_personas       enable row level security;
alter table public.dara_reviews          enable row level security;
alter table public.dara_review_documents enable row level security;
alter table public.dara_review_personas  enable row level security;
alter table public.dara_evaluations    enable row level security;
alter table public.dara_results        enable row level security;
alter table public.dara_job_queue      enable row level security;

-- 4) Policies.
--    a) dara_companies is keyed on `id` (it has no company_id column).
drop policy if exists dara_tenant_isolation on public.dara_companies;
create policy dara_tenant_isolation on public.dara_companies
  for all to dara_app
  using      (id = nullif(current_setting('app.company_id', true), '')::bigint)
  with check (id = nullif(current_setting('app.company_id', true), '')::bigint);

drop policy if exists dara_admin_all on public.dara_companies;
create policy dara_admin_all on public.dara_companies
  for all to dara_admin using (true) with check (true);

--    b) The other ten tables all carry a denormalized company_id -> uniform policy.
do $$
declare
  t text;
  tenant_tables text[] := array[
    'dara_users', 'dara_solicitations', 'dara_sol_documents', 'dara_requirements',
    'dara_personas', 'dara_reviews', 'dara_review_documents', 'dara_review_personas',
    'dara_evaluations', 'dara_results', 'dara_job_queue'];
begin
  foreach t in array tenant_tables loop
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

commit;

-- ── Verification (run after commit) ─────────────────────────────────────────
-- dara_app must NOT bypass RLS; dara_admin policy is permissive, not an attribute:
--   select rolname, rolbypassrls, rolcanlogin from pg_roles
--   where rolname in ('dara_app','dara_admin','postgres');
-- Every dara_* table should show two policies (dara_tenant_isolation, dara_admin_all):
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and tablename like 'dara_%' order by tablename, policyname;
-- Isolation smoke test (as dara_app):
--   set role dara_app;
--   select set_config('app.company_id', '1', true);
--   select count(*) from public.dara_solicitations;          -- only company 1's rows
--   select set_config('app.company_id', '', true);
--   select count(*) from public.dara_solicitations;          -- 0 (fail-closed)
--   reset role;
