import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';

const planLabels: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const companyId = daraUser.companyId;

  const [solicitationCount, completedEvaluations] = await Promise.all([
    prisma.solicitation.count({ where: { companyId } }),
    prisma.evaluation.count({ where: { companyId, status: 'complete' } }),
  ]);

  const stats = [
    { label: 'Solicitations', value: solicitationCount.toString() },
    { label: 'Completed Evaluations', value: completedEvaluations.toString() },
    {
      label: 'Plan',
      value: planLabels[daraUser.company.plan] ?? daraUser.company.plan,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-[#7d97b3]">
            Overview for {daraUser.company.name}
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-5"
          >
            <div className="text-sm text-[#7d97b3]">{stat.label}</div>
            <div className="mt-2 text-3xl font-semibold text-white">
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
