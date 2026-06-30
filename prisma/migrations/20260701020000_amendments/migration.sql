-- Phase 3 — Amendments + AI reconciliation.
--
-- Add amendments (dara_amendments) whose documents (SolDocument docType=amendment,
-- amendment_id set) are AI-diffed against the compliance matrix into proposed changes
-- (dara_amendment_changes). Accepting a change folds it into the matrix, versioning any
-- modified requirement (dara_requirement_versions) and marking removed ones (removed_at,
-- retained — never deleted). Requirements gain amendment provenance columns.
--
-- New tables are fail-closed for the runtime roles until granted — apply
-- 2026-07-01_amendments_rls.sql before the code deploy.

-- New enum types.
CREATE TYPE "ReconciliationStatus" AS ENUM ('pending', 'proposed', 'applied');
CREATE TYPE "ChangeType" AS ENUM ('add', 'modify', 'remove');
CREATE TYPE "ChangeStatus" AS ENUM ('proposed', 'accepted', 'rejected');

-- Amendments.
CREATE TABLE "dara_amendments" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "solicitation_id" BIGINT NOT NULL,
    "number" VARCHAR(50) NOT NULL DEFAULT '',
    "title" VARCHAR(300) NOT NULL DEFAULT '',
    "effective_date" TIMESTAMP(3),
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'pending',
    "ai_summary" TEXT,
    "applied_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_amendments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dara_amendments_solicitation_id_idx" ON "dara_amendments"("solicitation_id");
CREATE INDEX "dara_amendments_company_id_idx" ON "dara_amendments"("company_id");

-- Proposed changes.
CREATE TABLE "dara_amendment_changes" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "amendment_id" BIGINT NOT NULL,
    "requirement_id" BIGINT,
    "change_type" "ChangeType" NOT NULL,
    "proposed" JSONB,
    "rationale" TEXT,
    "status" "ChangeStatus" NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_amendment_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dara_amendment_changes_company_id_idx" ON "dara_amendment_changes"("company_id");
CREATE INDEX "dara_amendment_changes_amendment_id_idx" ON "dara_amendment_changes"("amendment_id");

-- Requirement prior-version log.
CREATE TABLE "dara_requirement_versions" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "requirement_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "source" "RequirementSource" NOT NULL,
    "is_scored" BOOLEAN NOT NULL,
    "far_reference" VARCHAR(100) NOT NULL,
    "weight" INTEGER NOT NULL,
    "compliance_status" "ComplianceStatus" NOT NULL,
    "proposal_ref" VARCHAR(300) NOT NULL,
    "amendment_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_requirement_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dara_requirement_versions_company_id_idx" ON "dara_requirement_versions"("company_id");
CREATE INDEX "dara_requirement_versions_requirement_id_idx" ON "dara_requirement_versions"("requirement_id");

-- Requirement amendment provenance.
ALTER TABLE "dara_requirements"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "added_by_amendment_id" BIGINT,
    ADD COLUMN "changed_by_amendment_id" BIGINT,
    ADD COLUMN "removed_by_amendment_id" BIGINT,
    ADD COLUMN "removed_at" TIMESTAMP(3);

-- Solicitation documents can belong to an amendment.
ALTER TABLE "dara_sol_documents" ADD COLUMN "amendment_id" BIGINT;
CREATE INDEX "dara_sol_documents_amendment_id_idx" ON "dara_sol_documents"("amendment_id");

-- Foreign keys.
ALTER TABLE "dara_amendments" ADD CONSTRAINT "dara_amendments_solicitation_id_fkey" FOREIGN KEY ("solicitation_id") REFERENCES "dara_solicitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dara_amendment_changes" ADD CONSTRAINT "dara_amendment_changes_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "dara_amendments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dara_amendment_changes" ADD CONSTRAINT "dara_amendment_changes_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "dara_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dara_requirement_versions" ADD CONSTRAINT "dara_requirement_versions_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "dara_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dara_sol_documents" ADD CONSTRAINT "dara_sol_documents_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "dara_amendments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
