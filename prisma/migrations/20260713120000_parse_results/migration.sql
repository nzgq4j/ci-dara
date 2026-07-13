-- Modal structural pre-processing output — dara_parse_results.
--
-- One immutable row per parse of a dara_sol_documents row: the full ParseResult JSON from the
-- Modal `dara-parser` service (pdfplumber / python-docx + spaCy) plus denormalized summary
-- counts for cheap list queries. Never hard-deleted — a re-parse sets superseded_at on the
-- prior row(s) and inserts a new one, so this is a full parse-history log. The current parse
-- for a document is the row with superseded_at IS NULL.
--
-- Tenant-scoped (company_id). The NEW table is fail-closed for the runtime roles until granted
-- — apply prisma/security/2026-07-13_parse_results_rls.sql BEFORE the code deploy.

CREATE TABLE "dara_parse_results" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "sol_doc_id" BIGINT NOT NULL,
    "schema_version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "parser_version" VARCHAR(20) NOT NULL,
    "doc_type" VARCHAR(20) NOT NULL,
    "page_count" INTEGER,
    "word_count" INTEGER,
    "processing_time_ms" INTEGER,
    "quality_gate_passed" BOOLEAN NOT NULL DEFAULT false,
    "quality_gate_failures" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB NOT NULL,
    "modal_candidate_count" INTEGER,
    "table_count" INTEGER,
    "ibr_flag_count" INTEGER,
    "image_page_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "dara_parse_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dara_parse_results_sol_doc_id_idx" ON "dara_parse_results"("sol_doc_id");
CREATE INDEX "dara_parse_results_company_id_idx" ON "dara_parse_results"("company_id");
CREATE INDEX "dara_parse_results_created_at_idx" ON "dara_parse_results"("created_at");

ALTER TABLE "dara_parse_results"
    ADD CONSTRAINT "dara_parse_results_sol_doc_id_fkey"
    FOREIGN KEY ("sol_doc_id") REFERENCES "dara_sol_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
