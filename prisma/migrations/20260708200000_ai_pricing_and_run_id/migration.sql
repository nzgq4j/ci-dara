-- AI run attribution + per-model pricing — the data layer for estimating the cost of each
-- AI run from the usage ledger.
--
--   * dara_ai_usage_log.run_id — groups the N LLM calls of one run (a worker job, a Direct
--     Review) so cost can be summed per run. Nullable; set from the run context established by
--     the worker dispatch. The ledger's existing admin-only RLS policy already covers the new
--     column, so no grant/policy change is needed for it.
--   * dara_ai_model_price — one row per (provider, model) with USD per-1M-token input/output
--     rates, refreshed weekly from a community feed (LiteLLM). source='override' rows are
--     operator-owned and never overwritten by the refresh.
--
-- The NEW table (dara_ai_model_price) is fail-closed for the runtime roles until granted —
-- apply 2026-07-08_ai_model_price_rls.sql BEFORE the code deploy. It is admin-only (written by
-- the weekly cron + admin overrides, read by the usage report), so the tenant role (dara_app)
-- gets NO grant.

-- Run attribution on the ledger.
ALTER TABLE "dara_ai_usage_log" ADD COLUMN "run_id" VARCHAR(120);
CREATE INDEX "dara_ai_usage_log_run_id_idx" ON "dara_ai_usage_log"("run_id");

-- Per-model pricing (USD per 1,000,000 tokens).
CREATE TABLE "dara_ai_model_price" (
    "id" BIGSERIAL NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "input_per_mtok" DOUBLE PRECISION NOT NULL,
    "output_per_mtok" DOUBLE PRECISION NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'feed',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dara_ai_model_price_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dara_ai_model_price_provider_model_key" ON "dara_ai_model_price"("provider", "model");
