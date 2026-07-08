import { revalidatePath } from 'next/cache';
import { Zap, Ban, Trash2, History } from 'lucide-react';
import { prismaAdmin } from '@/utils/prisma';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import { recordAudit } from '@/utils/dara/audit';
import PageHeader from '@/components/dara/PageHeader';
import ConfirmButton from '@/components/dara/ConfirmButton';
import { card, btnDanger, sectionTitle } from '@/components/dara/theme';

// Kill switch: delete one active background job (shred / compliance / review / reconcile).
// The worker drops the vanished row and does not requeue it — the manual equivalent of a
// runaway shred stopping itself. Cross-tenant, so it runs on prismaAdmin like the rest.
async function killJob(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const id = BigInt(String(formData.get('jobId')));
  const job = await prismaAdmin.jobQueue.findUnique({ where: { id } });
  if (!job) {
    revalidatePath('/app/admin/jobs');
    return;
  }
  await prismaAdmin.jobQueue.delete({ where: { id } });
  await recordAudit({
    action: 'admin.job.kill',
    companyId: job.companyId,
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'job_queue',
    entityId: id,
    metadata: {
      jobType: job.jobType,
      kind: (job.payload as { kind?: string } | null)?.kind ?? null,
      status: job.status,
      attempts: job.attempts
    }
  });
  revalidatePath('/app/admin/jobs');
}

// Kill switch (nuclear): stop every active background job across all accounts.
async function killAllJobs() {
  'use server';
  const admin = await requirePlatformAdmin();
  const active = await prismaAdmin.jobQueue.findMany({
    where: { status: { in: ['pending', 'running'] } },
    select: { id: true }
  });
  if (active.length === 0) {
    revalidatePath('/app/admin/jobs');
    return;
  }
  await prismaAdmin.jobQueue.deleteMany({ where: { id: { in: active.map((j) => j.id) } } });
  await recordAudit({
    action: 'admin.job.kill_all',
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'platform',
    metadata: { killed: active.length }
  });
  revalidatePath('/app/admin/jobs');
}

type JobPayload = {
  kind?: string;
  solicitationId?: string;
  reviewId?: string;
  passId?: string;
  amendmentId?: string;
  directReviewId?: string;
};

function entityIdOf(p: JobPayload): string {
  return p.solicitationId ?? p.reviewId ?? p.passId ?? p.amendmentId ?? p.directReviewId ?? '';
}

export default async function AdminJobsPage() {
  await requirePlatformAdmin();

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [activeJobs, recentJobs] = await Promise.all([
    prismaAdmin.jobQueue.findMany({
      where: { status: { in: ['pending', 'running'] } },
      orderBy: [{ status: 'asc' }, { availableAt: 'asc' }],
      include: { company: { select: { name: true } } }
    }),
    prismaAdmin.jobQueue.findMany({
      where: { status: { in: ['done', 'failed'] }, finishedAt: { gte: dayAgo } },
      orderBy: { finishedAt: 'desc' },
      take: 100,
      include: { company: { select: { name: true } } }
    })
  ]);

  return (
    <div className="fade">
      <PageHeader
        eyebrow="Platform"
        title="Background jobs"
        subtitle={`${activeJobs.length} active · ${recentJobs.length} finished in the last 24h`}
      />

      <div className="space-y-8">
        {/* Active jobs — operator kill switch for runaway shred / compliance / review jobs */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Zap className="h-4 w-4 text-t5" />Active jobs{' '}
            <span className="font-mono text-[11px] font-normal text-t5">({activeJobs.length})</span>
          </h2>
          <p className="text-[12px] text-t4">
            Active shred, compliance-check, review, and reconcile jobs across all accounts. Kill a
            job to stop a runaway — e.g. a shred that keeps amassing requirements. The worker drops
            the row and does not requeue it. High attempt counts flag a job that keeps resuming.
          </p>
          {activeJobs.length === 0 ? (
            <div className={`${card} p-4 text-[12px] text-t4`}>No active background jobs.</div>
          ) : (
            <>
              <div className="space-y-2">
                {activeJobs.map((j) => {
                  const p = (j.payload ?? {}) as JobPayload;
                  const entity = entityIdOf(p);
                  const ageMin = Math.max(
                    0,
                    Math.round((Date.now() - new Date(j.startedAt ?? j.availableAt).getTime()) / 60000)
                  );
                  return (
                    <div key={j.id.toString()} className={`${card} flex flex-wrap items-center gap-3 p-3`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-t1">{p.kind ?? j.jobType}</span>
                          {entity && <span className="font-mono text-[11px] text-t5">#{entity}</span>}
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                              j.status === 'running' ? 'bg-[#DBEAFE] text-[#1E40AF]' : 'bg-line text-t4'
                            }`}
                          >
                            {j.status}
                          </span>
                          {j.attempts > 3 && (
                            <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#991B1B]">
                              {j.attempts} attempts
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-t5">
                          {j.company.name} · started {ageMin}m ago · attempts {j.attempts}
                          {j.progressLabel ? ` · ${j.progressLabel}` : ''}
                        </div>
                      </div>
                      <form action={killJob}>
                        <input type="hidden" name="jobId" value={j.id.toString()} />
                        <ConfirmButton
                          message={`Kill this ${p.kind ?? j.jobType} job for ${j.company.name}? It stops immediately and will not requeue.`}
                          className={btnDanger}
                        >
                          <Trash2 className="h-4 w-4" />Kill
                        </ConfirmButton>
                      </form>
                    </div>
                  );
                })}
              </div>
              <form action={killAllJobs} className="flex justify-end">
                <ConfirmButton
                  message={`Kill ALL ${activeJobs.length} active background jobs across every account? This stops every shred, compliance check, and review in flight.`}
                  className={btnDanger}
                >
                  <Ban className="h-4 w-4" />Kill all active jobs
                </ConfirmButton>
              </form>
            </>
          )}
        </section>

        {/* Last-24h history — read-only accounting of what finished (done or failed) */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <History className="h-4 w-4 text-t5" />Last 24 hours{' '}
            <span className="font-mono text-[11px] font-normal text-t5">({recentJobs.length})</span>
          </h2>
          {recentJobs.length === 0 ? (
            <div className={`${card} p-4 text-[12px] text-t4`}>No jobs finished in the last 24 hours.</div>
          ) : (
            <div className="space-y-2">
              {recentJobs.map((j) => {
                const p = (j.payload ?? {}) as JobPayload;
                const entity = entityIdOf(p);
                const finishedMin = j.finishedAt
                  ? Math.max(0, Math.round((Date.now() - new Date(j.finishedAt).getTime()) / 60000))
                  : null;
                return (
                  <div key={j.id.toString()} className={`${card} flex flex-wrap items-center gap-3 p-3`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-t2">{p.kind ?? j.jobType}</span>
                        {entity && <span className="font-mono text-[11px] text-t5">#{entity}</span>}
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                            j.status === 'done' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEE2E2] text-[#991B1B]'
                          }`}
                        >
                          {j.status}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-t5">
                        {j.company.name}
                        {finishedMin != null ? ` · finished ${finishedMin}m ago` : ''}
                        {' · '}attempts {j.attempts}
                        {j.status === 'failed' && j.error ? ` · ${j.error.slice(0, 140)}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
