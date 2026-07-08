import Link from 'next/link';
import { Activity, TrendingUp, TrendingDown, AlertTriangle, DollarSign } from 'lucide-react';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import { getUsageReport, normalizeUsageDays } from '@/utils/dara/usage';
import { listPricing, pricingLastRefreshed } from '@/utils/dara/pricing';
import { CAPABILITY_LABELS } from '@/utils/dara/capability-model';
import PageHeader from '@/components/dara/PageHeader';
import { card, sectionTitle } from '@/components/dara/theme';
import ModelPricing from '../ModelPricing';

const RANGES = [
  { days: 0, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' }
];

const nf = new Intl.NumberFormat('en-US');

/** Format a USD amount; tiny non-zero costs show as <$0.01 rather than $0.00. */
function usd(n: number | null): string {
  if (n == null) return '—';
  if (n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({
  label,
  value,
  icon,
  hint
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-t1">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-amber-500">{hint}</div>}
    </div>
  );
}

export default async function AdminUsagePage({
  searchParams
}: {
  searchParams: { days?: string };
}) {
  await requirePlatformAdmin();

  const days = normalizeUsageDays(searchParams.days);
  const [report, priceRows, lastRefreshed] = await Promise.all([
    getUsageReport(days, new Date()),
    listPricing(),
    pricingLastRefreshed()
  ]);
  const { totals } = report;

  return (
    <div className="fade">
      <PageHeader
        eyebrow="Platform"
        title="AI usage &amp; cost"
        subtitle={`${nf.format(totals.calls)} calls · ${nf.format(totals.tokenIn + totals.tokenOut)} tokens · ${usd(totals.cost)}${totals.hasUnpriced ? '+' : ''} est. since ${report.since.toLocaleString()}`}
      />

      {/* Range selector */}
      <div className="mb-6 flex gap-1">
        {RANGES.map((r) => {
          const active = r.days === days;
          return (
            <Link
              key={r.days}
              href={`/app/admin/usage?days=${r.days}`}
              className={`rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                active ? 'bg-t1 font-semibold text-white' : 'border border-line text-t4 hover:text-t2'
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Est. cost" value={usd(totals.cost)} icon={<DollarSign className="h-3.5 w-3.5" />} hint={totals.hasUnpriced ? 'some models unpriced' : undefined} />
        <StatCard label="Calls" value={nf.format(totals.calls)} icon={<Activity className="h-3.5 w-3.5" />} />
        <StatCard label="Tokens in" value={nf.format(totals.tokenIn)} icon={<TrendingDown className="h-3.5 w-3.5" />} />
        <StatCard label="Tokens out" value={nf.format(totals.tokenOut)} icon={<TrendingUp className="h-3.5 w-3.5" />} />
        <StatCard label="Failed calls" value={nf.format(totals.failures)} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
      </div>

      <div className="space-y-8">
        {/* Cost per run */}
        <section className="space-y-3">
          <h2 className={sectionTitle}>Cost per run</h2>
          {report.byRun.length === 0 ? (
            <div className={`${card} p-4 text-[12px] text-t4`}>No attributed runs in this window.</div>
          ) : (
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                    <th className="px-4 py-2 font-normal">Run</th>
                    <th className="px-4 py-2 font-normal">Account</th>
                    <th className="px-4 py-2 font-normal">Capabilities</th>
                    <th className="px-4 py-2 text-right font-normal">Calls</th>
                    <th className="px-4 py-2 text-right font-normal">Tokens</th>
                    <th className="px-4 py-2 text-right font-normal">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byRun.map((r) => (
                    <tr key={r.runId} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-mono text-[11px] text-t2">{r.runId}</td>
                      <td className="px-4 py-2 text-t1">{r.companyName}</td>
                      <td className="px-4 py-2 text-t3">
                        {r.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(', ')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.calls)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.tokenIn + r.tokenOut)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-t1">{usd(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-t5">
            A run = one job (a Direct Review, a shred, a review, an evaluation) and all the LLM calls it makes. Only runs recorded after cost tracking shipped appear here.
          </p>
        </section>

        {/* By capability */}
        <section className="space-y-3">
          <h2 className={sectionTitle}>By capability</h2>
          {report.byCapability.length === 0 ? (
            <div className={`${card} p-4 text-[12px] text-t4`}>No usage recorded in this window.</div>
          ) : (
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                    <th className="px-4 py-2 font-normal">Capability</th>
                    <th className="px-4 py-2 text-right font-normal">Calls</th>
                    <th className="px-4 py-2 text-right font-normal">Tokens in</th>
                    <th className="px-4 py-2 text-right font-normal">Tokens out</th>
                    <th className="px-4 py-2 text-right font-normal">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byCapability.map((r) => (
                    <tr key={r.capability} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 text-t1">{CAPABILITY_LABELS[r.capability] ?? r.capability}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.calls)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.tokenIn)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.tokenOut)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-t1">{usd(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* By company + model */}
        <section className="space-y-3">
          <h2 className={sectionTitle}>By account &amp; model</h2>
          {report.byModel.length === 0 ? (
            <div className={`${card} p-4 text-[12px] text-t4`}>No usage recorded in this window.</div>
          ) : (
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                    <th className="px-4 py-2 font-normal">Account</th>
                    <th className="px-4 py-2 font-normal">Provider</th>
                    <th className="px-4 py-2 font-normal">Model</th>
                    <th className="px-4 py-2 text-right font-normal">Calls</th>
                    <th className="px-4 py-2 text-right font-normal">Tokens in</th>
                    <th className="px-4 py-2 text-right font-normal">Tokens out</th>
                    <th className="px-4 py-2 text-right font-normal">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byModel.map((r, i) => (
                    <tr key={`${r.companyId}-${r.provider}-${r.model}-${i}`} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 text-t1">{r.companyName}</td>
                      <td className="px-4 py-2 font-mono text-t2">{r.provider}</td>
                      <td className="px-4 py-2 font-mono text-t2">{r.model}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.calls)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.tokenIn)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.tokenOut)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-t1">{usd(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Model pricing */}
        <section className="space-y-3">
          <h2 className={sectionTitle}>Model pricing</h2>
          <ModelPricing
            rows={priceRows.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() }))}
            unpriced={report.unpricedModels}
            lastRefreshed={lastRefreshed ? lastRefreshed.toISOString() : null}
          />
        </section>
      </div>
    </div>
  );
}
