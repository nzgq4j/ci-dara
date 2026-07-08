import { prismaAdmin } from '@/utils/prisma';
import type { AICapability } from '@prisma/client';
import { currentRunId } from '@/utils/dara/run-context';
import { getPricingMap, costOf, type PricingMap } from '@/utils/dara/pricing';

// AI usage ledger — one row per LLM call, written from every complete() call site so the
// Application Admin console can report platform-wide token consumption by company, provider,
// model, and capability.
//
// The ledger table (dara_ai_usage_log) is admin-only and fail-closed for the tenant role, so
// it is read/written exclusively through prismaAdmin. Like recordAudit(), logUsage() is
// best-effort: a failed ledger write is logged but must never break the user action that
// triggered the AI call.

export type { AICapability };

export interface UsageEntry {
  capability: AICapability;
  provider: string;
  model: string;
  companyId?: bigint | null;
  tokenIn?: number;
  tokenOut?: number;
  /** false when the underlying complete() call threw — records attempts that failed. */
  ok?: boolean;
  /** Overrides the ambient run context; usually left unset so currentRunId() supplies it. */
  runId?: string | null;
}

/** Record one LLM call in the usage ledger. Never throws into the caller. */
export async function logUsage(entry: UsageEntry): Promise<void> {
  try {
    await prismaAdmin.aiUsageLog.create({
      data: {
        companyId: entry.companyId ?? null,
        provider: entry.provider.slice(0, 50),
        model: entry.model.slice(0, 100),
        capability: entry.capability,
        tokenIn: Math.max(0, Math.round(entry.tokenIn ?? 0)),
        tokenOut: Math.max(0, Math.round(entry.tokenOut ?? 0)),
        ok: entry.ok ?? true,
        runId: (entry.runId ?? currentRunId())?.slice(0, 120) ?? null
      }
    });
  } catch (e) {
    console.error(`[usage] failed to record ${entry.capability} call:`, e);
  }
}

// ── Reporting (Application Admin → AI usage) ──────────────────────────────────

export interface UsageTotals {
  calls: number;
  tokenIn: number;
  tokenOut: number;
  failures: number;
  /** Estimated USD across all priced rows. Rows with no matching price contribute 0. */
  cost: number;
  /** true when some usage had no matching price row (so `cost` understates the real spend). */
  hasUnpriced: boolean;
}

export interface UsageByModelRow {
  companyId: bigint | null;
  companyName: string;
  provider: string;
  model: string;
  calls: number;
  tokenIn: number;
  tokenOut: number;
  cost: number | null; // null = no price on file for this provider/model
}

export interface UsageByCapabilityRow {
  capability: AICapability;
  calls: number;
  tokenIn: number;
  tokenOut: number;
  cost: number;
}

export interface UsageByRunRow {
  runId: string;
  companyId: bigint | null;
  companyName: string;
  capabilities: AICapability[];
  calls: number;
  tokenIn: number;
  tokenOut: number;
  cost: number;
}

export interface UsageReport {
  since: Date;
  days: number;
  totals: UsageTotals;
  byModel: UsageByModelRow[];
  byCapability: UsageByCapabilityRow[];
  byRun: UsageByRunRow[];
  /** Distinct (provider, model) seen in usage but with no price row — surfaced for overrides. */
  unpricedModels: { provider: string; model: string }[];
}

/** Clamp an arbitrary ?days value to a supported range (0 = today only). */
export function normalizeUsageDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 7;
  if (n <= 0) return 0;
  if (n >= 30) return 30;
  return n >= 7 ? 7 : 1;
}

function windowStart(days: number, now: Date): Date {
  const d = new Date(now);
  if (days <= 0) {
    d.setHours(0, 0, 0, 0); // today, local midnight
    return d;
  }
  d.setDate(d.getDate() - days);
  return d;
}

/** Max runs shown in the per-run cost breakdown (highest-cost first). */
const RUN_LIMIT = 25;

const nameFor = (id: bigint | null, byId: Map<string, string>): string =>
  id == null ? '— (no company)' : byId.get(id.toString()) ?? `#${id}`;

/**
 * Build the admin AI-usage report over the last `days` (0 = today). Rolls the ledger up by
 * capability, by company+provider+model, and by run, attaching an estimated USD cost from the
 * per-model price table (tokens × rate). Admin-only.
 */
export async function getUsageReport(days: number, now: Date): Promise<UsageReport> {
  const since = windowStart(days, now);
  const where = { createdAt: { gte: since } };

  // One fine-grained groupBy carries provider+model (needed for cost) alongside company and
  // capability; byModel/byCapability/totals are all rolled up from it so they never disagree.
  const [grid, failures, runGroups, pricing] = await Promise.all([
    prismaAdmin.aiUsageLog.groupBy({
      by: ['companyId', 'provider', 'model', 'capability'],
      where,
      _count: { _all: true },
      _sum: { tokenIn: true, tokenOut: true }
    }),
    prismaAdmin.aiUsageLog.count({ where: { ...where, ok: false } }),
    prismaAdmin.aiUsageLog.groupBy({
      by: ['runId', 'companyId', 'provider', 'model', 'capability'],
      where: { ...where, runId: { not: null } },
      _count: { _all: true },
      _sum: { tokenIn: true, tokenOut: true }
    }),
    getPricingMap()
  ]);

  // Resolve company names in one query (the ledger has no relation).
  const companyIds = Array.from(
    new Set(
      [...grid, ...runGroups].map((g) => g.companyId).filter((id): id is bigint => id != null)
    )
  );
  const companies = companyIds.length
    ? await prismaAdmin.company.findMany({
        where: { id: { in: companyIds } },
        select: { id: true, name: true }
      })
    : [];
  const nameById = new Map(companies.map((c) => [c.id.toString(), c.name]));

  // ── Totals + by-model + by-capability, all from `grid` ──
  const modelAcc = new Map<string, UsageByModelRow>();
  const capAcc = new Map<AICapability, UsageByCapabilityRow>();
  const unpriced = new Map<string, { provider: string; model: string }>();
  let totalCalls = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  let hasUnpriced = false;

  for (const g of grid) {
    const calls = g._count._all;
    const tIn = g._sum.tokenIn ?? 0;
    const tOut = g._sum.tokenOut ?? 0;
    const c = costOf(pricing, g.provider, g.model, tIn, tOut);
    totalCalls += calls;
    totalIn += tIn;
    totalOut += tOut;
    totalCost += c ?? 0;
    if (c == null && tIn + tOut > 0) {
      hasUnpriced = true;
      unpriced.set(`${g.provider}:${g.model}`, { provider: g.provider, model: g.model });
    }

    const mKey = `${g.companyId ?? ''}|${g.provider}|${g.model}`;
    const m = modelAcc.get(mKey);
    if (m) {
      m.calls += calls;
      m.tokenIn += tIn;
      m.tokenOut += tOut;
      m.cost = m.cost == null && c == null ? null : (m.cost ?? 0) + (c ?? 0);
    } else {
      modelAcc.set(mKey, {
        companyId: g.companyId,
        companyName: nameFor(g.companyId, nameById),
        provider: g.provider,
        model: g.model,
        calls,
        tokenIn: tIn,
        tokenOut: tOut,
        cost: c
      });
    }

    const cap = capAcc.get(g.capability);
    if (cap) {
      cap.calls += calls;
      cap.tokenIn += tIn;
      cap.tokenOut += tOut;
      cap.cost += c ?? 0;
    } else {
      capAcc.set(g.capability, {
        capability: g.capability,
        calls,
        tokenIn: tIn,
        tokenOut: tOut,
        cost: c ?? 0
      });
    }
  }

  const byModel = Array.from(modelAcc.values()).sort((a, b) => b.tokenIn + b.tokenOut - (a.tokenIn + a.tokenOut));
  const byCapability = Array.from(capAcc.values()).sort((a, b) => b.cost - a.cost || b.tokenIn + b.tokenOut - (a.tokenIn + a.tokenOut));

  // ── Per-run cost (top RUN_LIMIT by cost) ──
  const runAcc = new Map<string, UsageByRunRow & { _caps: Set<AICapability> }>();
  for (const g of runGroups) {
    const runId = g.runId as string; // where filters null out
    const tIn = g._sum.tokenIn ?? 0;
    const tOut = g._sum.tokenOut ?? 0;
    const c = costOf(pricing, g.provider, g.model, tIn, tOut) ?? 0;
    const r = runAcc.get(runId);
    if (r) {
      r.calls += g._count._all;
      r.tokenIn += tIn;
      r.tokenOut += tOut;
      r.cost += c;
      r._caps.add(g.capability);
    } else {
      runAcc.set(runId, {
        runId,
        companyId: g.companyId,
        companyName: nameFor(g.companyId, nameById),
        capabilities: [],
        calls: g._count._all,
        tokenIn: tIn,
        tokenOut: tOut,
        cost: c,
        _caps: new Set([g.capability])
      });
    }
  }
  const byRun: UsageByRunRow[] = Array.from(runAcc.values())
    .map(({ _caps, ...r }) => ({ ...r, capabilities: Array.from(_caps) }))
    .sort((a, b) => b.cost - a.cost || b.tokenIn + b.tokenOut - (a.tokenIn + a.tokenOut))
    .slice(0, RUN_LIMIT);

  return {
    since,
    days,
    totals: {
      calls: totalCalls,
      tokenIn: totalIn,
      tokenOut: totalOut,
      failures,
      cost: totalCost,
      hasUnpriced
    },
    byModel,
    byCapability,
    byRun,
    unpricedModels: Array.from(unpriced.values())
  };
}
