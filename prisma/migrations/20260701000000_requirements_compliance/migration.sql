-- Phase 1 — Requirements + Compliance matrix.
--
-- Evolves the former Criterion model into Requirement: rename dara_criteria ->
-- dara_requirements, add the compliance-matrix columns (source / is_scored /
-- compliance_status / proposal_ref), and migrate the old criterion_type into the
-- new source + is_scored pair. The dara_results.criterion_id column is left as-is
-- (the Prisma field is remapped, so its FK + unique index keep their names).
--
-- RLS/grants follow the table through the RENAME on the live DB; the canonical
-- DARA-004 source file is updated to the new name for disaster-recovery rebuilds,
-- and 2026-07-01_requirements_rls.sql re-asserts the policy idempotently.

-- New enum types.
CREATE TYPE "RequirementSource" AS ENUM ('instruction', 'evaluation_factor', 'sow_pws', 'far_clause', 'other');
CREATE TYPE "ComplianceStatus" AS ENUM ('not_assessed', 'compliant', 'partial', 'non_compliant', 'not_applicable');

-- Rename the table and its own indexes/constraints to the new convention.
ALTER TABLE "dara_criteria" RENAME TO "dara_requirements";
ALTER INDEX "dara_criteria_pkey" RENAME TO "dara_requirements_pkey";
ALTER INDEX "dara_criteria_solicitation_id_idx" RENAME TO "dara_requirements_solicitation_id_idx";
ALTER INDEX "dara_criteria_company_id_idx" RENAME TO "dara_requirements_company_id_idx";
ALTER TABLE "dara_requirements" RENAME CONSTRAINT "dara_criteria_solicitation_id_fkey" TO "dara_requirements_solicitation_id_fkey";

-- New compliance-matrix columns.
ALTER TABLE "dara_requirements"
    ADD COLUMN "source" "RequirementSource" NOT NULL DEFAULT 'evaluation_factor',
    ADD COLUMN "is_scored" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "compliance_status" "ComplianceStatus" NOT NULL DEFAULT 'not_assessed',
    ADD COLUMN "proposal_ref" VARCHAR(300) NOT NULL DEFAULT '';

-- Migrate the old criterion_type into source + is_scored.
UPDATE "dara_requirements" SET "source" = 'evaluation_factor', "is_scored" = true  WHERE "criterion_type" IN ('scored_factor', 'subfactor');
UPDATE "dara_requirements" SET "source" = 'evaluation_factor', "is_scored" = false WHERE "criterion_type" = 'pass_fail';
UPDATE "dara_requirements" SET "source" = 'instruction',       "is_scored" = false WHERE "criterion_type" = 'administrative';
UPDATE "dara_requirements" SET "source" = 'sow_pws',           "is_scored" = false WHERE "criterion_type" = 'requirement';

-- Drop the superseded column.
ALTER TABLE "dara_requirements" DROP COLUMN "criterion_type";
