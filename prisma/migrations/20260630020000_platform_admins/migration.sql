-- Application (platform) admins — company-less operator accounts. Accessed only via
-- the dara_admin runtime role; RLS/grants are applied separately as owner in
-- prisma/security/2026-06-30_platform_admins_rls.sql (the tenant role gets nothing).
CREATE TABLE "dara_platform_admins" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "user_id" UUID,
    "added_by" VARCHAR(255),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dara_platform_admins_email_key" ON "dara_platform_admins"("email");
