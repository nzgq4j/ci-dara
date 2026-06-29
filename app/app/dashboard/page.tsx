import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { userTeamIds, solAccessWhere } from '@/utils/dara/sol-access';

const planLabels: Record<string, string> = {
  trial: 'Trial',
  starter: 'Base',
  pro: 'Pro',
  enterprise: 'Enterprise'
};

const evBadge: Record<string, string> = {
  pending: 'bg-line text-t4',
  running: 'bg-[#3b6ef0]/20 text-[#6f9bf5]',
  complete: 'bg-[#1f5a31]/30 text-[#7de0a0]',
  failed: 'bg-[#5a1f1f]/30 text-[#e07d7d]'
};

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  const companyId = daraUser.companyId;

  const [
    solicitationCount,
    offerorCount,
    evaluationCount,
    activePersonaCount,
    recentSolicitations,
    recentEvaluations,
    personas
  ] = await withTenant(companyId, async (tx) => {
    // Stats reflect only solicitations this user can see (department-scoped).
    const teamIds = await userTeamIds(tx, daraUser.id);
    const access = solAccessWhere(daraUser.id, daraUser.role, teamIds);
    const solWhere = { companyId, ...access };
    return Promise.all([
      // companyId filters kept as defense-in-depth alongside RLS (DARA-004).
      tx.solicitation.count({ where: solWhere }),
      tx.response.count({ where: { companyId, solicitation: access } }),
      tx.evaluation.count({ where: { companyId, solicitation: access } }),
      tx.persona.count({ where: { companyId, isActive: true } }),
      tx.solicitation.findMany({
        where: solWhere,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { _count: { select: { criteria: true, responses: true } } }
      }),
      tx.evaluation.findMany({
        where: { companyId, solicitation: access },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { response: true }
      }),
      tx.persona.findMany({ where: { companyId }, select: { id: true, displayName: true } })
    ]);
  });

  const personaMap = new Map(personas.map((p) => [p.id.toString(), p.displayName]));

  const firstName = (daraUser.name || daraUser.email).split(/[\s@]/)[0];
  const hour = new Date().getUTCHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const stats = [
    { label: 'Solicitations', value: solicitationCount, color: '#3b6ef0', sub: 'total packages' },
    { label: 'Offerors', value: offerorCount, color: '#7c3aed', sub: 'across solicitations' },
    { label: 'Evaluations', value: evaluationCount, color: '#f59e0b', sub: 'run to date' },
    { label: 'Active Personas', value: activePersonaCount, color: '#10b981', sub: 'evaluator panel' }
  ];

  return (
    <div className="mx-auto max-w-6xl fade">
      {/* Header */}
      <div className="mb-7 flex items-start justify-between">
        <div>
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-t5">
            {today}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-t1">
            {greeting}, {firstName}.
          </h1>
          <p className="text-[13px] text-t4">
            Here&apos;s a snapshot of your evaluation activity.
          </p>
        </div>
        <Link
          href="/app/solicitations/new"
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-[#3b6ef0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2f5fd6]"
        >
          <Plus className="h-4 w-4" />
          New Solicitation
        </Link>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-[10px] border border-line bg-surf p-5"
            style={{ borderTop: `3px solid ${s.color}` }}
          >
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
              {s.label}
            </div>
            <div className="text-3xl font-bold leading-none" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="mt-1 text-[11px] text-t5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Two-column */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Recent solicitations */}
        <div className="overflow-hidden rounded-[10px] border border-line bg-surf">
          <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
            <div className="text-[13px] font-bold text-t1">Recent Solicitations</div>
            <Link href="/app/solicitations" className="text-[11px] text-[#3b6ef0]">
              View all →
            </Link>
          </div>
          {recentSolicitations.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-[12px] text-t5">
              No solicitations yet.{' '}
              <Link href="/app/solicitations/new" className="text-[#3b6ef0]">
                Create one →
              </Link>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surf3">
                  <th className="px-[18px] py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">
                    Title
                  </th>
                  <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">
                    Reference
                  </th>
                  <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                    Criteria
                  </th>
                  <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                    Offerors
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentSolicitations.map((sol) => (
                  <tr
                    key={sol.id.toString()}
                    className="border-t border-line transition-colors hover:bg-surf2"
                  >
                    <td className="px-[18px] py-3">
                      <Link href={`/app/solicitations/${sol.id}`} className="block">
                        <div className="text-[13px] font-semibold text-t2">{sol.title}</div>
                        <div className="mt-0.5 text-[11px] text-t5">{sol.agency || '—'}</div>
                      </Link>
                    </td>
                    <td className="px-3.5 py-3 font-mono text-[11px] text-t5">
                      {sol.solNumber || '—'}
                    </td>
                    <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                      {sol._count.criteria}
                    </td>
                    <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                      {sol._count.responses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3.5">
          <div className="overflow-hidden rounded-[10px] border border-line bg-surf">
            <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
              <div className="text-[13px] font-bold text-t1">Recent Evaluations</div>
            </div>
            {recentEvaluations.length === 0 ? (
              <div className="px-[18px] py-6 text-center text-[12px] text-t5">
                No evaluations yet.
              </div>
            ) : (
              recentEvaluations.map((ev) => (
                <div
                  key={ev.id.toString()}
                  className="flex items-center gap-2.5 border-t border-line px-[18px] py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-t2">
                      {ev.response?.offerorName ?? '—'}
                    </div>
                    <div className="truncate text-[10px] text-t5">
                      {personaMap.get(ev.personaId.toString()) ?? 'Persona'}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                      evBadge[ev.status] ?? evBadge.pending
                    }`}
                  >
                    {ev.status}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Plan panel */}
          <div className="rounded-[10px] border border-line bg-surf p-[18px]">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[#3b6ef0]">
              Plan — {planLabels[daraUser.company.plan] ?? daraUser.company.plan}
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-t4">Status</span>
              <span className="font-mono text-t3">{daraUser.company.planStatus}</span>
            </div>
            <Link
              href="/app/billing"
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-line py-2 text-[12px] text-t4 transition-colors hover:text-t1"
            >
              Manage plan →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
