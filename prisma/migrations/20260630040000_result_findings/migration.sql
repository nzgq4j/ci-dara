-- Structured evaluation findings on results. ai_strengths/ai_weaknesses already
-- exist (JSONB); add the compliance summary and suggested-changes list. Existing
-- table — RLS/grants unchanged.
ALTER TABLE "dara_results"
    ADD COLUMN "ai_compliance" TEXT,
    ADD COLUMN "ai_suggested_changes" JSONB;
