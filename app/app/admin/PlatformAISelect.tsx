'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { fieldClasses, labelClasses, btnPrimary } from '@/components/dara/theme';
import { MODEL_CATALOG, type AIProviderName } from '@/utils/dara/ai-catalog';
import { savePlatformModel } from './ai-actions';

// Active provider + model picker. Provider options are limited to providers that
// have a key configured; the model list follows the selected provider.
export default function PlatformAISelect({
  providersWithKey,
  activeProvider,
  activeModel
}: {
  providersWithKey: AIProviderName[];
  activeProvider: AIProviderName;
  activeModel: string;
}) {
  // Default the picker to a configured provider.
  const initialProvider = providersWithKey.includes(activeProvider)
    ? activeProvider
    : providersWithKey[0];
  const [provider, setProvider] = useState<AIProviderName | undefined>(initialProvider);

  if (providersWithKey.length === 0) {
    return (
      <p className="text-[13px] text-t4">
        Add at least one provider key above to select the active model.
      </p>
    );
  }

  const models = provider ? MODEL_CATALOG[provider] : [];
  const defaultModel = models.some((m) => m.id === activeModel)
    ? activeModel
    : models[0]?.id;

  return (
    <form action={savePlatformModel} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={labelClasses}>Provider</label>
          <select
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as AIProviderName)}
            className={fieldClasses}
          >
            {providersWithKey.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClasses}>Model</label>
          {/* key forces remount so defaultValue tracks the selected provider */}
          <select
            key={provider}
            name="model"
            defaultValue={defaultModel}
            className={fieldClasses}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" className={btnPrimary}>
          <Save className="h-4 w-4" />
          Save active model
        </button>
      </div>
    </form>
  );
}
