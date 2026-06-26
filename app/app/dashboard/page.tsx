import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';

const planLabels: Record<string, string> = {
  trial: 'Trial',
  starter: 'Base',
  pro: 'Pro',
  enterprise: 'Enterprise'
};

const evBadge: Record<string, string> = {
  pending: 'bg-[#1a2f4a] text-[#7d97b3]',
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
  ] = await Promise.all([
    prisma.solicitation.count({ where: { companyId } }),
    prisma.response.count({ where: { companyId } }),
    prisma.evaluation.count({ where: { companyId } }),
    prisma.persona.count({ where: { companyId, isActive: true } }),
    prisma.solicitation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { _count: { select: { criteria: true, responses: true } } }
    }),
    prisma.evaluation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { response: true }
    }),
    prisma.persona.findMany({ where: { companyId }, select: { id: true, displayName: true } })
  ]);

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
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[#3d5270]">
            {today}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f0f4ff]">
            {greeting}, {firstName}.
          </h1>
          <p className="text-[13px] text-[#7d97b3]">
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
            className="rounded-[10px] border border-[#1a2f4a] bg-[#0d1527] p-5"
            style={{ borderTop: `3px solid ${s.color}` }}
          >
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[#3d5270]">
              {s.label}
            </div>
            <div className="text-3xl font-bold leading-none" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="mt-1 text-[11px] text-[#3d5270]">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Two-column */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Recent solicitations */}
        <div className="overflow-hidden rounded-[10px] border border-[#1a2f4a] bg-[#0d1527]">
          <div className="flex items-center justify-between border-b border-[#1a2f4a] px-[18px] py-3.5">
            <div className="text-[13px] font-bold text-[#e8eef7]">Recent Solicitations</div>
            <Link href="/app/solicitations" className="text-[11px] text-[#3b6ef0]">
              View all →
            </Link>
          </div>
          {recentSolicitations.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-[12px] text-[#3d5270]">
              No solicitations yet.{' '}
              <Link href="/app/solicitations/new" className="text-[#3b6ef0]">
                Create one →
              </Link>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#09101e]">
                  <th className="px-[18px] py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-[#3d5270]">
                    Title
                  </th>
                  <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-[#3d5270]">
                    Reference
                  </th>
                  <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-[#3d5270]">
                    Criteria
                  </th>
                  <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-[#3d5270]">
                    Offerors
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentSolicitations.map((sol) => (
                  <tr
                    key={sol.id.toString()}
                    className="border-t border-[#1a2f4a] transition-colors hover:bg-[#0f1c2e]"
                  >
                    <td className="px-[18px] py-3">
                      <Link href={`/app/solicitations/${sol.id}`} className="block">
                        <div className="text-[13px] font-semibold text-[#cbd5e1]">{sol.title}</div>
                        <div className="mt-0.5 text-[11px] text-[#3d5270]">{sol.agency || '—'}</div>
                      </Link>
                    </td>
                    <td className="px-3.5 py-3 font-mono text-[11px] text-[#3d5270]">
                      {sol.solNumber || '—'}
                    </td>
                    <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-[#94a3b8]">
                      {sol._count.criteria}
                    </td>
                    <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-[#94a3b8]">
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
          <div className="overflow-hidden rounded-[10px] border border-[#1a2f4a] bg-[#0d1527]">
            <div className="flex items-center justify-between border-b border-[#1a2f4a] px-[18px] py-3.5">
              <div className="text-[13px] font-bold text-[#e8eef7]">Recent Evaluations</div>
            </div>
            {recentEvaluations.length === 0 ? (
              <div className="px-[18px] py-6 text-center text-[12px] text-[#3d5270]">
                No evaluations yet.
              </div>
            ) : (
              recentEvaluations.map((ev) => (
                <div
                  key={ev.id.toString()}
                  className="flex items-center gap-2.5 border-t border-[#1a2f4a] px-[18px] py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-[#cbd5e1]">
                      {ev.response?.offerorName ?? '—'}
                    </div>
                    <div className="truncate text-[10px] text-[#3d5270]">
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
          <div className="rounded-[10px] border border-[#1a2f4a] bg-[#0d1527] p-[18px]">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[#3b6ef0]">
              Plan — {planLabels[daraUser.company.plan] ?? daraUser.company.plan}
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[#7d97b3]">Status</span>
              <span className="font-mono text-[#94a3b8]">{daraUser.company.planStatus}</span>
            </div>
            <Link
              href="/app/billing"
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-[#1a2f4a] py-2 text-[12px] text-[#7d97b3] transition-colors hover:text-[#e8eef7]"
            >
              Manage plan →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
