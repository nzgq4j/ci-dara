import { prismaAdmin } from '@/utils/prisma';
import { encryptSecret, decryptSecret, secretHint } from '@/utils/dara/crypto';
import { AI_PROVIDERS, MODEL_CATALOG, type AIProviderName } from '@/utils/dara/ai-catalog';

// Platform AI configuration is a singleton row managed only from the Application
// Admin console. It supplies the API keys used by companies in 'platform' mode and
// the centrally-selected provider + model. Keys are stored encrypted (AES-256-GCM);
// during the transition the PLATFORM_*_KEY env vars remain a fallback when a DB key
// is not yet set.

// Re-export the client-safe catalog so existing server importers keep working.
export { AI_PROVIDERS, MODEL_CATALOG };
export type { AIProviderName };

const SETTINGS_ID = 1;
const ENV_BY_PROVIDER: Record<AIProviderName, string> = {
  anthropic: 'PLATFORM_ANTHROPIC_KEY',
  openai: 'PLATFORM_OPENAI_KEY',
  google: 'PLATFORM_GOOGLE_KEY'
};
const ENC_FIELD: Record<AIProviderName, 'anthropicKeyEnc' | 'openaiKeyEnc' | 'googleKeyEnc'> = {
  anthropic: 'anthropicKeyEnc',
  openai: 'openaiKeyEnc',
  google: 'googleKeyEnc'
};

async function getOrCreateRow() {
  const existing = await prismaAdmin.platformSetting.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  try {
    return await prismaAdmin.platformSetting.create({ data: { id: SETTINGS_ID } });
  } catch {
    // Lost a create race — the row now exists.
    return prismaAdmin.platformSetting.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
  }
}

export interface PlatformAI {
  activeProvider: AIProviderName;
  activeModel: string;
  keys: Record<AIProviderName, string>;
}

/** Runtime resolution for the evaluator: decrypted keys (DB, env fallback) + model. */
export async function getPlatformAI(): Promise<PlatformAI> {
  const row = await getOrCreateRow();
  const keyFor = (p: AIProviderName) =>
    decryptSecret(row[ENC_FIELD[p]]) || (process.env[ENV_BY_PROVIDER[p]] ?? '');
  return {
    activeProvider: row.activeProvider as AIProviderName,
    activeModel: row.activeModel,
    keys: {
      anthropic: keyFor('anthropic'),
      openai: keyFor('openai'),
      google: keyFor('google')
    }
  };
}

export interface PlatformAIView {
  activeProvider: AIProviderName;
  activeModel: string;
  hints: Record<AIProviderName, string>;
  /** Provider has a usable key (DB-set, or present in env as fallback). */
  configured: Record<AIProviderName, boolean>;
  /** Provider's only key source is the env var (not yet moved into the console). */
  envOnly: Record<AIProviderName, boolean>;
  providersWithKey: AIProviderName[];
}

/** UI view: key hints + which providers are configured (never returns secrets). */
export async function getPlatformAIView(): Promise<PlatformAIView> {
  const row = await getOrCreateRow();
  const hints = {} as Record<AIProviderName, string>;
  const configured = {} as Record<AIProviderName, boolean>;
  const envOnly = {} as Record<AIProviderName, boolean>;
  for (const p of AI_PROVIDERS) {
    const dbKey = decryptSecret(row[ENC_FIELD[p]]);
    const envKey = process.env[ENV_BY_PROVIDER[p]] ?? '';
    hints[p] = secretHint(row[ENC_FIELD[p]]);
    configured[p] = Boolean(dbKey || envKey);
    envOnly[p] = !dbKey && Boolean(envKey);
  }
  return {
    activeProvider: row.activeProvider as AIProviderName,
    activeModel: row.activeModel,
    hints,
    configured,
    envOnly,
    providersWithKey: AI_PROVIDERS.filter((p) => configured[p])
  };
}

/** Just the central provider + model (no key info) — safe to show company admins. */
export async function getPlatformModelInfo(): Promise<{
  activeProvider: AIProviderName;
  activeModel: string;
}> {
  const row = await getOrCreateRow();
  return {
    activeProvider: row.activeProvider as AIProviderName,
    activeModel: row.activeModel
  };
}

/**
 * Update platform keys. For each provider: a non-empty string sets (encrypts) the
 * key; `null` clears it; `undefined` leaves it unchanged.
 */
export async function setPlatformKeys(
  keys: Partial<Record<AIProviderName, string | null>>
): Promise<void> {
  const data: Record<string, string | null> = {};
  for (const p of AI_PROVIDERS) {
    const v = keys[p];
    if (v === null) data[ENC_FIELD[p]] = null;
    else if (typeof v === 'string' && v.trim()) data[ENC_FIELD[p]] = encryptSecret(v.trim());
  }
  if (Object.keys(data).length === 0) return;
  await getOrCreateRow();
  await prismaAdmin.platformSetting.update({ where: { id: SETTINGS_ID }, data });
}

/** Set the central provider + model. Model is validated against the catalog. */
export async function setPlatformModel(provider: string, model: string): Promise<void> {
  const p = (AI_PROVIDERS as readonly string[]).includes(provider)
    ? (provider as AIProviderName)
    : 'anthropic';
  const ids = MODEL_CATALOG[p].map((m) => m.id);
  const m = ids.includes(model) ? model : ids[0] ?? 'claude-sonnet-4-6';
  await getOrCreateRow();
  await prismaAdmin.platformSetting.update({
    where: { id: SETTINGS_ID },
    data: { activeProvider: p as any, activeModel: m }
  });
}
