-- 2026-06-27 — Security remediation (DARA-005 + partial DARA-003)
--
-- Closes the confirmed CRITICAL exposure where the public Supabase anon key
-- (and the authenticated role) had FULL privileges on every tenant table via
-- PostgREST, bypassing all application-layer companyId scoping. Also enables
-- Row-Level Security as a deny-by-default backstop.
--
-- Safe for the app: it connects via Prisma as the project-owner role `postgres`
-- (rolbypassrls = true), which is unaffected by these REVOKE/ENABLE RLS changes.
-- The app does not read dara_* tables through PostgREST (Prisma-only).

begin;

-- 1) Remove all PostgREST (anon/authenticated) access to tenant tables.
revoke all privileges on table
  public.dara_companies, public.dara_users, public.dara_solicitations,
  public.dara_sol_documents, public.dara_requirements, public.dara_personas,
  public.dara_reviews, public.dara_review_documents, public.dara_review_personas,
  public.dara_evaluations, public.dara_results, public.dara_job_queue
from anon, authenticated;

-- 2) Enable RLS (no policies = deny-by-default for any non-BYPASSRLS role).
alter table public.dara_companies      enable row level security;
alter table public.dara_users          enable row level security;
alter table public.dara_solicitations  enable row level security;
alter table public.dara_sol_documents  enable row level security;
alter table public.dara_requirements   enable row level security;
alter table public.dara_personas       enable row level security;
alter table public.dara_reviews          enable row level security;
alter table public.dara_review_documents enable row level security;
alter table public.dara_review_personas  enable row level security;
alter table public.dara_evaluations    enable row level security;
alter table public.dara_results        enable row level security;
alter table public.dara_job_queue      enable row level security;

-- 3) Prevent future tables created by this role from auto-granting to anon/auth
--    (Supabase's default-privilege grants are how the exposure arose).
alter default privileges in schema public revoke all on tables from anon, authenticated;

commit;
