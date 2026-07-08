'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import {
  setPlatformKeys,
  setPlatformModel,
  AI_PROVIDERS,
  type AIProviderName
} from '@/utils/dara/platform-ai';
import {
  setCapabilityOverride,
  AI_CAPABILITIES
} from '@/utils/dara/capability-model';
import { recordAudit } from '@/utils/dara/audit';

export async function savePlatformKeys(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const keys: Partial<Record<AIProviderName, string | null>> = {};
  const changed: string[] = [];
  for (const p of AI_PROVIDERS) {
    if (formData.get(`${p}_clear`) === 'on') {
      keys[p] = null;
      changed.push(`${p}:clear`);
    } else {
      const v = String(formData.get(p) ?? '').trim();
      if (v) {
        keys[p] = v;
        changed.push(p);
      }
    }
  }
  await setPlatformKeys(keys);
  if (changed.length) {
    await recordAudit({
      action: 'platform.ai.keys.update',
      actorId: admin.userId,
      actorEmail: admin.email,
      entityType: 'platform_settings',
      // Field NAMES only — never the secret values.
      metadata: { changed }
    });
  }
  revalidatePath('/app/admin/ai');
}

export async function savePlatformModel(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const provider = String(formData.get('provider') ?? 'anthropic');
  const model = String(formData.get('model') ?? '').trim();
  await setPlatformModel(provider, model);
  await recordAudit({
    action: 'platform.ai.model.update',
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'platform_settings',
    metadata: { provider, model }
  });
  revalidatePath('/app/admin/ai');
}

// Per-capability model override. An empty provider/model clears the override so the
// capability falls back to the platform default. setCapabilityOverride validates the
// provider/model against the catalog (an invalid pair clears rather than persists).
export async function saveCapabilityOverride(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const capability = String(formData.get('capability') ?? '');
  if (!(AI_CAPABILITIES as string[]).includes(capability)) return;
  const provider = String(formData.get('provider') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim();
  await setCapabilityOverride(capability as (typeof AI_CAPABILITIES)[number], provider || null, model || null);
  await recordAudit({
    action: 'platform.ai.capability_override.update',
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'platform_settings',
    metadata: { capability, provider: provider || null, model: model || null }
  });
  revalidatePath('/app/admin/ai');
}
