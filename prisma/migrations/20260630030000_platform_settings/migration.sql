-- Singleton platform AI configuration (keys + provider/model). Accessed only via
-- the dara_admin runtime role; RLS/grants applied as owner in
-- prisma/security/2026-06-30_platform_settings_rls.sql.
CREATE TABLE "dara_platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active_provider" "AIProvider" NOT NULL DEFAULT 'anthropic',
    "active_model" VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-6',
    "anthropic_key_enc" TEXT,
    "openai_key_enc" TEXT,
    "google_key_enc" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_platform_settings_pkey" PRIMARY KEY ("id")
);
