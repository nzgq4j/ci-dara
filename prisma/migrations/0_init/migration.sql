-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('trial', 'starter', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('active', 'past_due', 'canceled', 'trialing');

-- CreateEnum
CREATE TYPE "AIKeyMode" AS ENUM ('platform', 'byok');

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('anthropic', 'openai', 'google');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('company_admin', 'dept_admin', 'manager', 'reviewer');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('pending', 'processing', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('pending', 'running', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('evaluate', 'extract', 'generate_matrix');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "dara_companies" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'trial',
    "plan_status" "PlanStatus" NOT NULL DEFAULT 'trialing',
    "trial_ends_at" TIMESTAMP(3),
    "stripe_customer_id" VARCHAR(100),
    "stripe_sub_id" VARCHAR(100),
    "ai_key_mode" "AIKeyMode" NOT NULL DEFAULT 'platform',
    "active_provider" "AIProvider" NOT NULL DEFAULT 'anthropic',
    "active_model" VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-6',
    "anthropic_key_enc" TEXT,
    "openai_key_enc" TEXT,
    "google_key_enc" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_users" (
    "id" UUID NOT NULL,
    "company_id" BIGINT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL DEFAULT '',
    "role" "UserRole" NOT NULL DEFAULT 'company_admin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_solicitations" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "sol_number" VARCHAR(100) NOT NULL DEFAULT '',
    "agency" VARCHAR(255) NOT NULL DEFAULT '',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_solicitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_sol_documents" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "solicitation_id" BIGINT NOT NULL,
    "original_filename" VARCHAR(500) NOT NULL,
    "stored_filename" VARCHAR(500) NOT NULL,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "extraction_status" "ExtractionStatus" NOT NULL DEFAULT 'pending',
    "extracted_text" TEXT,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_sol_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_criteria" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "solicitation_id" BIGINT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "criterion_type" VARCHAR(50) NOT NULL DEFAULT 'scored_factor',
    "far_reference" VARCHAR(100) NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dara_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_personas" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "icon" VARCHAR(16),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_responses" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "solicitation_id" BIGINT NOT NULL,
    "offeror_name" VARCHAR(300) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_response_files" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "response_id" BIGINT NOT NULL,
    "original_filename" VARCHAR(500) NOT NULL,
    "stored_filename" VARCHAR(500) NOT NULL,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "extraction_status" "ExtractionStatus" NOT NULL DEFAULT 'pending',
    "extracted_text" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_response_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_evaluations" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "solicitation_id" BIGINT NOT NULL,
    "response_id" BIGINT NOT NULL,
    "persona_id" BIGINT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'pending',
    "error_message" VARCHAR(500),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_results" (
    "id" BIGSERIAL NOT NULL,
    "evaluation_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "criterion_id" BIGINT NOT NULL,
    "persona_id" BIGINT NOT NULL,
    "ai_determination" VARCHAR(50),
    "ai_score" DECIMAL(5,2),
    "ai_rationale" TEXT,
    "ai_confidence" DECIMAL(5,4),
    "ai_strengths" JSONB,
    "ai_weaknesses" JSONB,
    "model_id" VARCHAR(100),
    "token_in" INTEGER NOT NULL DEFAULT 0,
    "token_out" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_job_queue" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "job_type" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dara_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT,
    "actor_id" UUID,
    "actor_email" VARCHAR(255) NOT NULL DEFAULT '',
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL DEFAULT '',
    "entity_id" VARCHAR(100),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dara_companies_slug_key" ON "dara_companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "dara_companies_stripe_sub_id_key" ON "dara_companies"("stripe_sub_id");

-- CreateIndex
CREATE INDEX "dara_companies_plan_plan_status_idx" ON "dara_companies"("plan", "plan_status");

-- CreateIndex
CREATE UNIQUE INDEX "dara_users_email_key" ON "dara_users"("email");

-- CreateIndex
CREATE INDEX "dara_users_company_id_idx" ON "dara_users"("company_id");

-- CreateIndex
CREATE INDEX "dara_solicitations_company_id_idx" ON "dara_solicitations"("company_id");

-- CreateIndex
CREATE INDEX "dara_sol_documents_solicitation_id_idx" ON "dara_sol_documents"("solicitation_id");

-- CreateIndex
CREATE INDEX "dara_sol_documents_company_id_idx" ON "dara_sol_documents"("company_id");

-- CreateIndex
CREATE INDEX "dara_criteria_solicitation_id_idx" ON "dara_criteria"("solicitation_id");

-- CreateIndex
CREATE INDEX "dara_criteria_company_id_idx" ON "dara_criteria"("company_id");

-- CreateIndex
CREATE INDEX "dara_personas_company_id_is_active_idx" ON "dara_personas"("company_id", "is_active");

-- CreateIndex
CREATE INDEX "dara_responses_solicitation_id_idx" ON "dara_responses"("solicitation_id");

-- CreateIndex
CREATE INDEX "dara_responses_company_id_idx" ON "dara_responses"("company_id");

-- CreateIndex
CREATE INDEX "dara_response_files_response_id_idx" ON "dara_response_files"("response_id");

-- CreateIndex
CREATE INDEX "dara_response_files_company_id_idx" ON "dara_response_files"("company_id");

-- CreateIndex
CREATE INDEX "dara_evaluations_company_id_idx" ON "dara_evaluations"("company_id");

-- CreateIndex
CREATE INDEX "dara_evaluations_solicitation_id_idx" ON "dara_evaluations"("solicitation_id");

-- CreateIndex
CREATE INDEX "dara_evaluations_status_idx" ON "dara_evaluations"("status");

-- CreateIndex
CREATE INDEX "dara_results_company_id_idx" ON "dara_results"("company_id");

-- CreateIndex
CREATE INDEX "dara_results_evaluation_id_idx" ON "dara_results"("evaluation_id");

-- CreateIndex
CREATE UNIQUE INDEX "dara_results_evaluation_id_criterion_id_persona_id_key" ON "dara_results"("evaluation_id", "criterion_id", "persona_id");

-- CreateIndex
CREATE INDEX "dara_job_queue_status_available_at_idx" ON "dara_job_queue"("status", "available_at");

-- CreateIndex
CREATE INDEX "dara_job_queue_company_id_idx" ON "dara_job_queue"("company_id");

-- CreateIndex
CREATE INDEX "dara_audit_log_company_id_created_at_idx" ON "dara_audit_log"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "dara_audit_log_action_idx" ON "dara_audit_log"("action");

-- AddForeignKey
ALTER TABLE "dara_users" ADD CONSTRAINT "dara_users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_solicitations" ADD CONSTRAINT "dara_solicitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_sol_documents" ADD CONSTRAINT "dara_sol_documents_solicitation_id_fkey" FOREIGN KEY ("solicitation_id") REFERENCES "dara_solicitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_criteria" ADD CONSTRAINT "dara_criteria_solicitation_id_fkey" FOREIGN KEY ("solicitation_id") REFERENCES "dara_solicitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_personas" ADD CONSTRAINT "dara_personas_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_responses" ADD CONSTRAINT "dara_responses_solicitation_id_fkey" FOREIGN KEY ("solicitation_id") REFERENCES "dara_solicitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_response_files" ADD CONSTRAINT "dara_response_files_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "dara_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_evaluations" ADD CONSTRAINT "dara_evaluations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_evaluations" ADD CONSTRAINT "dara_evaluations_solicitation_id_fkey" FOREIGN KEY ("solicitation_id") REFERENCES "dara_solicitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_evaluations" ADD CONSTRAINT "dara_evaluations_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "dara_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_results" ADD CONSTRAINT "dara_results_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "dara_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_results" ADD CONSTRAINT "dara_results_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_results" ADD CONSTRAINT "dara_results_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "dara_criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_results" ADD CONSTRAINT "dara_results_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "dara_personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dara_job_queue" ADD CONSTRAINT "dara_job_queue_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "dara_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

