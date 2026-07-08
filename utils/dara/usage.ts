import { prismaAdmin } from '@/utils/prisma';
import type { AICapability } from '@prisma/client';

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
        ok: entry.ok ?? true
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
}

export interface UsageByModelRow {
  companyId: bigint | null;
  companyName: string;
  provider: string;
  model: string;
  calls: number;
  tokenIn: number;
  tokenOut: number;
}

export interface UsageByCapabilityRow {
  capability: AICapability;
  calls: number;
  tokenIn: number;
  tokenOut: number;
}

export interface UsageReport {
  since: Date;
  days: number;
  totals: UsageTotals;
  byModel: UsageByModelRow[];
  byCapability: UsageByCapabilityRow[];
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

/**
 * Build the admin AI-usage report over the last `days` (0 = today). Groups the ledger by
 * company+provider+model and by capability, and rolls up platform totals. Admin-only.
 */
export async function getUsageReport(days: number, now: Date): Promise<UsageReport> {
  const since = windowStart(days, now);
  const where = { createdAt: { gte: since } };

  const [totalAgg, failures, byModelGroups, byCapGroups] = await Promise.all([
    prismaAdmin.aiUsageLog.aggregate({
      where,
      _count: { _all: true },
      _sum: { tokenIn: true, tokenOut: true }
    }),
    prismaAdmin.aiUsageLog.count({ where: { ...where, ok: false } }),
    prismaAdmin.aiUsageLog.groupBy({
      by: ['companyId', 'provider', 'model'],
      where,
      _count: { _all: true },
      _sum: { tokenIn: true, tokenOut: true }
    }),
    prismaAdmin.aiUsageLog.groupBy({
      by: ['capability'],
      where,
      _count: { _all: true },
      _sum: { tokenIn: true, tokenOut: true }
    })
  ]);

  // Resolve company names for the grouped rows in one query (the ledger has no relation).
  const companyIds = Array.from(
    new Set(byModelGroups.map((g) => g.companyId).filter((id): id is bigint => id != null))
  );
  const companies = companyIds.length
    ? await prismaAdmin.company.findMany({
        where: { id: { in: companyIds } },
        select: { id: true, name: true }
      })
    : [];
  const nameById = new Map(companies.map((c) => [c.id.toString(), c.name]));

  const byModel: UsageByModelRow[] = byModelGroups
    .map((g) => ({
      companyId: g.companyId,
      companyName:
        g.companyId == null ? '— (no company)' : nameById.get(g.companyId.toString()) ?? `#${g.companyId}`,
      provider: g.provider,
      model: g.model,
      calls: g._count._all,
      tokenIn: g._sum.tokenIn ?? 0,
      tokenOut: g._sum.tokenOut ?? 0
    }))
    .sort((a, b) => b.tokenIn + b.tokenOut - (a.tokenIn + a.tokenOut));

  const byCapability: UsageByCapabilityRow[] = byCapGroups
    .map((g) => ({
      capability: g.capability,
      calls: g._count._all,
      tokenIn: g._sum.tokenIn ?? 0,
      tokenOut: g._sum.tokenOut ?? 0
    }))
    .sort((a, b) => b.tokenIn + b.tokenOut - (a.tokenIn + a.tokenOut));

  return {
    since,
    days,
    totals: {
      calls: totalAgg._count._all,
      tokenIn: totalAgg._sum.tokenIn ?? 0,
      tokenOut: totalAgg._sum.tokenOut ?? 0,
      failures
    },
    byModel,
    byCapability
  };
}
