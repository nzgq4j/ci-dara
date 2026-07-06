import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { userTeamIds, solAccessWhere, canViewSolicitation } from '@/utils/dara/sol-access';
import { recordAudit } from '@/utils/dara/audit';
import { removeStored } from '@/utils/dara/documents';
import PageHeader from '@/components/dara/PageHeader';
import { card, cardDashed, btnPrimary } from '@/components/dara/theme';
import { ModeChip, AiReviewStatus, AiReviewAction } from '@/components/dara/ReviewModeBits';
import DeleteSolButton from '@/components/dara/DeleteSolButton';

// Delete a solicitation from the central list. Gated to users who can see it (RLS + the
// department-access rule), audited, and done inside the tenant transaction.
async function deleteSolicitationAction(formData: FormData) {
  'use server';
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  const id = BigInt(String(formData.get('solId')));

  const result = await withTenant(daraUser.companyId, async (tx) => {
    const sol = await tx.solicitation.findFirst({
      where: { id, companyId: daraUser.companyId },
      include: { departments: { select: { teamId: true } } }
    });
    if (!sol) return null;
    const teamSet = new Set(await userTeamIds(tx, daraUser.id));
    if (!canViewSolicitation(daraUser.id, daraUser.role, sol.createdBy, sol.departments.map((d) => d.teamId), teamSet)) {
      return null;
    }
    // SEC-07 (NIST MP-6 / SI-12): gather every stored CUI blob BEFORE the cascade drops the
    // DB pointers. DB rows cascade on delete; Storage objects do not — leaving them orphans
    // full CUI (RFP/proposal/amendment PDFs+DOCX and per-review response drafts) in the
    // bucket with nothing pointing at it. SolDocument covers rfp/proposal/amendment docs;
    // ReviewDocument covers each color-team review's response draft.
    const [solDocs, reviewDocs] = await Promise.all([
      tx.solDocument.findMany({
        where: { solicitationId: id, companyId: daraUser.companyId },
        select: { storedFilename: true }
      }),
      tx.reviewDocument.findMany({
        where: { companyId: daraUser.companyId, review: { solicitationId: id } },
        select: { storedFilename: true }
      })
    ]);
    const stored = [...solDocs, ...reviewDocs].map((d) => d.storedFilename).filter(Boolean);
    await tx.solicitation.delete({ where: { id } });
    return { stored };
  });

  if (result) {
    // Storage I/O outside the transaction (matches deleteSolDoc / deleteAmendment).
    await removeStored(result.stored);
    await recordAudit({
      action: 'solicitation.delete',
      companyId: daraUser.companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'solicitation',
      entityId: id,
      metadata: { removedFiles: result.stored.length }
    });
  }
  revalidatePath('/app/solicitations');
}

export default async function SolicitationsPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const solicitations = await withTenant(daraUser.companyId, async (tx) => {
    // Department-scoped visibility: admins see all; others see their own + any
    // assigned to a department they belong to (app-layer; company RLS is the DB
    // backstop). companyId filter kept as defense-in-depth alongside RLS (DARA-004).
    const teamIds = await userTeamIds(tx, daraUser.id);
    return tx.solicitation.findMany({
      where: {
        companyId: daraUser.companyId,
        ...solAccessWhere(daraUser.id, daraUser.role, teamIds)
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { requirements: true, reviews: true, evaluations: true } },
        departments: { include: { team: { select: { name: true } } } },
        directReviews: { select: { status: true, score: true } }
      }
    });
  });

  return (
    <div className="mx-auto max-w-6xl fade">
      <PageHeader
        eyebrow="Workspace"
        title="Solicitations"
        subtitle="Manage your government proposal evaluations."
        action={
          <Link href="/app/solicitations/new" className={btnPrimary}>
            <Plus className="h-4 w-4" />
            New Solicitation
          </Link>
        }
      />

      {solicitations.length === 0 ? (
        <div
          className={`${cardDashed} flex flex-col items-center justify-center px-6 py-16 text-center`}
        >
          <FileText className="h-10 w-10 text-t5" />
          <p className="mt-4 text-sm text-t4">
            No solicitations yet. Create your first one to get started.
          </p>
          <Link
            href="/app/solicitations/new"
            className={`${btnPrimary} mt-4`}
          >
            <Plus className="h-4 w-4" />
            New Solicitation
          </Link>
        </div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surf3">
                <th className="px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Title
                </th>
                <th className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Reference
                </th>
                <th className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Agency
                </th>
                <th className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Departments
                </th>
                <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                  Reqs
                </th>
                <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                  Reviews
                </th>
                <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                  Evaluations
                </th>
                <th className="px-3.5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wide text-t5">
                  AI Review
                </th>
                <th className="px-3.5 py-2.5 text-right font-mono text-[10px] uppercase tracking-wide text-t5">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {solicitations.map((sol) => (
                <tr
                  key={sol.id.toString()}
                  className="border-t border-line transition-colors hover:bg-surf2"
                >
                  <td className="px-[18px] py-3">
                    <div className="flex items-center gap-2">
                      <ModeChip mode={sol.mode} />
                      <Link
                        href={`/app/solicitations/${sol.id}`}
                        className="text-[13px] font-semibold text-t2 transition-colors hover:text-navy"
                      >
                        {sol.title}
                      </Link>
                    </div>
                  </td>
                  <td className="px-3.5 py-3 font-mono text-[11px] text-t5">
                    {sol.solNumber || '—'}
                  </td>
                  <td className="px-3.5 py-3 text-[12px] text-t4">
                    {sol.agency || '—'}
                  </td>
                  <td className="px-3.5 py-3">
                    {sol.departments.length === 0 ? (
                      <span className="font-mono text-[11px] text-t5">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {sol.departments.map((d) => (
                          <span
                            key={d.id.toString()}
                            className="inline-flex items-center rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-t3"
                          >
                            {d.team.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                    {sol._count.requirements}
                  </td>
                  <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                    {sol._count.reviews}
                  </td>
                  <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                    {sol._count.evaluations}
                  </td>
                  <td className="px-3.5 py-3">
                    {sol.mode === 'direct_ai' ? (
                      <AiReviewStatus
                        status={sol.directReviews[0]?.status}
                        score={sol.directReviews[0]?.score}
                      />
                    ) : (
                      <span className="font-mono text-[11px] text-t5">Color Team</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {sol.mode === 'direct_ai' ? (
                        <AiReviewAction solId={sol.id.toString()} status={sol.directReviews[0]?.status} />
                      ) : (
                        <Link
                          href={`/app/solicitations/${sol.id}`}
                          className="inline-flex items-center whitespace-nowrap rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-t4 transition-colors hover:border-navy/50 hover:text-t1"
                        >
                          Open
                        </Link>
                      )}
                      <DeleteSolButton
                        solId={sol.id.toString()}
                        title={sol.title}
                        action={deleteSolicitationAction}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
