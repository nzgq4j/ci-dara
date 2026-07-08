-- 2026-07-08 — RLS + grants for dara_ai_usage_log (append-only AI usage ledger).
--
-- The ledger holds one row per LLM call and is written + read ONLY via prismaAdmin
-- (dara_admin): logUsage() writes it from the evaluation/worker path, and the Application
-- Admin usage report reads it. It is platform-operator data (cross-tenant usage/billing),
-- so the tenant role (dara_app) must never see it — it gets NO grant and NO policy, fully
-- fail-closed (same boundary as dara_platform_settings and dara_audit_log).
--
-- The table is NEW and fail-closed until granted, so this file MUST be applied before the
-- code deploy that starts writing to it. NIST SP 800-171 03.01.x (access control) +
-- 03.03.x (audit/accountability — usage accounting).
--
-- Apply as owner:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-08_ai_usage_log_rls.sql
-- Re-runnable.

begin;

grant select, insert on table public.dara_ai_usage_log to dara_admin;
grant usage, select on sequence public.dara_ai_usage_log_id_seq to dara_admin;

alter table public.dara_ai_usage_log enable row level security;

drop policy if exists dara_admin_all on public.dara_ai_usage_log;
create policy dara_admin_all on public.dara_ai_usage_log
  for all to dara_admin using (true) with check (true);

commit;

-- ── Verification ────────────────────────────────────────────────────────────
--   select policyname, roles from pg_policies
--     where schemaname='public' and tablename='dara_ai_usage_log';
--   -- dara_app must have NO grant:
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name='dara_ai_usage_log';
