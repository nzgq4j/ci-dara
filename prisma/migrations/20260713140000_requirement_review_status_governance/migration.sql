-- Parse-QA review status + L→M governance linkage for shredded requirements.
-- Additive: a new enum + two columns (both defaulted, so existing rows backfill without a data step).
-- Table-level grants on dara_requirements already extend to new columns, so no paired RLS file is
-- required (same pattern as prior additive-column migrations).

-- Parse-QA review state (distinct from the color-team "ReviewStatus" enum).
CREATE TYPE "RequirementReviewStatus" AS ENUM ('pending', 'approved', 'rejected', 'flagged');

ALTER TABLE "dara_requirements"
  ADD COLUMN "review_status" "RequirementReviewStatus" NOT NULL DEFAULT 'pending';

-- Section M evaluation-factor markers/names each Section L instruction or SOW-PWS task feeds into.
ALTER TABLE "dara_requirements"
  ADD COLUMN "governing_factors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
