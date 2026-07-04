// utils/dara/trial.ts
// Per-company entitlements: trial usage limits + feature capability flags.
//
// Two independent gates, both configurable per company by a platform admin
// (/app/admin → Accounts), stored in the Company.entitlements JSON column:
//
//   1. requireTrialCapacity() — throws TrialLimitError when a company on the *trial*
//      plan has exhausted a metered resource (solicitations / review runs / seats).
//      Paid plans are never metered. Limits fall back to DEFAULT_TRIAL_LIMITS.
//   2. requireFeature() — throws FeatureDisabledError when a capability has been
//      switched OFF for the company, regardless of plan. Features default to ON.
//
// Read/export operations are never gated — only creation actions and feature entry
// points (wired in a later step). Use withTenant for all Prisma reads (DARA-004).

import { withTenant, prismaAdmin } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';

const PLATFORM_SETTINGS_ID = 1;

// ---- Metered trial resources ----
export type TrialResource = 'solicitation' | 'review_run' | 'seat';

export const DEFAULT_TRIAL_LIMITS: Record<TrialResource, number> = {
  solicitation: 2,
  review_run: 3,
  seat: 2
};

export const TRIAL_RESOURCES: TrialResource[] = ['solicitation', 'review_run', 'seat'];

// ---- Gateable feature capabilities ----
export type FeatureFlag = 'amendments' | 'personas' | 'team';

export const FEATURE_FLAGS: FeatureFlag[] = ['amendments', 'personas', 'team'];

// Human labels for the admin UI.
export const FEATURE_LABELS: Record<FeatureFlag, string> = {
  amendments: 'Amendments + AI reconcile',
  personas: 'Reviewer personas',
  team: 'Team / departments'
};

// Code-level default: features ON, standard trial limits. This is the ultimate fallback,
// overridden by the platform-wide default (set in /app/admin) and then by any per-company
// override. Nothing is fenced unless a platform admin turns it off.
const DEFAULT_FEATURES: Record<FeatureFlag, boolean> = {
  amendments: true,
  personas: true,
  team: true
};

export interface Entitlements {
  limits: Record<TrialResource, number>;
  features: Record<FeatureFlag, boolean>;
}

// The built-in baseline. Resolution chain: CODE_DEFAULTS → platform default → per-company.
export const CODE_DEFAULT_ENTITLEMENTS: Entitlements = {
  limits: { ...DEFAULT_TRIAL_LIMITS },
  features: { ...DEFAULT_FEATURES }
};

// ---- Errors ----
export class TrialLimitError extends Error {
  constructor(
    public readonly resource: TrialResource,
    public readonly used: number,
    public readonly limit: number
  ) {
    super(`Trial limit reached: ${used} of ${limit} ${resource}s used`);
    this.name = 'TrialLimitError';
  }
}

export class FeatureDisabledError extends Error {
  constructor(public readonly feature: FeatureFlag) {
    super(`Feature disabled for this account: ${feature}`);
    this.name = 'FeatureDisabledError';
  }
}

// ---- Entitlement resolution (raw JSON → typed, with defaults) ----

/**
 * Resolve an entitlements JSON blob (possibly null / partial / malformed) into a complete
 * Entitlements object, layered over `base`. Missing keys inherit `base`; limits are clamped
 * to non-negative integers. `base` is the code default unless a caller passes the
 * platform-wide default (so per-company overrides layer over platform defaults).
 */
export function resolveEntitlements(raw: unknown, base: Entitlements = CODE_DEFAULT_ENTITLEMENTS): Entitlements {
  const obj = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) ?? {};
  const rawLimits = (obj.limits && typeof obj.limits === 'object' ? (obj.limits as Record<string, unknown>) : {}) ?? {};
  const rawFeatures = (obj.features && typeof obj.features === 'object' ? (obj.features as Record<string, unknown>) : {}) ?? {};

  const limits = { ...base.limits };
  for (const r of TRIAL_RESOURCES) {
    const v = rawLimits[r];
    if (v != null && Number.isFinite(Number(v))) {
      limits[r] = Math.max(0, Math.floor(Number(v)));
    }
  }

  const features = { ...base.features };
  for (const f of FEATURE_FLAGS) {
    const v = rawFeatures[f];
    if (typeof v === 'boolean') features[f] = v;
  }

  return { limits, features };
}

/** Build a normalized entitlements JSON value to store (used by the admin setters). */
export function buildEntitlements(limits: Record<TrialResource, number>, features: Record<FeatureFlag, boolean>): Entitlements {
  return resolveEntitlements({ limits, features });
}

/** Synchronous feature check against an already-loaded entitlements value + base defaults. */
export function hasFeature(rawEntitlements: unknown, feature: FeatureFlag, base: Entitlements = CODE_DEFAULT_ENTITLEMENTS): boolean {
  return resolveEntitlements(rawEntitlements, base).features[feature];
}

// ---- Platform-wide default gating (the singleton default every company inherits) ----

/** The platform default entitlements (admin-set in /app/admin), layered over code defaults. */
export async function getPlatformDefaultEntitlements(): Promise<Entitlements> {
  const row = await prismaAdmin.platformSetting.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
    select: { defaultEntitlements: true }
  });
  return resolveEntitlements(row?.defaultEntitlements, CODE_DEFAULT_ENTITLEMENTS);
}

/** Set the platform-wide default gating (limits + features). Applies to every company that
 * has no per-company override. */
export async function setPlatformDefaultEntitlements(
  limits: Record<TrialResource, number>,
  features: Record<FeatureFlag, boolean>
): Promise<void> {
  const value = buildEntitlements(limits, features);
  await prismaAdmin.platformSetting.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    create: { id: PLATFORM_SETTINGS_ID, defaultEntitlements: value as object },
    update: { defaultEntitlements: value as object }
  });
}

// ---- Enforcement ----

/**
 * Throw TrialLimitError if `companyId` is on the trial plan and has exhausted `resource`.
 * No-op for paid plans. Also throws (used=limit=0) when the trial window has expired — the
 * caller redirects to billing.
 */
export async function requireTrialCapacity(companyId: bigint, resource: TrialResource): Promise<void> {
  const company = await withTenant(companyId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      select: { plan: true, planStatus: true, trialEndsAt: true, entitlements: true }
    })
  );
  if (!company) return; // nothing to gate if the company can't be read
  if (company.plan !== 'trial') return; // paid plans are never metered

  // Expired trial window — gate everything and route to billing.
  if (company.trialEndsAt && company.trialEndsAt.getTime() < Date.now()) {
    await recordAudit({
      action: 'trial.limit.reached',
      companyId,
      actorEmail: 'system',
      entityType: resource,
      metadata: { resource, reason: 'trial_expired' }
    });
    throw new TrialLimitError(resource, 0, 0);
  }

  const platformDefaults = await getPlatformDefaultEntitlements();
  const limit = resolveEntitlements(company.entitlements, platformDefaults).limits[resource];

  const used = await withTenant(companyId, async (tx) => {
    switch (resource) {
      case 'solicitation':
        return tx.solicitation.count({ where: { companyId } });
      case 'review_run': {
        // A "review run" spans both paradigms: a color-team review that has at least one pass
        // row (each run creates 3) OR a Direct AI review that has been initiated.
        const colorTeam = await tx.review.count({ where: { companyId, passes: { some: {} } } });
        const directAi = await tx.directReview.count({
          where: { companyId, status: { not: 'not_started' } }
        });
        return colorTeam + directAi;
      }
      case 'seat':
        return tx.daraUser.count({ where: { companyId, isActive: true } });
    }
  });

  if (used >= limit) {
    await recordAudit({
      action: 'trial.limit.reached',
      companyId,
      actorEmail: 'system',
      entityType: resource,
      metadata: { resource, used, limit }
    });
    throw new TrialLimitError(resource, used, limit);
  }
}

/**
 * Throw FeatureDisabledError if `feature` has been switched off for `companyId`. Applies to
 * every plan (a platform admin can fence a capability for any account). Features default ON.
 */
export async function requireFeature(companyId: bigint, feature: FeatureFlag): Promise<void> {
  const company = await withTenant(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { entitlements: true } })
  );
  const platformDefaults = await getPlatformDefaultEntitlements();
  if (company && !hasFeature(company.entitlements, feature, platformDefaults)) {
    await recordAudit({
      action: 'feature.blocked',
      companyId,
      actorEmail: 'system',
      entityType: feature,
      metadata: { feature }
    });
    throw new FeatureDisabledError(feature);
  }
}
