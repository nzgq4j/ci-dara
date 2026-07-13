import { revalidatePath } from 'next/cache';
import { RefreshCw } from 'lucide-react';
import { prismaAdmin } from '@/utils/prisma';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import { recordAudit } from '@/utils/dara/audit';
import { enqueueClauseSync } from '@/utils/dara/passes';
import PageHeader from '@/components/dara/PageHeader';
import { card, sectionTitle } from '@/components/dara/theme';

export const dynamic = 'force-dynamic';

// UTC-deterministic timestamp (toLocaleDateString is banned in SSR — hydration-unsafe).
function fmtDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// Enqueue the global GSA clause-library sync (Modal clones the repos + parses DITA; the worker upserts).
// Async because a 32-repo clone/parse runs well past a request budget.
async function syncClausesAction() {
  'use server';
  const admin = await requirePlatformAdmin();
  const u = await prismaAdmin.daraUser.findFirst({ where: { email: admin.email }, select: { companyId: true } });
  if (!u) return;
  await enqueueClauseSync(u.companyId);
  await recordAudit({
    action: 'admin.clauses.sync',
    companyId: u.companyId,
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'clause_library',
    entityId: BigInt(0)
  });
  revalidatePath('/app/admin/clauses');
}

export default async function AdminClausesPage() {
  await requirePlatformAdmin();

  const [clauseCount, versionCount, byType, activeSync, lastUpdated] = await Promise.all([
    prismaAdmin.daraClauseLibrary.count(),
    prismaAdmin.daraClauseVersion.count(),
    prismaAdmin.daraClauseLibrary.groupBy({ by: ['citationType'], _count: { _all: true } }),
    prismaAdmin.jobQueue.findFirst({
      where: { status: { in: ['pending', 'running'] } },
      orderBy: { id: 'desc' }
    }),
    prismaAdmin.daraClauseLibrary.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
  ]);
  const syncing = (activeSync?.payload as { kind?: string } | null)?.kind === 'sync_clauses';

  const types = [...byType].sort((a, b) => b._count._all - a._count._all);

  return (
    <div className="space-y-4">
      <PageHeader title="Regulatory clause library" subtitle="IbR source of truth for the deterministic shred (Pass 3)" />

      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className={sectionTitle}>Library contents</h2>
            <p className="mt-1 text-[13px] text-t4">
              {clauseCount.toLocaleString()} clauses · {versionCount.toLocaleString()} versions
              {lastUpdated?.updatedAt ? ` · updated ${fmtDateTime(lastUpdated.updatedAt)}` : ''}
            </p>
          </div>
          <form action={syncClausesAction}>
            <button
              type="submit"
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-md bg-navy px-3 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sync in progress…' : 'Sync from GSA repositories'}
            </button>
          </form>
        </div>

        {types.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {types.map((t) => (
              <div key={t.citationType} className="rounded-md border border-line bg-surf2 px-3 py-2">
                <div className="font-mono text-[11px] uppercase tracking-wide text-t5">{t.citationType}</div>
                <div className="text-[15px] font-bold text-t2">{t._count._all.toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {clauseCount === 0 && (
          <p className="mt-4 rounded-md border border-line bg-surf2 px-3 py-2 text-[12px] text-t4">
            The library is empty. Run a sync to clone the GSA acquisition-regulation repositories and populate the
            clause versions. Requires the Modal <code>sync_clause_library</code> endpoint (set{' '}
            <code>MODAL_CLAUSE_SYNC_URL</code>).
          </p>
        )}
      </div>
    </div>
  );
}
