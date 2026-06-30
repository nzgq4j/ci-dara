-- 2026-06-30 — RLS + grants for dara_platform_admins (Application Admin feature).
--
-- This is a PLATFORM table, not a tenant table: it has no company_id and is read/
-- written only via prismaAdmin (the dara_admin runtime role) from the platform-admin
-- pages and the login path. The tenant runtime role (dara_app) must never see it, so
-- it gets NO grant and NO policy — fully fail-closed. RLS is enabled as a deny-by-
-- default backstop; dara_admin gets an explicit permissive policy.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-06-30_platform_admins_rls.sql
-- Re-runnable: grants are additive; the policy is dropped-if-exists then recreated.

begin;

-- 1) Grant the cross-tenant runtime role full DML; dara_app intentionally omitted.
grant select, insert, update, delete on table public.dara_platform_admins to dara_admin;

-- BIGSERIAL id sequence needs usage+select for inserts under dara_admin.
grant usage, select on all sequences in schema public to dara_admin;

-- 2) Enable RLS (deny-by-default for any role without a policy, incl. dara_app).
alter table public.dara_platform_admins enable row level security;

-- 3) Permissive cross-tenant policy for the admin role only.
drop policy if exists dara_admin_all on public.dara_platform_admins;
create policy dara_admin_all on public.dara_platform_admins
  for all to dara_admin using (true) with check (true);

commit;

-- ── Verification (run after commit) ─────────────────────────────────────────
-- Exactly one policy (dara_admin_all), and dara_app has no grant:
--   select policyname, roles from pg_policies
--     where schemaname='public' and tablename='dara_platform_admins';
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name='dara_platform_admins' order by grantee;
