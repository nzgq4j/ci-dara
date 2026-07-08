import Link from 'next/link';
import { Activity, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import { getUsageReport, normalizeUsageDays } from '@/utils/dara/usage';
import { CAPABILITY_LABELS } from '@/utils/dara/capability-model';
import PageHeader from '@/components/dara/PageHeader';
import { card, sectionTitle } from '@/components/dara/theme';

const RANGES = [
  { days: 0, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' }
];

const nf = new Intl.NumberFormat('en-US');

function StatCard({
  label,
  value,
  icon
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-t1">{value}</div>
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
  const report = await getUsageReport(days, new Date());
  const { totals } = report;

  return (
    <div className="fade">
      <PageHeader
        eyebrow="Platform"
        title="AI usage"
        subtitle={`${nf.format(totals.calls)} calls · ${nf.format(totals.tokenIn + totals.tokenOut)} tokens since ${report.since.toLocaleString()}`}
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
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Calls" value={nf.format(totals.calls)} icon={<Activity className="h-3.5 w-3.5" />} />
        <StatCard label="Tokens in" value={nf.format(totals.tokenIn)} icon={<TrendingDown className="h-3.5 w-3.5" />} />
        <StatCard label="Tokens out" value={nf.format(totals.tokenOut)} icon={<TrendingUp className="h-3.5 w-3.5" />} />
        <StatCard label="Failed calls" value={nf.format(totals.failures)} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
      </div>

      <div className="space-y-8">
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
                  </tr>
                </thead>
                <tbody>
                  {report.byCapability.map((r) => (
                    <tr key={r.capability} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 text-t1">{CAPABILITY_LABELS[r.capability] ?? r.capability}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.calls)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.tokenIn)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-t2">{nf.format(r.tokenOut)}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
