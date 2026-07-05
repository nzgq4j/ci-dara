import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, DownloadCloud } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { userTeamIds, solAccessWhere } from '@/utils/dara/sol-access';
import { ModeChip, AiReviewStatus, CountdownChip, ColorTeamStatus } from '@/components/dara/ReviewModeBits';
import { getTrialUsage } from '@/utils/dara/trial';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Deterministic UTC formatters (locale/tz-dependent formatters mismatch server↔client).
function fmtDay(d: Date): string {
  const x = new Date(d);
  return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
}
function daysUntil(d: Date | null, now: number): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - now) / 86_400_000);
}

// Roll a solicitation's reviews into a P1/P2/P3 status map (a pass counts at its strongest
// state across all the sol's reviews).
const PASS_TYPES = ['compliance_format', 'technical_responsiveness', 'risk_competitive'] as const;
function aggPasses(reviews: { passes: { passType: string; status: string }[] }[]): Record<string, string> {
  const rank: Record<string, number> = { not_run: 0, error: 1, running: 2, complete: 3 };
  const byType: Record<string, string> = { compliance_format: 'not_run', technical_responsiveness: 'not_run', risk_competitive: 'not_run' };
  for (const rv of reviews) {
    for (const p of rv.passes) {
      if (!(p.passType in byType)) continue;
      const next = p.status === 'queued' ? 'running' : p.status === 'not_started' ? 'not_run' : p.status;
      const cur = rank[byType[p.passType]] ?? 0;
      if ((rank[next] ?? 0) > cur) byType[p.passType] = next;
    }
  }
  return byType;
}

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  const companyId = daraUser.companyId;

  const [sols, findingAgg, passAgg, directAgg] = await withTenant(companyId, async (tx) => {
    const teamIds = await userTeamIds(tx, daraUser.id);
    const access = solAccessWhere(daraUser.id, daraUser.role, teamIds);
    const solWhere = { companyId, ...access };
    return Promise.all([
      tx.solicitation.findMany({
        where: solWhere,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        include: {
          reviews: { select: { passes: { select: { passType: true, status: true } } } },
          directReviews: { select: { status: true, score: true } }
        }
      }),
      // Company-wide finding severity breakdown (RLS keeps it tenant-scoped).
      tx.finding.groupBy({ by: ['severity'], where: { companyId }, _count: { _all: true } }),
      tx.reviewPass.aggregate({ where: { companyId, status: 'complete' }, _avg: { score: true }, _count: { score: true } }),
      tx.directReview.aggregate({ where: { companyId, status: 'complete' }, _avg: { score: true }, _count: { score: true } })
    ]);
  });

  const now = Date.now();
  const today = fmtDay(new Date(now));

  // Trial status bar data (only for trial accounts — paid plans render nothing).
  const isTrial = daraUser.company.plan === 'trial';
  const trial = isTrial ? await getTrialUsage(companyId) : null;
  const trialDaysLeft = trial?.trialEndsAt
    ? Math.max(0, Math.ceil((trial.trialEndsAt.getTime() - now) / 86_400_000))
    : null;
  const usageFor = (r: 'solicitation' | 'review_run') => trial?.items.find((i) => i.resource === r);
  const solUsage = usageFor('solicitation');
  const runUsage = usageFor('review_run');

  // Per-sol derived data.
  const rows = sols.map((s) => {
    const days = daysUntil(s.dueDate, now);
    const dr = s.directReviews[0];
    const byType = aggPasses(s.reviews);
    const started =
      s.mode === 'direct_ai'
        ? dr != null && dr.status !== 'not_started'
        : Object.values(byType).some((v) => v !== 'not_run');
    return { s, days, dr, byType, started };
  });

  // KPIs.
  const activeReviews = rows.filter((r) => r.started).length;
  const dueSoonRows = rows.filter((r) => r.days != null && r.days <= 7);
  const dueSoon = dueSoonRows.length;
  const dueSoonAgencies = Array.from(new Set(dueSoonRows.map((r) => r.s.agency).filter(Boolean))).slice(0, 3).join(' · ');

  const passSum = (passAgg._avg.score ?? 0) * passAgg._count.score;
  const directSum = (directAgg._avg.score ?? 0) * directAgg._count.score;
  const scoredN = passAgg._count.score + directAgg._count.score;
  const avgCompliance = scoredN > 0 ? Math.round((passSum + directSum) / scoredN) : null;

  const sevCount = (sev: string) => findingAgg.find((f) => f.severity === sev)?._count._all ?? 0;
  const openFindings = findingAgg.reduce((n, f) => n + f._count._all, 0);
  const critFindings = sevCount('critical');
  const highFindings = sevCount('high');

  const kpis = [
    { label: 'Active Reviews', value: activeReviews, color: '#1B2A4A', sub: `${dueSoon} approaching deadline` },
    { label: 'Due ≤ 7 Days', value: dueSoon, color: '#991B1B', sub: dueSoonAgencies || 'none' },
    { label: 'Avg Compliance Score', value: avgCompliance ?? '—', color: '#166534', sub: `${scoredN} completed review${scoredN === 1 ? '' : 's'}` },
    { label: 'Open Findings', value: openFindings, color: '#B45309', sub: `${critFindings} critical / ${highFindings} high` }
  ];

  return (
    <div className="mx-auto max-w-6xl fade">
      {/* Trial status bar — only for trial accounts; disappears entirely once on a paid plan. */}
      {isTrial && trial && (
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-line border-l-4 border-l-gold bg-gold/10 px-4 py-3 text-[13px] text-t2">
          <span className="font-semibold text-navy">
            Trial{trialDaysLeft != null ? ` · ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} remaining` : ''}
          </span>
          {solUsage && (
            <span>
              Solicitations: <span className="font-semibold">{solUsage.used} of {solUsage.limit}</span>
            </span>
          )}
          {runUsage && (
            <span>
              Review runs: <span className="font-semibold">{runUsage.used} of {runUsage.limit}</span>
            </span>
          )}
          <Link href="/app/billing" className="ml-auto font-semibold text-navy hover:underline">
            Upgrade →
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy">Dashboard</h1>
          <p className="text-[13px] text-t4">Active solicitation tracking · As of {today}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            disabled
            title="SAM.gov import — coming soon"
            className="inline-flex cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-lg border border-line px-4 py-2 text-sm font-medium text-t5"
          >
            <DownloadCloud className="h-4 w-4" />
            Import from SAM.gov
          </button>
          <Link
            href="/app/solicitations/new"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy/90"
          >
            <Plus className="h-4 w-4" />
            New Solicitation
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-[10px] border border-line bg-surf p-5">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">{k.label}</div>
            <div className="text-3xl font-bold leading-none" style={{ color: k.color }}>
              {k.value}
            </div>
            <div className="mt-1.5 text-[11px] text-t5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Solicitation tracking table */}
      <div className="overflow-hidden rounded-[10px] border border-line bg-surf">
        {rows.length === 0 ? (
          <div className="px-[18px] py-10 text-center text-[13px] text-t5">
            No solicitations yet.{' '}
            <Link href="/app/solicitations/new" className="text-navy">
              Create one →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="bg-surf3">
                  <th className="px-[18px] py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">Solicitation</th>
                  <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">Agency</th>
                  <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">NAICS</th>
                  <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">Due Date</th>
                  <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">Countdown</th>
                  <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">Review Status</th>
                  <th className="px-3.5 py-2.5 text-right font-mono text-[10px] uppercase tracking-wide text-t5">Report</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, days, dr, byType }) => (
                  <tr key={s.id.toString()} className="border-t border-line align-top transition-colors hover:bg-surf2">
                    <td className="px-[18px] py-3">
                      <Link href={`/app/solicitations/${s.id}`} className="block">
                        <div className="flex items-center gap-2">
                          <ModeChip mode={s.mode} />
                          <span className="text-[13px] font-semibold text-t2">
                            {s.solNumber ? `${s.solNumber} — ${s.title}` : s.title}
                          </span>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3.5 py-3 text-[12px] text-t4">{s.agency || '—'}</td>
                    <td className="px-3.5 py-3 font-mono text-[11px] text-t5">{s.naics || '—'}</td>
                    <td className="px-3.5 py-3 whitespace-nowrap text-[12px] text-t3">{s.dueDate ? fmtDay(s.dueDate) : '—'}</td>
                    <td className="px-3.5 py-3">
                      <CountdownChip days={days} />
                    </td>
                    <td className="px-3.5 py-3">
                      {s.mode === 'direct_ai' ? (
                        <AiReviewStatus status={dr?.status} score={dr?.score} />
                      ) : (
                        <ColorTeamStatus byType={byType} />
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <Link
                        href={`/app/solicitations/${s.id}/report`}
                        className="inline-flex items-center whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-t4 transition-colors hover:border-navy/40 hover:text-navy"
                      >
                        Report →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
