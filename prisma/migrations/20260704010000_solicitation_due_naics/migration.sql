-- Dashboard fields: NAICS code + submission due date on solicitations. Used by the
-- redesigned dashboard (countdown chip, "due <= 7 days" KPI) and deadline tracking.
-- Both are additive + nullable/defaulted, so backward-compatible with the deployed code;
-- no RLS change (columns on the already-protected dara_solicitations table).

ALTER TABLE "dara_solicitations" ADD COLUMN "naics" VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE "dara_solicitations" ADD COLUMN "due_date" TIMESTAMP(3);
