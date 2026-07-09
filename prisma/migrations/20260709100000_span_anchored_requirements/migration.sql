-- Span-anchored requirement extraction — schema + migration (step 1 of 6).
--
-- Makes a requirement's identity a VERIFIED character range in a source document
-- (document_id, span_start, span_end) instead of an LLM-generated name, and adds the linkage
-- for user-initiated decomposition of compound requirements. Additive: every new column is
-- nullable or defaulted, so existing + manually-added requirement rows (which carry no span)
-- are untouched.
--
-- The columns/FKs/indexes here are all Prisma-modeled. The STRUCTURAL anti-duplication defense
-- — a PARTIAL unique index on (solicitation_id, document_id, span_start, span_end) WHERE
-- span_start IS NOT NULL — is NOT expressible in Prisma, so it ships as owner-SQL in
-- prisma/security/2026-07-09_span_unique_index.sql. Apply that file (as owner) alongside this
-- migration and BEFORE the Prompt-3 pipeline deploys.
--
-- Column-only adds on an already-granted table (dara_requirements): no new RLS file needed —
-- the existing dara_tenant_isolation / dara_admin_all policies + grants cover the new columns.

-- Composition classification (mirrors utils/dara/spans.ts `Composition`).
CREATE TYPE "RequirementComposition" AS ENUM ('atomic', 'compound', 'unclassified');

-- Span identity + decomposition linkage on the matrix row.
ALTER TABLE "dara_requirements"
    ADD COLUMN "document_id" BIGINT,
    ADD COLUMN "span_start" INTEGER,
    ADD COLUMN "span_end" INTEGER,
    ADD COLUMN "composition" "RequirementComposition",
    ADD COLUMN "obligation_count" INTEGER,
    ADD COLUMN "enumerator_count" INTEGER,
    ADD COLUMN "parent_id" BIGINT,
    ADD COLUMN "child_order" INTEGER,
    ADD COLUMN "rollup_mode" VARCHAR(30),
    ADD COLUMN "decomposition_source" VARCHAR(30),
    ADD COLUMN "decomposed_at" TIMESTAMP(3),
    ADD COLUMN "citation_synthesized" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "dara_requirements_document_id_idx" ON "dara_requirements"("document_id");
CREATE INDEX "dara_requirements_parent_id_idx" ON "dara_requirements"("parent_id");

-- Foreign keys. document_id -> SET NULL (keep the matrix row if its source doc is removed; the
-- span becomes unverifiable but user data survives — mirrors dara_amendment_changes ->
-- requirements). parent_id -> CASCADE (a decomposition child has no meaning without its parent).
ALTER TABLE "dara_requirements" ADD CONSTRAINT "dara_requirements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "dara_sol_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dara_requirements" ADD CONSTRAINT "dara_requirements_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "dara_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
