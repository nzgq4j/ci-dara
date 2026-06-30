-- Result: review summary (ai_review) + regeneration/archive tracking.
ALTER TABLE "dara_results"
    ADD COLUMN "ai_review" JSONB,
    ADD COLUMN "regen_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "archived_at" TIMESTAMP(3),
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Prior-version log: a snapshot of a result taken just before it is regenerated.
CREATE TABLE "dara_result_versions" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "result_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "ai_determination" VARCHAR(50),
    "ai_score" DECIMAL(5,2),
    "ai_rationale" TEXT,
    "ai_confidence" DECIMAL(5,4),
    "ai_strengths" JSONB,
    "ai_weaknesses" JSONB,
    "ai_compliance" TEXT,
    "ai_suggested_changes" JSONB,
    "ai_review" JSONB,
    "model_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_result_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dara_result_versions_company_id_idx" ON "dara_result_versions"("company_id");
CREATE INDEX "dara_result_versions_result_id_idx" ON "dara_result_versions"("result_id");

ALTER TABLE "dara_result_versions" ADD CONSTRAINT "dara_result_versions_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "dara_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
