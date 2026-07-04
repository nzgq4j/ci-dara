-- Direct AI review mode — a single-click unified AI review that coexists with the
-- color-team (P1/P2/P3) pass workflow.
--
-- A Direct AI review runs ONE unified analysis of a solicitation's proposal working draft
-- against the RFP and produces a single 0-100 score plus a flat, severity-ranked findings
-- list (no passes, no gates). It is driven by the same async JobQueue worker as the
-- color-team passes.
--
-- Data model (per the Direct AI POA&M, decision D2 — a lightweight dedicated path):
--   * Solicitation.mode  — which paradigm a solicitation runs under (immutable after a run).
--   * dara_direct_reviews — one row per solicitation, holds status/score/progress.
--   * dara_findings       — now serves BOTH paradigms: a finding belongs to exactly one of
--                           a color-team pass (pass_id) or a Direct AI review
--                           (direct_review_id). pass_id becomes nullable; a CHECK enforces
--                           the exactly-one invariant.
--
-- The NEW table (dara_direct_reviews) is fail-closed for the runtime roles until granted —
-- apply 2026-07-04_direct_reviews_rls.sql BEFORE the code deploy.

-- Enums.
CREATE TYPE "ReviewMode" AS ENUM ('direct_ai', 'color_team');
CREATE TYPE "DirectReviewStatus" AS ENUM ('not_started', 'running', 'complete', 'error');

-- Solicitation review paradigm. New solicitations default to direct_ai; existing
-- solicitations predate Direct AI mode and are backfilled to color_team below so their
-- established review workflow is never retroactively switched.
ALTER TABLE "dara_solicitations" ADD COLUMN "mode" "ReviewMode" NOT NULL DEFAULT 'direct_ai';
UPDATE "dara_solicitations" SET "mode" = 'color_team';

-- Direct AI reviews.
CREATE TABLE "dara_direct_reviews" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "solicitation_id" BIGINT NOT NULL,
    "status" "DirectReviewStatus" NOT NULL DEFAULT 'not_started',
    "score" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progress_label" VARCHAR(200) NOT NULL DEFAULT '',
    "findings_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" VARCHAR(500),
    "run_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_direct_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dara_direct_reviews_solicitation_id_key" ON "dara_direct_reviews"("solicitation_id");
CREATE INDEX "dara_direct_reviews_company_id_idx" ON "dara_direct_reviews"("company_id");

-- Findings now serve both paradigms. Make pass_id nullable, add direct_review_id, and
-- require exactly one of the two owners to be set.
ALTER TABLE "dara_findings" ALTER COLUMN "pass_id" DROP NOT NULL;
ALTER TABLE "dara_findings" ADD COLUMN "direct_review_id" BIGINT;
ALTER TABLE "dara_findings" ADD CONSTRAINT "dara_findings_owner_exactly_one"
    CHECK (("pass_id" IS NOT NULL) <> ("direct_review_id" IS NOT NULL));
CREATE INDEX "dara_findings_direct_review_id_idx" ON "dara_findings"("direct_review_id");

-- Foreign keys.
ALTER TABLE "dara_direct_reviews" ADD CONSTRAINT "dara_direct_reviews_solicitation_id_fkey" FOREIGN KEY ("solicitation_id") REFERENCES "dara_solicitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dara_findings" ADD CONSTRAINT "dara_findings_direct_review_id_fkey" FOREIGN KEY ("direct_review_id") REFERENCES "dara_direct_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
