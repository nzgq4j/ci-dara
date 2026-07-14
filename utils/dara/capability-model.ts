import { prismaAdmin } from '@/utils/prisma';
import type { AICapability } from '@prisma/client';
import { AI_PROVIDERS, MODEL_CATALOG, type AIProviderName } from '@/utils/dara/ai-catalog';
import type { ResolvedAI } from '@/utils/dara/providers';
import type { PlatformAI } from '@/utils/dara/platform-ai';

// Per-capability model overrides. The platform runs one central provider/model
// (PlatformSetting.activeProvider/activeModel) for companies in 'platform' AI mode, but an
// operator can pin a specific capability to a different provider/model — e.g. run the cheap,
// high-volume shred + compliance sweep on Haiku while keeping the nuanced review passes on a
// stronger model. Overrides live in a JSON map on the platform-settings singleton and only
// apply in 'platform' mode (BYOK companies use their own provider/model/key by definition).

const SETTINGS_ID = 1;

export const AI_CAPABILITIES: AICapability[] = [
  'shred',
  'compliance_sweep',
  'review_pass',
  'direct_review',
  'amendment_diff',
  'evaluation',
  'annotated_export',
  'document_classify'
];

export const CAPABILITY_LABELS: Record<AICapability, string> = {
  shred: 'Requirements shred',
  compliance_sweep: 'Compliance sweep',
  review_pass: 'Color-team review pass',
  direct_review: 'Direct AI review',
  amendment_diff: 'Amendment diff',
  evaluation: 'Requirement evaluation',
  annotated_export: 'Annotated export',
  document_classify: 'Document-role classifier'
};

export interface CapabilityModel {
  provider: AIProviderName;
  model: string;
}

export type CapabilityOverrides = Partial<Record<AICapability, CapabilityModel>>;

function isCapability(v: string): v is AICapability {
  return (AI_CAPABILITIES as string[]).includes(v);
}

/** Parse + validate the raw JSON, dropping any unknown capability/provider/model. */
function parseOverrides(raw: unknown): CapabilityOverrides {
  const out: CapabilityOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [cap, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCapability(cap) || !val || typeof val !== 'object') continue;
    const provider = (val as any).provider;
    const model = (val as any).model;
    if (!(AI_PROVIDERS as readonly string[]).includes(provider)) continue;
    const ids = MODEL_CATALOG[provider as AIProviderName].map((m) => m.id);
    if (typeof model !== 'string' || !ids.includes(model)) continue;
    out[cap] = { provider: provider as AIProviderName, model };
  }
  return out;
}

/**
 * Read the current per-capability overrides (validated against the catalog). Admin-only.
 *
 * Runs on every AI call site (in platform mode), so it is fail-safe: any read error — most
 * notably the `capability_models` column not yet existing if code is deployed ahead of the
 * migration — degrades to "no overrides" (platform default) rather than breaking the AI path.
 */
export async function getCapabilityOverrides(): Promise<CapabilityOverrides> {
  try {
    const row = await prismaAdmin.platformSetting.findUnique({ where: { id: SETTINGS_ID } });
    return parseOverrides(row?.capabilityModels);
  } catch (e) {
    console.error('[capability-model] failed to read overrides; using platform default:', e);
    return {};
  }
}

/**
 * Set or clear the override for one capability. Passing provider/model of null clears it
 * (falls back to the platform default). Provider + model are validated against the catalog;
 * an invalid pair is rejected as a clear so the store never holds an unusable override.
 */
export async function setCapabilityOverride(
  capability: AICapability,
  provider: string | null,
  model: string | null
): Promise<void> {
  const current = await getCapabilityOverrides();
  const next: CapabilityOverrides = { ...current };

  const validProvider =
    provider && (AI_PROVIDERS as readonly string[]).includes(provider)
      ? (provider as AIProviderName)
      : null;
  const validModel =
    validProvider && model && MODEL_CATALOG[validProvider].some((m) => m.id === model)
      ? model
      : null;

  if (validProvider && validModel) next[capability] = { provider: validProvider, model: validModel };
  else delete next[capability];

  await prismaAdmin.platformSetting.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, capabilityModels: next as object },
    update: { capabilityModels: next as object }
  });
}

/**
 * Apply the capability override to an already-resolved AI selection.
 *
 * Overrides only apply when the company runs in 'platform' AI mode and a platform config
 * (with keys) is present. If the overridden provider has no usable platform key, we keep the
 * base selection rather than dispatch to a provider we can't authenticate. Returns `base`
 * unchanged in every other case, so callers can wrap resolveCompanyAI() unconditionally.
 */
export function applyCapabilityOverride(
  base: ResolvedAI,
  capability: AICapability,
  company: { aiKeyMode: string },
  platform: PlatformAI | undefined,
  overrides: CapabilityOverrides
): ResolvedAI {
  if (company.aiKeyMode !== 'platform' || !platform) return base;
  const override = overrides[capability];
  if (!override) return base;
  const apiKey = platform.keys[override.provider];
  if (!apiKey) return base;
  return { provider: override.provider, model: override.model, apiKey };
}
