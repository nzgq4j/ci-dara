-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "dara_teams" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_team_members" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "team_id" BIGINT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'reviewer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_invitations" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "team_id" BIGINT,
    "email" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'reviewer',
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invited_by_id" UUID,
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dara_teams_company_id_idx" ON "dara_teams"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "dara_teams_company_id_name_key" ON "dara_teams"("company_id", "name");

-- CreateIndex
CREATE INDEX "dara_team_members_company_id_idx" ON "dara_team_members"("company_id");

-- CreateIndex
CREATE INDEX "dara_team_members_team_id_idx" ON "dara_team_members"("team_id");

-- CreateIndex
CREATE INDEX "dara_team_members_user_id_idx" ON "dara_team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dara_team_members_team_id_user_id_key" ON "dara_team_members"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "dara_invitations_company_id_idx" ON "dara_invitations"("company_id");

-- CreateIndex
CREATE INDEX "dara_invitations_email_idx" ON "dara_invitations"("email");

-- AddForeignKey
ALTER TABLE "dara_teams" ADD CONSTRAINT "dara_teams_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_team_members" ADD CONSTRAINT "dara_team_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_team_members" ADD CONSTRAINT "dara_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "dara_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_team_members" ADD CONSTRAINT "dara_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dara_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_invitations" ADD CONSTRAINT "dara_invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_invitations" ADD CONSTRAINT "dara_invitations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "dara_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

