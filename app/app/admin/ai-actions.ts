'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import {
  setPlatformKeys,
  setPlatformModel,
  AI_PROVIDERS,
  type AIProviderName
} from '@/utils/dara/platform-ai';
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
  revalidatePath('/app/admin');
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
  revalidatePath('/app/admin');
}
