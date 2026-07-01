-- Multi-pass AI review — three sequential lenses per color-team review.
--
-- Each review run now executes Pass 1 (Compliance & Format), Pass 2 (Technical
-- Responsiveness), Pass 3 (Risk & Competitive), each producing a 0-100 score + a set of
-- severity-ranked findings. Passes are driven by the async JobQueue worker; the UI polls
-- their status/progress.
--
-- NEW tables (dara_review_passes, dara_findings) are fail-closed for the runtime roles
-- until granted — apply 2026-07-01_review_passes_rls.sql BEFORE the code deploy.

-- Enums.
CREATE TYPE "ReviewPassType" AS ENUM ('compliance_format', 'technical_responsiveness', 'risk_competitive');
CREATE TYPE "PassStatus" AS ENUM ('not_started', 'queued', 'running', 'complete', 'error');
CREATE TYPE "FindingSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- Review passes.
CREATE TABLE "dara_review_passes" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "review_id" BIGINT NOT NULL,
    "pass_type" "ReviewPassType" NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'not_started',
    "score" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progress_label" VARCHAR(200) NOT NULL DEFAULT '',
    "findings_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" VARCHAR(500),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_review_passes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dara_review_passes_review_id_pass_type_key" ON "dara_review_passes"("review_id", "pass_type");
CREATE INDEX "dara_review_passes_company_id_idx" ON "dara_review_passes"("company_id");
CREATE INDEX "dara_review_passes_review_id_idx" ON "dara_review_passes"("review_id");

-- Findings.
CREATE TABLE "dara_findings" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "pass_id" BIGINT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "text" TEXT NOT NULL,
    "requirement_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "recommended_action" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_findings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dara_findings_company_id_idx" ON "dara_findings"("company_id");
CREATE INDEX "dara_findings_pass_id_idx" ON "dara_findings"("pass_id");

-- Foreign keys.
ALTER TABLE "dara_review_passes" ADD CONSTRAINT "dara_review_passes_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "dara_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dara_findings" ADD CONSTRAINT "dara_findings_pass_id_fkey" FOREIGN KEY ("pass_id") REFERENCES "dara_review_passes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
