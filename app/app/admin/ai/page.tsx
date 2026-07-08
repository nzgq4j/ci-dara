import { Save, Cpu, SlidersHorizontal } from 'lucide-react';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import { getPlatformAIView, AI_PROVIDERS } from '@/utils/dara/platform-ai';
import { getCapabilityOverrides, AI_CAPABILITIES, CAPABILITY_LABELS } from '@/utils/dara/capability-model';
import { savePlatformKeys } from '../ai-actions';
import PlatformAISelect from '../PlatformAISelect';
import CapabilityOverrides from '../CapabilityOverrides';
import PageHeader from '@/components/dara/PageHeader';
import {
  card,
  fieldClasses,
  labelClasses,
  checkboxClasses,
  btnPrimary,
  sectionTitle
} from '@/components/dara/theme';

export default async function AdminAIPage() {
  await requirePlatformAdmin();

  const ai = await getPlatformAIView();
  const overridesMap = await getCapabilityOverrides();
  // Shape overrides into a plain string-keyed map for the client component.
  const current: Record<string, { provider: string; model: string } | undefined> = {};
  for (const cap of AI_CAPABILITIES) {
    const o = overridesMap[cap];
    current[cap] = o ? { provider: o.provider, model: o.model } : undefined;
  }
  const overrideCount = Object.values(current).filter(Boolean).length;

  return (
    <div className="fade">
      <PageHeader
        eyebrow="Platform"
        title="Platform AI"
        subtitle={`${ai.providersWithKey.length} provider${ai.providersWithKey.length === 1 ? '' : 's'} configured · ${overrideCount} capability override${overrideCount === 1 ? '' : 's'}`}
      />

      <div className="space-y-8">
        {/* Provider keys */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Cpu className="h-4 w-4 text-t5" />Provider keys
          </h2>
          <p className="text-[12px] text-t4">
            Platform API keys used by every company on the{' '}
            <span className="text-t2">platform</span> key mode. This is the only place these keys
            are configured.
          </p>
          <form action={savePlatformKeys} className={`${card} space-y-4 p-5`}>
            {AI_PROVIDERS.map((p) => (
              <div key={p} className="space-y-1.5">
                <label className={labelClasses}>
                  {p} key{' '}
                  {ai.hints[p] ? (
                    <span className="ml-1 normal-case text-[#166534]">set ({ai.hints[p]})</span>
                  ) : ai.envOnly[p] ? (
                    <span className="ml-1 normal-case text-[#d9a441]">from env (move into console)</span>
                  ) : (
                    <span className="ml-1 normal-case text-t5">not set</span>
                  )}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    name={p}
                    type="password"
                    autoComplete="off"
                    placeholder="Enter new key…"
                    className={fieldClasses}
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-t4">
                    <input type="checkbox" name={`${p}_clear`} className={checkboxClasses} />
                    clear
                  </label>
                </div>
              </div>
            ))}
            <p className="text-[12px] text-t4">
              Stored encrypted (AES-256-GCM). Leave blank to keep the current key; tick
              &ldquo;clear&rdquo; to remove it. A key set here overrides the matching{' '}
              <span className="font-mono">PLATFORM_*_KEY</span> env var.
            </p>
            <div className="flex justify-end">
              <button type="submit" className={btnPrimary}><Save className="h-4 w-4" />Save keys</button>
            </div>
          </form>
        </section>

        {/* Active model */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Cpu className="h-4 w-4 text-t5" />Active model
          </h2>
          <div className={`${card} space-y-4 p-5`}>
            <PlatformAISelect
              providersWithKey={ai.providersWithKey}
              activeProvider={ai.activeProvider}
              activeModel={ai.activeModel}
            />
            <p className="text-[12px] text-t4">
              Current: <span className="font-mono text-t2">{ai.activeProvider}</span> ·{' '}
              <span className="font-mono text-t2">{ai.activeModel}</span>. Companies on platform mode
              use this model unless a capability below overrides it.
            </p>
          </div>
        </section>

        {/* Per-capability model overrides */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <SlidersHorizontal className="h-4 w-4 text-t5" />Per-capability models
          </h2>
          <p className="text-[12px] text-t4">
            Pin a specific AI capability to a different provider/model — e.g. run the cheap,
            high-volume shred and compliance sweep on a smaller model while keeping the nuanced
            review passes on a stronger one. Overrides apply only to companies on{' '}
            <span className="text-t2">platform</span> key mode. Leave a row on{' '}
            <span className="font-mono">Platform default</span> to inherit the active model above.
          </p>
          <CapabilityOverrides
            capabilities={AI_CAPABILITIES as unknown as string[]}
            labels={CAPABILITY_LABELS as unknown as Record<string, string>}
            current={current}
            providersWithKey={ai.providersWithKey}
            platformLabel={`Platform default (${ai.activeModel})`}
          />
        </section>
      </div>
    </div>
  );
}
