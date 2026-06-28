import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import PageHeader from '@/components/dara/PageHeader';
import { card, cardDashed, btnPrimary } from '@/components/dara/theme';

export default async function SolicitationsPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const solicitations = await withTenant(daraUser.companyId, (tx) =>
    tx.solicitation.findMany({
      // companyId filter kept as defense-in-depth alongside RLS (DARA-004).
      where: { companyId: daraUser.companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { criteria: true, responses: true, evaluations: true }
        }
      }
    })
  );

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
                <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                  Criteria
                </th>
                <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                  Offerors
                </th>
                <th className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                  Evaluations
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
                    <Link
                      href={`/app/solicitations/${sol.id}`}
                      className="text-[13px] font-semibold text-t2 transition-colors hover:text-[#3b6ef0]"
                    >
                      {sol.title}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 font-mono text-[11px] text-t5">
                    {sol.solNumber || '—'}
                  </td>
                  <td className="px-3.5 py-3 text-[12px] text-t4">
                    {sol.agency || '—'}
                  </td>
                  <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                    {sol._count.criteria}
                  </td>
                  <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                    {sol._count.responses}
                  </td>
                  <td className="px-3.5 py-3 text-center text-[13px] font-semibold text-t3">
                    {sol._count.evaluations}
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
