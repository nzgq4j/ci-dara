import { prismaAdmin } from '@/utils/prisma';

// Per-model token pricing → cost estimates for the AI usage ledger.
//
// Rates are stored in dara_ai_model_price as USD per 1,000,000 tokens, keyed by the same bare
// provider/model strings the ledger records, so cost is an exact (provider, model) lookup. The
// weekly cron refreshes 'feed' rows from a community pricing feed (LiteLLM); an operator can
// pin any model with an 'override' row that the refresh never touches. Everything here runs
// through prismaAdmin (dara_admin) — the table is admin-only, like the ledger itself.

// LiteLLM's model_prices JSON: bare model keys (e.g. "claude-sonnet-4-6") → per-TOKEN costs +
// a litellm_provider tag. Overridable via env for air-gapped/self-hosted mirrors.
const FEED_URL =
  process.env.AI_PRICING_FEED_URL ??
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// Map the feed's provider tags onto the three direct APIs we call. Bedrock/Azure/etc. entries
// (same model, different plumbing) are intentionally dropped — we never dispatch through them.
const FEED_PROVIDER: Record<string, 'anthropic' | 'openai' | 'google'> = {
  anthropic: 'anthropic',
  openai: 'openai',
  'text-completion-openai': 'openai',
  gemini: 'google',
  google: 'google',
  vertex_ai: 'google',
  'vertex_ai-language-models': 'google'
};

export interface PriceRates {
  inputPerMtok: number;
  outputPerMtok: number;
}

/** provider:model → rates. */
export type PricingMap = Map<string, PriceRates>;

const key = (provider: string, model: string) => `${provider}:${model}`;

/** Read the full price table into a lookup map. Fail-safe: on error costs show as unpriced. */
export async function getPricingMap(): Promise<PricingMap> {
  try {
    const rows = await prismaAdmin.aiModelPrice.findMany({
      select: { provider: true, model: true, inputPerMtok: true, outputPerMtok: true }
    });
    const map: PricingMap = new Map();
    for (const r of rows) {
      map.set(key(r.provider, r.model), { inputPerMtok: r.inputPerMtok, outputPerMtok: r.outputPerMtok });
    }
    return map;
  } catch (e) {
    console.error('[pricing] read failed; costs will show as unpriced:', e);
    return new Map();
  }
}

/** Estimated USD for a token count, or null when no price is on file for provider/model. */
export function costOf(
  map: PricingMap,
  provider: string,
  model: string,
  tokenIn: number,
  tokenOut: number
): number | null {
  const p = map.get(key(provider, model));
  if (!p) return null;
  return (tokenIn / 1_000_000) * p.inputPerMtok + (tokenOut / 1_000_000) * p.outputPerMtok;
}

// ── Weekly refresh ────────────────────────────────────────────────────────────

interface ParsedRate {
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
}

/** Parse the LiteLLM feed into per-Mtok rates for the three providers we use. */
function parseFeed(raw: unknown): Map<string, ParsedRate> {
  const out = new Map<string, ParsedRate>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [rawModel, v] of Object.entries(raw as Record<string, any>)) {
    if (rawModel === 'sample_spec' || !v || typeof v !== 'object') continue;
    const provider = FEED_PROVIDER[v.litellm_provider];
    if (!provider) continue;
    const inC = Number(v.input_cost_per_token);
    const outC = Number(v.output_cost_per_token);
    if (!Number.isFinite(inC) || !Number.isFinite(outC) || inC < 0 || outC < 0) continue;
    // Feed keys are usually bare, but some carry a "provider/" prefix — normalize to the bare
    // model id we actually send to the API (and record in the ledger).
    const model = rawModel.includes('/') ? rawModel.slice(rawModel.lastIndexOf('/') + 1) : rawModel;
    const k = key(provider, model);
    if (out.has(k)) continue; // first definition wins (canonical over regional dupes)
    out.set(k, { provider, model, inputPerMtok: inC * 1_000_000, outputPerMtok: outC * 1_000_000 });
  }
  return out;
}

export interface RefreshResult {
  fetched: number;
  stored: number;
  skippedOverride: number;
  error?: string;
}

/**
 * Refresh 'feed' price rows from the pricing feed. Operator 'override' rows are left untouched
 * (both skipped from the incoming set and preserved in the table). Never throws — returns an
 * error string so the cron/admin caller can surface it.
 */
export async function refreshPricing(): Promise<RefreshResult> {
  let raw: unknown;
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { fetched: 0, stored: 0, skippedOverride: 0, error: `feed HTTP ${res.status}` };
    raw = await res.json();
  } catch (e) {
    return { fetched: 0, stored: 0, skippedOverride: 0, error: e instanceof Error ? e.message : 'feed fetch failed' };
  }

  const parsed = parseFeed(raw);
  if (parsed.size === 0) {
    return { fetched: 0, stored: 0, skippedOverride: 0, error: 'feed had no usable rates (shape changed?)' };
  }

  try {
    const overrides = await prismaAdmin.aiModelPrice.findMany({
      where: { source: 'override' },
      select: { provider: true, model: true }
    });
    const overrideKeys = new Set(overrides.map((o) => key(o.provider, o.model)));
    const now = new Date();
    const rows = Array.from(parsed.values())
      .filter((r) => !overrideKeys.has(key(r.provider, r.model)))
      .map((r) => ({ ...r, source: 'feed', updatedAt: now }));

    // Replace the feed rows wholesale; overrides survive (never deleted, excluded above).
    await prismaAdmin.$transaction([
      prismaAdmin.aiModelPrice.deleteMany({ where: { source: 'feed' } }),
      prismaAdmin.aiModelPrice.createMany({ data: rows, skipDuplicates: true })
    ]);
    return { fetched: parsed.size, stored: rows.length, skippedOverride: parsed.size - rows.length };
  } catch (e) {
    return { fetched: parsed.size, stored: 0, skippedOverride: 0, error: e instanceof Error ? e.message : 'db write failed' };
  }
}

// ── Admin management ──────────────────────────────────────────────────────────

export interface PricingRow {
  provider: string;
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  source: string;
  updatedAt: Date;
}

/** Full price table for the admin UI (provider, then model). */
export async function listPricing(): Promise<PricingRow[]> {
  const rows = await prismaAdmin.aiModelPrice.findMany({
    orderBy: [{ provider: 'asc' }, { model: 'asc' }]
  });
  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    inputPerMtok: r.inputPerMtok,
    outputPerMtok: r.outputPerMtok,
    source: r.source,
    updatedAt: r.updatedAt
  }));
}

/** When the feed was last refreshed (max updatedAt over feed rows), or null if never. */
export async function pricingLastRefreshed(): Promise<Date | null> {
  const r = await prismaAdmin.aiModelPrice.aggregate({
    where: { source: 'feed' },
    _max: { updatedAt: true }
  });
  return r._max.updatedAt ?? null;
}

/** Pin a provider/model rate as an operator override (immune to the weekly refresh). */
export async function setPriceOverride(
  provider: string,
  model: string,
  inputPerMtok: number,
  outputPerMtok: number
): Promise<void> {
  const p = provider.slice(0, 50);
  const m = model.slice(0, 100);
  const inR = Math.max(0, inputPerMtok);
  const outR = Math.max(0, outputPerMtok);
  await prismaAdmin.aiModelPrice.upsert({
    where: { provider_model: { provider: p, model: m } },
    create: { provider: p, model: m, inputPerMtok: inR, outputPerMtok: outR, source: 'override' },
    update: { inputPerMtok: inR, outputPerMtok: outR, source: 'override' }
  });
}

/** Remove a price row (e.g. a stale override); the next refresh may repopulate it from feed. */
export async function deletePrice(provider: string, model: string): Promise<void> {
  await prismaAdmin.aiModelPrice.deleteMany({ where: { provider, model } });
}
