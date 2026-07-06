-- DARA-031 (MFA): per-user two-factor state on dara_users.
-- The TOTP secret/factor itself lives in Supabase Auth (auth.mfa_factors) and is NOT
-- stored here. mfa_enabled mirrors "has a verified TOTP factor" for cheap status/audit;
-- mfa_backup_codes holds bcrypt hashes of single-use recovery codes.
-- Additive + defaulted → safe online ALTER, no backfill. Existing table already carries
-- per-tenant RLS + grants (DARA-004), which cover new columns automatically — no paired
-- security SQL needed.
-- AlterTable
ALTER TABLE "dara_users" ADD COLUMN     "mfa_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
