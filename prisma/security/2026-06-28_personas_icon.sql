-- 2026-06-28 — add dara_personas.icon (selectable persona icon)
--
-- Additive, backward-compatible. Run as the OWNER (DIRECT_URL) via apply-sql.ts.
-- Table-level grants on dara_personas already cover new columns, and RLS policies
-- apply to the whole row, so no grant/policy changes are needed.
alter table public.dara_personas add column if not exists icon varchar(16);
