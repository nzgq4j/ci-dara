-- Requirement disposition — auto-classification of how each matrix row is handled.
--
-- The AI shred now sorts each requirement into one of three buckets (independent of
-- `source`, which records where it came from):
--   scored         — Section M evaluation factor/subfactor → holistic color-team review.
--   compliance     — pass/fail requirement the proposal must demonstrate → compliance sweep.
--   administrative — requirement complied with but not written up in the proposal (reps &
--                    certs, SAM/CAGE, submission logistics) → tracked, marked N/A, not swept.
--
-- `is_scored` is retained and kept in sync (scored ⇔ is_scored = true) so the review engine
-- (runEvaluation) is unchanged. The compliance sweep now targets disposition = 'compliance'.
--
-- Column-only add on an already-granted table — apply with `migrate deploy`; no new RLS file.

CREATE TYPE "RequirementDisposition" AS ENUM ('scored', 'compliance', 'administrative');

ALTER TABLE "dara_requirements"
    ADD COLUMN "disposition" "RequirementDisposition" NOT NULL DEFAULT 'compliance';

-- Backfill: existing scored factors become 'scored'; everything else stays 'compliance'
-- (preserves the prior behaviour of sweeping all non-scored rows until the next re-shred).
UPDATE "dara_requirements" SET "disposition" = 'scored' WHERE "is_scored" = true;
