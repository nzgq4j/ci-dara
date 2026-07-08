-- 2026-07-08 — RLS + grants for dara_ai_model_price (per-model AI token pricing).
--
-- Written by the weekly pricing-refresh cron + operator overrides, read by the Application
-- Admin usage/cost report. Like the usage ledger it is platform-operator data, written + read
-- ONLY via prismaAdmin (dara_admin); the tenant role (dara_app) gets NO grant and NO policy,
-- fully fail-closed. (delete is granted so an operator can remove a stale override row.)
--
-- The table is NEW and fail-closed until granted, so this file MUST be applied before the code
-- deploy that starts writing to it. NIST SP 800-171 03.01.x (access control) + 03.03.x.
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-08_ai_model_price_rls.sql
-- Re-runnable.

begin;

grant select, insert, update, delete on table public.dara_ai_model_price to dara_admin;
grant usage, select on sequence public.dara_ai_model_price_id_seq to dara_admin;

alter table public.dara_ai_model_price enable row level security;

drop policy if exists dara_admin_all on public.dara_ai_model_price;
create policy dara_admin_all on public.dara_ai_model_price
  for all to dara_admin using (true) with check (true);

commit;

-- ── Verification ────────────────────────────────────────────────────────────
--   select policyname, roles from pg_policies
--     where schemaname='public' and tablename='dara_ai_model_price';
--   -- dara_app must have NO grant:
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name='dara_ai_model_price';
