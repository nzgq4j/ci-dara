-- Per-file document role classification for solicitation-package uploads, plus a "skipped"
-- extraction state for stored-only supporting documents (not text-extracted / not parsed).
--
-- Additive only: a new enum, a nullable column, and one new ExtractionStatus value. Existing
-- dara_sol_documents rows get document_role = NULL (legacy = treated as an extracted document).
-- Table-level grants on dara_sol_documents already extend to the new column, so no paired RLS
-- file is required (same pattern as prior additive-column migrations).

-- Fine-grained classification of a solicitation document, assigned per file at upload time.
CREATE TYPE "DocumentRole" AS ENUM (
  'rfp_base',
  'pws_sow',
  'cdrl',
  'section_j_attachment',
  'amendment',
  'wage_determination',
  'past_performance_template',
  'questionnaire',
  'market_research',
  'other_supporting'
);

ALTER TABLE "dara_sol_documents"
  ADD COLUMN "document_role" "DocumentRole";

-- true = the role was assigned by the content classifier and not yet confirmed by a human.
ALTER TABLE "dara_sol_documents"
  ADD COLUMN "document_role_suggested" BOOLEAN NOT NULL DEFAULT false;

-- Stored-only documents are uploaded with extraction_status = 'skipped' (kept in storage, never
-- text-extracted or structurally parsed, and excluded from the shred which requires 'complete').
-- PostgreSQL 12+ (Supabase is 15+) permits ADD VALUE inside a migration transaction; the new
-- values are not referenced in this same migration, so no cross-statement usage constraint applies.
ALTER TYPE "ExtractionStatus" ADD VALUE 'skipped';

-- Usage-ledger capability for the content-based document-role classifier that runs at upload.
ALTER TYPE "AICapability" ADD VALUE 'document_classify';
