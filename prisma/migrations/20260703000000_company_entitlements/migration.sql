-- Per-company entitlements (platform-admin managed): trial usage-limit overrides +
-- feature capability flags, stored as one JSONB blob. Null = all defaults.
-- Column-only add on an already-granted table — apply with `migrate deploy`; no new RLS.

ALTER TABLE "dara_companies" ADD COLUMN "entitlements" JSONB;
