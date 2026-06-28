-- 2026-06-28 — Security remediation DARA-013 (append-only audit trail)
--
-- Creates dara_audit_log to match the Prisma AuditLog model. Run as the OWNER
-- (DIRECT_URL), since it grants/alters. We create the table by SQL rather than
-- `prisma db push` to avoid db push reconciling unmanaged legacy tables in public
-- (DARA-017). Re-runnable: guarded with IF [NOT] EXISTS / DROP POLICY IF EXISTS.
--
-- Access model: written/read ONLY via the privileged client (dara_admin). The app
-- role (dara_app) gets no access. Append-only is enforced by granting SELECT/INSERT
-- only — no UPDATE/DELETE.

begin;

create table if not exists public.dara_audit_log (
  id           bigserial primary key,
  company_id   bigint,
  actor_id     uuid,
  actor_email  varchar(255) not null default '',
  action       varchar(100) not null,
  entity_type  varchar(50)  not null default '',
  entity_id    varchar(100),
  metadata     jsonb,
  created_at   timestamp(3) not null default now()
);

create index if not exists dara_audit_log_company_id_created_at_idx
  on public.dara_audit_log (company_id, created_at);
create index if not exists dara_audit_log_action_idx
  on public.dara_audit_log (action);

-- Lock out PostgREST roles (consistent with the other dara_* tables).
revoke all privileges on table public.dara_audit_log from anon, authenticated;

-- Append-only privileged access for dara_admin (no UPDATE/DELETE granted).
grant select, insert on table public.dara_audit_log to dara_admin;
grant usage, select on sequence public.dara_audit_log_id_seq to dara_admin;

-- RLS on; dara_admin permissive policy (same pattern as DARA-004). dara_app has
-- no grant and no policy → fully denied.
alter table public.dara_audit_log enable row level security;
drop policy if exists dara_admin_all on public.dara_audit_log;
create policy dara_admin_all on public.dara_audit_log
  for all to dara_admin using (true) with check (true);

commit;

-- Verify:
--   select count(*) from public.dara_audit_log;
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'dara_audit_log';
