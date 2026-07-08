'use client';

import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { fieldClasses, btnGhost, card } from '@/components/dara/theme';
import { saveModelPriceOverride, deleteModelPrice, refreshPricingNow } from './pricing-actions';

export interface PricingRowView {
  provider: string;
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  source: string;
  updatedAt: string; // ISO
}

// Per-model pricing table (USD per 1M tokens). Feed rows come from the weekly refresh; an
// operator can override any rate (or price a model the feed lacks) — override rows are immune
// to the refresh. Each row is its own server-action form.
export default function ModelPricing({
  rows,
  unpriced,
  lastRefreshed
}: {
  rows: PricingRowView[];
  unpriced: { provider: string; model: string }[];
  lastRefreshed: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
          {lastRefreshed
            ? `Feed last refreshed ${new Date(lastRefreshed).toLocaleString()}`
            : 'Feed never refreshed'}
          {' · rates in USD per 1M tokens'}
        </div>
        <form action={refreshPricingNow}>
          <button type="submit" className={btnGhost} title="Pull latest rates from the pricing feed now">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="ml-1.5 text-[12px]">Refresh from feed</span>
          </button>
        </form>
      </div>

      {/* Models with usage but no price — prompt the operator to add an override. */}
      {unpriced.length > 0 && (
        <div className={`${card} border-amber-500/40 p-4`}>
          <div className="mb-2 text-[12px] font-semibold text-t1">
            {unpriced.length} model{unpriced.length > 1 ? 's' : ''} with usage but no price — cost is understated
          </div>
          <div className="space-y-2">
            {unpriced.map((u) => (
              <PriceRow key={`${u.provider}:${u.model}`} provider={u.provider} model={u.model} input={0} output={0} isNew />
            ))}
          </div>
        </div>
      )}

      {/* Full price table. */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-3 px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
          <span className="w-20 shrink-0">Provider</span>
          <span className="flex-1">Model</span>
          <span className="w-20 shrink-0 text-right">In $/M</span>
          <span className="w-20 shrink-0 text-right">Out $/M</span>
          <span className="w-16 shrink-0">Src</span>
          <span className="w-14 shrink-0 sr-only">Actions</span>
        </div>
        {rows.length === 0 ? (
          <div className={`${card} p-4 text-[12px] text-t4`}>
            No prices yet. Click “Refresh from feed” to pull rates, or add an override above.
          </div>
        ) : (
          rows.map((r) => (
            <PriceRow
              key={`${r.provider}:${r.model}`}
              provider={r.provider}
              model={r.model}
              input={r.inputPerMtok}
              output={r.outputPerMtok}
              source={r.source}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PriceRow({
  provider,
  model,
  input,
  output,
  source,
  isNew
}: {
  provider: string;
  model: string;
  input: number;
  output: number;
  source?: string;
  isNew?: boolean;
}) {
  return (
    <div className={`${card} flex items-center gap-3 p-2.5`}>
      <div className="w-20 shrink-0 truncate font-mono text-[11px] text-t2">{provider}</div>
      <div className="flex-1 truncate font-mono text-[12px] text-t1" title={model}>{model}</div>
      <form action={saveModelPriceOverride} className="flex items-center gap-3">
        <input type="hidden" name="provider" value={provider} />
        <input type="hidden" name="model" value={model} />
        <input
          name="inputPerMtok"
          type="number"
          step="0.01"
          min="0"
          defaultValue={input || ''}
          placeholder="0.00"
          className={`${fieldClasses} w-20 text-right tabular-nums`}
        />
        <input
          name="outputPerMtok"
          type="number"
          step="0.01"
          min="0"
          defaultValue={output || ''}
          placeholder="0.00"
          className={`${fieldClasses} w-20 text-right tabular-nums`}
        />
        <span
          className={`w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] ${
            isNew ? 'text-amber-500' : source === 'override' ? 'text-gold' : 'text-t5'
          }`}
        >
          {isNew ? 'new' : source}
        </span>
        <button type="submit" className={btnGhost} title="Save as override">
          <Save className="h-4 w-4" />
        </button>
      </form>
      {!isNew ? (
        <form action={deleteModelPrice}>
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="model" value={model} />
          <button type="submit" className={`${btnGhost} text-t5 hover:text-red-500`} title="Delete this price row">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : (
        <span className="w-9 shrink-0" />
      )}
    </div>
  );
}
