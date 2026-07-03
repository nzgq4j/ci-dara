-- Platform-wide default entitlements (trial limits + feature flags) set by a platform admin,
-- inherited by every company without a per-company override.
-- Column-only add on the singleton settings table — apply with `migrate deploy`; no new RLS.

ALTER TABLE "dara_platform_settings" ADD COLUMN "default_entitlements" JSONB;
