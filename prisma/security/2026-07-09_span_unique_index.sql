-- 2026-07-09 — Partial unique index for span-anchored requirement identity.
--
-- The structural anti-duplication defense of the span-extraction redesign: a requirement's
-- identity is (solicitation_id, document_id, span_start, span_end), and this PARTIAL unique
-- index makes a second extraction of the same span a no-op instead of a duplicate row. Partial
-- (WHERE span_start IS NOT NULL) so legacy + manually-added rows (no span) are exempt and never
-- collide.
--
-- Lives here, not in the Prisma migration, because Prisma cannot model a partial unique index
-- (@@unique has no WHERE). Like the RLS policies, it is owner-SQL applied out of band — Prisma's
-- migration history intentionally does not track it.
--
-- Prompt 3's createMany({ skipDuplicates: true }) compiles to INSERT ... ON CONFLICT DO NOTHING,
-- which uses this index as its arbiter for rows within the predicate — so a re-run / regenerate
-- re-extracting identical spans is the intended no-op.
--
-- Apply as owner, alongside the 20260709100000 migration and BEFORE the Prompt-3 deploy:
--   npx tsx prisma/security/apply-sql.ts prisma/security/2026-07-09_span_unique_index.sql
-- Re-runnable.

begin;

-- Belt-and-suspenders: columns are on an already-granted table, but re-assert grants so a
-- disaster-recovery rebuild from owner-SQL alone is complete.
grant select, insert, update, delete on table public.dara_requirements to dara_app, dara_admin;

create unique index if not exists dara_requirements_span_identity_key
  on public.dara_requirements ("solicitation_id", "document_id", "span_start", "span_end")
  where "span_start" is not null;

commit;
