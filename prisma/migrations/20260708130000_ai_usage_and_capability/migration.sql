-- AI usage ledger + per-capability model overrides — the data-layer foundation for the
-- admin AI-usage report and per-capability model configuration.
--
-- Two additions, both driven by the AICapability enum (one value per AI-consuming code
-- path — shred, compliance sweep, review pass, direct review, amendment diff, evaluation):
--
--   * dara_ai_usage_log — append-only ledger, one row per LLM call (company, provider,
--     model, capability, token_in, token_out, ok, created_at). Like dara_audit_log it has
--     NO company FK/cascade on purpose: the ledger must survive company deletion for
--     platform-usage/billing reporting. company_id is nullable.
--   * dara_platform_settings.capability_models — JSONB map AICapability -> {provider,model}.
--     When set, companies in 'platform' AI mode use that provider/model for that capability
--     instead of the central active_provider/active_model.
--
-- The NEW table (dara_ai_usage_log) is fail-closed for the runtime roles until granted —
-- apply 2026-07-08_ai_usage_log_rls.sql BEFORE the code deploy. It is admin-only (written
-- and read only via the privileged client), so the tenant role (dara_app) gets NO grant.

-- Enum: the distinct AI-consuming capabilities.
CREATE TYPE "AICapability" AS ENUM (
    'shred',
    'compliance_sweep',
    'review_pass',
    'direct_review',
    'amendment_diff',
    'evaluation',
    'annotated_export'
);

-- Append-only AI usage ledger.
CREATE TABLE "dara_ai_usage_log" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT,
    "provider" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "capability" "AICapability" NOT NULL,
    "token_in" INTEGER NOT NULL DEFAULT 0,
    "token_out" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dara_ai_usage_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dara_ai_usage_log_created_at_idx" ON "dara_ai_usage_log"("created_at");
CREATE INDEX "dara_ai_usage_log_company_id_created_at_idx" ON "dara_ai_usage_log"("company_id", "created_at");
CREATE INDEX "dara_ai_usage_log_capability_idx" ON "dara_ai_usage_log"("capability");

-- Per-capability model overrides on the platform-settings singleton.
ALTER TABLE "dara_platform_settings" ADD COLUMN "capability_models" JSONB;
