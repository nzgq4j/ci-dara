'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { fieldClasses, btnGhost, card } from '@/components/dara/theme';
import { MODEL_CATALOG, type AIProviderName } from '@/utils/dara/ai-catalog';
import { saveCapabilityOverride } from './ai-actions';

type OverrideMap = Record<string, { provider: string; model: string } | undefined>;

// Per-capability model overrides table. Each row is its own server-action form: pick a
// provider + model to pin that capability, or leave the provider on "Platform default" to
// clear it. Only providers with a configured platform key are offered — an override to a
// keyless provider could not run.
export default function CapabilityOverrides({
  capabilities,
  labels,
  current,
  providersWithKey,
  platformLabel
}: {
  capabilities: string[];
  labels: Record<string, string>;
  current: OverrideMap;
  providersWithKey: AIProviderName[];
  platformLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1.4fr_1fr_1.4fr_auto] gap-3 px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
        <span>Capability</span>
        <span>Provider</span>
        <span>Model</span>
        <span className="sr-only">Save</span>
      </div>
      {capabilities.map((cap) => (
        <Row
          key={cap}
          cap={cap}
          label={labels[cap] ?? cap}
          current={current[cap]}
          providersWithKey={providersWithKey}
          platformLabel={platformLabel}
        />
      ))}
    </div>
  );
}

function Row({
  cap,
  label,
  current,
  providersWithKey,
  platformLabel
}: {
  cap: string;
  label: string;
  current: { provider: string; model: string } | undefined;
  providersWithKey: AIProviderName[];
  platformLabel: string;
}) {
  const [provider, setProvider] = useState<string>(current?.provider ?? '');
  const models = provider ? MODEL_CATALOG[provider as AIProviderName] ?? [] : [];
  // Keep the current model selected when the row loads on its saved provider; otherwise the
  // first model of the chosen provider.
  const defaultModel = current && current.provider === provider ? current.model : models[0]?.id ?? '';

  return (
    <form action={saveCapabilityOverride} className={`${card} grid grid-cols-[1.4fr_1fr_1.4fr_auto] items-center gap-3 p-3`}>
      <input type="hidden" name="capability" value={cap} />
      <div className="min-w-0">
        <div className="truncate text-[13px] text-t1">{label}</div>
        <div className="font-mono text-[10px] text-t5">
          {current ? `${current.provider} · ${current.model}` : 'inheriting default'}
        </div>
      </div>
      <select
        name="provider"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        className={fieldClasses}
      >
        <option value="">{platformLabel}</option>
        {providersWithKey.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {/* key forces remount so defaultValue tracks the selected provider */}
      <select key={provider} name="model" defaultValue={defaultModel} disabled={!provider} className={fieldClasses}>
        {provider ? (
          models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))
        ) : (
          <option value="">—</option>
        )}
      </select>
      <button type="submit" className={btnGhost} title="Save override">
        <Save className="h-4 w-4" />
      </button>
    </form>
  );
}
