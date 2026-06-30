-- AddColumn
ALTER TABLE "dara_companies" ADD COLUMN "onboarded_at" TIMESTAMP(3);
ALTER TABLE "dara_users" ADD COLUMN "onboarded_at" TIMESTAMP(3);

-- Backfill: treat every existing company/user as already onboarded so only
-- genuinely-new sign-ups are routed through the onboarding wizard / welcome
-- screen. New rows default to NULL (onboarded_at unset) and are gated.
UPDATE "dara_companies" SET "onboarded_at" = "created_at" WHERE "onboarded_at" IS NULL;
UPDATE "dara_users" SET "onboarded_at" = "created_at" WHERE "onboarded_at" IS NULL;
