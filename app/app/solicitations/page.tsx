import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';

export default async function SolicitationsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const solicitations = await prisma.solicitation.findMany({
    where: { companyId: daraUser.companyId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { criteria: true, responses: true, evaluations: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Solicitations</h1>
          <p className="text-sm text-[#7d97b3]">
            Manage your government proposal evaluations
          </p>
        </div>
        <Link
          href="/app/solicitations/new"
          className="inline-flex items-center gap-2 rounded-md bg-[#378ADD] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f78c2]"
        >
          <Plus className="h-4 w-4" />
          New Solicitation
        </Link>
      </div>

      {solicitations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] px-6 py-16 text-center">
          <FileText className="h-10 w-10 text-[#7d97b3]" />
          <p className="mt-4 text-sm text-[#7d97b3]">
            No solicitations yet. Create your first one to get started.
          </p>
          <Link
            href="/app/solicitations/new"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#378ADD] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f78c2]"
          >
            <Plus className="h-4 w-4" />
            New Solicitation
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#1a2f4a] bg-[#0d1527]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#1a2f4a] text-xs uppercase tracking-wide text-[#7d97b3]">
              <tr>
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Sol. Number</th>
                <th className="px-5 py-3 font-medium">Agency</th>
                <th className="px-5 py-3 text-center font-medium">Criteria</th>
                <th className="px-5 py-3 text-center font-medium">Offerors</th>
                <th className="px-5 py-3 text-center font-medium">Evaluations</th>
              </tr>
            </thead>
            <tbody>
              {solicitations.map((sol) => (
                <tr
                  key={sol.id.toString()}
                  className="border-b border-[#1a2f4a] last:border-0 transition-colors hover:bg-[#1a2f4a]/30"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/app/solicitations/${sol.id}`}
                      className="font-medium text-white hover:text-[#378ADD]"
                    >
                      {sol.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-[#7d97b3]">
                    {sol.solNumber || '—'}
                  </td>
                  <td className="px-5 py-3 text-[#7d97b3]">
                    {sol.agency || '—'}
                  </td>
                  <td className="px-5 py-3 text-center text-[#7d97b3]">
                    {sol._count.criteria}
                  </td>
                  <td className="px-5 py-3 text-center text-[#7d97b3]">
                    {sol._count.responses}
                  </td>
                  <td className="px-5 py-3 text-center text-[#7d97b3]">
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
