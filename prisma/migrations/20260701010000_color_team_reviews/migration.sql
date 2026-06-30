-- Phase 2 — Color-team reviews.
--
-- Reframe offerors -> color-team reviews of our own proposal. Rename dara_responses
-- -> dara_reviews and dara_response_files -> dara_review_documents (per-review draft
-- snapshots), add the review fields (color_team / status / snapshot_at / created_by /
-- updated_at), add doc_type to dara_sol_documents (proposal working draft lives on the
-- solicitation), and add dara_review_personas (which personas run in a review).
--
-- Columns kept to avoid FK/index churn: dara_reviews uses offeror_name (Prisma field
-- remapped to `name`); dara_review_documents keeps response_id/uploaded_at (Prisma
-- reviewId/capturedAt); dara_evaluations keeps response_id (Prisma reviewId). The
-- renamed tables carry their RLS/grants through the RENAME; the NEW dara_review_personas
-- needs its grants+RLS applied (2026-07-01_review_personas_rls.sql) before code deploy.

-- New enum types.
CREATE TYPE "ColorTeam" AS ENUM ('pink', 'red', 'gold', 'blue', 'green', 'black', 'white');
CREATE TYPE "ReviewStatus" AS ENUM ('draft', 'in_progress', 'complete');
CREATE TYPE "DocType" AS ENUM ('rfp', 'amendment', 'proposal');

-- Solicitation documents gain a type (rfp = the solicitation, proposal = our draft).
ALTER TABLE "dara_sol_documents"
    ADD COLUMN "doc_type" "DocType" NOT NULL DEFAULT 'rfp';

-- Rename dara_responses -> dara_reviews (+ its indexes/constraints).
ALTER TABLE "dara_responses" RENAME TO "dara_reviews";
ALTER INDEX "dara_responses_pkey" RENAME TO "dara_reviews_pkey";
ALTER INDEX "dara_responses_solicitation_id_idx" RENAME TO "dara_reviews_solicitation_id_idx";
ALTER INDEX "dara_responses_company_id_idx" RENAME TO "dara_reviews_company_id_idx";
ALTER TABLE "dara_reviews" RENAME CONSTRAINT "dara_responses_solicitation_id_fkey" TO "dara_reviews_solicitation_id_fkey";

-- Review fields. offeror_name stays as the column (Prisma maps it to `name`).
ALTER TABLE "dara_reviews"
    ADD COLUMN "color_team" "ColorTeam" NOT NULL DEFAULT 'pink',
    ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'draft',
    ADD COLUMN "snapshot_at" TIMESTAMP(3),
    ADD COLUMN "created_by" UUID,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rename dara_response_files -> dara_review_documents (per-review draft snapshots).
ALTER TABLE "dara_response_files" RENAME TO "dara_review_documents";
ALTER INDEX "dara_response_files_pkey" RENAME TO "dara_review_documents_pkey";
ALTER INDEX "dara_response_files_response_id_idx" RENAME TO "dara_review_documents_response_id_idx";
ALTER INDEX "dara_response_files_company_id_idx" RENAME TO "dara_review_documents_company_id_idx";
ALTER TABLE "dara_review_documents" RENAME CONSTRAINT "dara_response_files_response_id_fkey" TO "dara_review_documents_response_id_fkey";

-- New join: which personas run in a review.
CREATE TABLE "dara_review_personas" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "review_id" BIGINT NOT NULL,
    "persona_id" BIGINT NOT NULL,

    CONSTRAINT "dara_review_personas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dara_review_personas_review_id_persona_id_key" ON "dara_review_personas"("review_id", "persona_id");
CREATE INDEX "dara_review_personas_company_id_idx" ON "dara_review_personas"("company_id");
CREATE INDEX "dara_review_personas_review_id_idx" ON "dara_review_personas"("review_id");

ALTER TABLE "dara_review_personas" ADD CONSTRAINT "dara_review_personas_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "dara_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dara_review_personas" ADD CONSTRAINT "dara_review_personas_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "dara_personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
