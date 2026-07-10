-- HRLR (Hierarchical Requirement Logic Resolution) — semantic bundle for shredded requirements.
-- Additive, nullable. Table-level grants on dara_requirements already extend to new columns, so no
-- paired RLS file is required (same pattern as prior additive-column migrations).
ALTER TABLE "dara_requirements" ADD COLUMN "hrlr" JSONB;
