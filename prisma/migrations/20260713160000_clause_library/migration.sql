-- Local regulatory clause library for deterministic IbR traversal (Pass 3). Global/shared reference
-- data (no company_id) populated by the admin GSA-DITA sync job. Paired RLS lives in
-- prisma/security/2026-07-13_clause_library_rls.sql and MUST be applied before the code deploy that
-- reads/writes these tables (new tables are fail-closed until granted).

CREATE TABLE "dara_clause_library" (
  "id"            BIGSERIAL PRIMARY KEY,
  "citation_type" TEXT NOT NULL,
  "identifier"    TEXT NOT NULL,
  "title"         TEXT,
  "github_repo"   TEXT NOT NULL,
  "github_path"   TEXT NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "dara_clause_library_citation_type_identifier_key" UNIQUE ("citation_type", "identifier")
);

CREATE TABLE "dara_clause_versions" (
  "id"             BIGSERIAL PRIMARY KEY,
  "clause_id"      BIGINT NOT NULL REFERENCES "dara_clause_library"("id") ON DELETE CASCADE,
  "effective_date" DATE NOT NULL,
  "fac_number"     TEXT,
  "content_hash"   TEXT NOT NULL,
  "plain_text"     TEXT NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "dara_clause_versions_clause_id_effective_date_key" UNIQUE ("clause_id", "effective_date")
);

CREATE INDEX "ix_clause_lib_type" ON "dara_clause_library"("citation_type", "identifier");
CREATE INDEX "ix_clause_ver_date" ON "dara_clause_versions"("effective_date");
CREATE INDEX "ix_clause_ver_clause" ON "dara_clause_versions"("clause_id");
