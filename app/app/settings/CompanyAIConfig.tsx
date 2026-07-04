'use client';

import { useState } from 'react';
import { Save, KeyRound, Cpu } from 'lucide-react';
import CuiBoundaryNotice from '@/components/dara/CuiBoundaryNotice';
import {
  card,
  fieldClasses,
  labelClasses,
  checkboxClasses,
  btnPrimary,
  sectionTitle
} from '@/components/dara/theme';

const PROVIDERS = ['anthropic', 'openai', 'google'] as const;

// Company AI settings. Non-BYOK (platform) accounts have NO provider/model/key
// choice — they use the key + model the platform admin configured. Those controls
// (and the BYOK key fields) appear only in BYOK mode.
export default function CompanyAIConfig({
  updateAIConfig,
  updateApiKeys,
  initialMode,
  provider,
  model,
  platformProvider,
  platformModel,
  keyHints
}: {
  updateAIConfig: (fd: FormData) => Promise<void>;
  updateApiKeys: (fd: FormData) => Promise<void>;
  initialMode: string;
  provider: string;
  model: string;
  platformProvider: string;
  platformModel: string;
  keyHints: { anthropic: string; openai: string; google: string };
}) {
  const [mode, setMode] = useState(initialMode === 'byok' ? 'byok' : 'platform');
  const byok = mode === 'byok';

  return (
    <>
      <section className={`${card} p-6`}>
        <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
          <Cpu className="h-4 w-4 text-t5" />
          AI Configuration
        </h2>
        <div className="mb-4">
          <CuiBoundaryNotice provider={byok ? provider : platformProvider} mode={mode} />
        </div>

        <form action={updateAIConfig} className="space-y-4">
          <div className="max-w-xs space-y-1.5">
            <label className={labelClasses}>Key mode</label>
            <select
              name="aiKeyMode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className={fieldClasses}
            >
              <option value="platform">platform (managed by admin)</option>
              <option value="byok">byok (your own key)</option>
            </select>
          </div>

          {byok ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClasses}>Provider</label>
                <select name="activeProvider" defaultValue={provider} className={fieldClasses}>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={labelClasses}>Model</label>
                <input
                  name="activeModel"
                  type="text"
                  defaultValue={model}
                  className={fieldClasses}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Preserve the company's stored BYOK provider/model while on platform. */}
              <input type="hidden" name="activeProvider" value={provider} />
              <input type="hidden" name="activeModel" value={model} />
              <div className="rounded-lg border border-navy/30 bg-navy/10 px-4 py-3 text-[13px] text-t3">
                Evaluations use the platform model configured by your administrator:{' '}
                <span className="font-mono text-t2">{platformProvider}</span> ·{' '}
                <span className="font-mono text-t2">{platformModel}</span>. There is no
                per-account key or model selection on platform mode — switch to{' '}
                <strong className="text-t2">byok</strong> to use your own provider, model,
                and key.
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button type="submit" className={btnPrimary}>
              <Save className="h-4 w-4" />
              Save AI config
            </button>
          </div>
        </form>
      </section>

      {byok && (
        <section className={`${card} p-6`}>
          <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
            <KeyRound className="h-4 w-4 text-t5" />
            API Keys (BYOK)
          </h2>
          <p className="mb-4 text-[12px] text-t4">
            Stored encrypted (AES-256-GCM). Leave a field blank to keep the current key;
            tick &ldquo;clear&rdquo; to remove it.
          </p>
          <form action={updateApiKeys} className="space-y-4">
            {(['anthropic', 'openai', 'google'] as const).map((p) => (
              <div key={p} className="space-y-1.5">
                <label className={labelClasses}>
                  {p} key{' '}
                  {keyHints[p] ? (
                    <span className="ml-1 normal-case text-[#7de0a0]">set ({keyHints[p]})</span>
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
            <div className="flex justify-end">
              <button type="submit" className={btnPrimary}>
                <Save className="h-4 w-4" />
                Save keys
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
