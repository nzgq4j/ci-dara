-- CreateTable
CREATE TABLE "dara_solicitation_departments" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "solicitation_id" BIGINT NOT NULL,
    "team_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_solicitation_departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dara_solicitation_departments_company_id_idx" ON "dara_solicitation_departments"("company_id");

-- CreateIndex
CREATE INDEX "dara_solicitation_departments_solicitation_id_idx" ON "dara_solicitation_departments"("solicitation_id");

-- CreateIndex
CREATE INDEX "dara_solicitation_departments_team_id_idx" ON "dara_solicitation_departments"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "dara_solicitation_departments_solicitation_id_team_id_key" ON "dara_solicitation_departments"("solicitation_id", "team_id");

-- AddForeignKey
ALTER TABLE "dara_solicitation_departments" ADD CONSTRAINT "dara_solicitation_departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_solicitation_departments" ADD CONSTRAINT "dara_solicitation_departments_solicitation_id_fkey" FOREIGN KEY ("solicitation_id") REFERENCES "dara_solicitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_solicitation_departments" ADD CONSTRAINT "dara_solicitation_departments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "dara_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

