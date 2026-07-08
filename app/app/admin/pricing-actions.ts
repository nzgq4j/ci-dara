'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import { setPriceOverride, deletePrice, refreshPricing } from '@/utils/dara/pricing';
import { recordAudit } from '@/utils/dara/audit';

const num = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

// Pin a provider/model rate as an operator override (immune to the weekly feed refresh).
export async function saveModelPriceOverride(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const provider = String(formData.get('provider') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim();
  const inputPerMtok = num(formData.get('inputPerMtok'));
  const outputPerMtok = num(formData.get('outputPerMtok'));
  if (!provider || !model || Number.isNaN(inputPerMtok) || Number.isNaN(outputPerMtok)) return;

  await setPriceOverride(provider, model, inputPerMtok, outputPerMtok);
  await recordAudit({
    action: 'platform.ai.price_override.update',
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'ai_model_price',
    metadata: { provider, model, inputPerMtok, outputPerMtok }
  });
  revalidatePath('/app/admin/usage');
}

// Remove a price row (override or feed); the next weekly refresh may repopulate feed rows.
export async function deleteModelPrice(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const provider = String(formData.get('provider') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim();
  if (!provider || !model) return;

  await deletePrice(provider, model);
  await recordAudit({
    action: 'platform.ai.price.delete',
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'ai_model_price',
    metadata: { provider, model }
  });
  revalidatePath('/app/admin/usage');
}

// Pull the latest rates from the feed on demand (in addition to the weekly cron).
export async function refreshPricingNow() {
  const admin = await requirePlatformAdmin();
  const res = await refreshPricing();
  await recordAudit({
    action: 'platform.ai.price.refresh',
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'ai_model_price',
    metadata: { ...res }
  });
  revalidatePath('/app/admin/usage');
}
