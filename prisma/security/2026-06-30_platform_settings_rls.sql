-- 2026-06-30 — RLS + grants for dara_platform_settings (platform AI keys + model).
--
-- Holds platform-supplied API keys (encrypted) and the central provider/model. Read/
-- written only via prismaAdmin (dara_admin) from the Application Admin console and the
-- evaluation path. The tenant role (dara_app) must never see platform keys, so it gets
-- NO grant and NO policy — fully fail-closed.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-06-30_platform_settings_rls.sql
-- Re-runnable.

begin;

grant select, insert, update, delete on table public.dara_platform_settings to dara_admin;

alter table public.dara_platform_settings enable row level security;

drop policy if exists dara_admin_all on public.dara_platform_settings;
create policy dara_admin_all on public.dara_platform_settings
  for all to dara_admin using (true) with check (true);

commit;

-- ── Verification ────────────────────────────────────────────────────────────
--   select policyname, roles from pg_policies
--     where schemaname='public' and tablename='dara_platform_settings';
