-- 2026-06-29 — Per-tenant RLS for the Teams feature (DARA-004 model extension)
--
-- Adds the three new dara_* tables (teams, team_members, invitations) to the
-- least-privilege + Row-Level Security posture established in
-- 2026-06-27_dara004_rls_policies.sql. Without this, dara_app is fail-closed on the
-- new tables (RLS on by default for new tables? No — RLS must be enabled; but the
-- runtime role also has no grants), so the app could not read/write them at all.
--
-- All three tables carry a denormalized company_id, so they use the same uniform
-- tenant policy as the other ten tables: dara_app sees only rows matching the
-- per-transaction GUC app.company_id (fail-closed when unset); dara_admin gets the
-- explicit permissive cross-tenant policy used by provisioning (invite acceptance
-- runs before a tenant context exists) and platform admin.
--
-- Apply as owner:  npx tsx prisma/security/apply-sql.ts prisma/security/2026-06-29_teams_rls.sql
-- Re-runnable: grants are additive, policies are dropped-if-exists then recreated,
-- enabling RLS is idempotent.

begin;

-- 1) Least-privilege grants on the new tables (dara_* only).
grant select, insert, update, delete on table
  public.dara_teams, public.dara_team_members, public.dara_invitations
to dara_app, dara_admin;

-- New BIGSERIAL sequences need usage+select for inserts under the runtime roles.
grant usage, select on all sequences in schema public to dara_app, dara_admin;

-- 2) Enable RLS on the new tables.
alter table public.dara_teams        enable row level security;
alter table public.dara_team_members enable row level security;
alter table public.dara_invitations  enable row level security;

-- 3) Per-tenant policies (company_id-keyed), matching the DARA-004 uniform pattern.
do $$
declare
  t text;
  tenant_tables text[] := array['dara_teams', 'dara_team_members', 'dara_invitations'];
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
-- Each new table should show two policies (dara_tenant_isolation, dara_admin_all):
--   select tablename, policyname, roles from pg_policies
--   where schemaname='public' and tablename in
--     ('dara_teams','dara_team_members','dara_invitations')
--   order by tablename, policyname;
