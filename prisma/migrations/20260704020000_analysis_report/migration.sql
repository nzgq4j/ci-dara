-- Solicitation Analysis Report — action-plan fields + holistic report outputs.
--
-- Adds the report's per-finding action-plan columns (owner/effort/status) and the holistic
-- report outputs (DARA recommendation, recommended submit date, pre-submission checklist) on
-- both review paradigms (DirectReview for auto-review, Review for color-team).
--
-- All additive + nullable/defaulted → backward-compatible with deployed code; column-only adds
-- on already-RLS-protected tables (dara_findings, dara_direct_reviews, dara_reviews), so no new
-- RLS file. Apply with `migrate deploy`.

CREATE TYPE "FindingStatus" AS ENUM ('open', 'in_progress', 'resolved');
CREATE TYPE "EffortBand" AS ENUM ('low', 'moderate', 'medium', 'high');
CREATE TYPE "ChecklistState" AS ENUM ('pass', 'fail', 'na');

ALTER TABLE "dara_findings"
    ADD COLUMN "status" "FindingStatus" NOT NULL DEFAULT 'open',
    ADD COLUMN "owner_role" VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN "owner_name" VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN "effort_band" "EffortBand",
    ADD COLUMN "effort_estimate" VARCHAR(120) NOT NULL DEFAULT '';

ALTER TABLE "dara_direct_reviews"
    ADD COLUMN "recommendation" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "recommended_submit_at" DATE,
    ADD COLUMN "checklist_json" JSONB;

ALTER TABLE "dara_reviews"
    ADD COLUMN "recommendation" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "recommended_submit_at" DATE,
    ADD COLUMN "checklist_json" JSONB;
