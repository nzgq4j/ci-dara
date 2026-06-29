import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import {
  card,
  fieldClasses,
  labelClasses,
  btnPrimary,
  btnGhost
} from '@/components/dara/theme';

async function createSolicitation(formData: FormData) {
  'use server';

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  const title = String(formData.get('title') ?? '').trim();
  const solNumber = String(formData.get('sol_number') ?? '').trim();
  const agency = String(formData.get('agency') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  if (!title) redirect('/app/solicitations/new');

  const teamIds = formData
    .getAll('dept')
    .map((v) => String(v))
    .filter((v) => /^\d+$/.test(v))
    .map((v) => BigInt(v));

  const solicitation = await withTenant(daraUser.companyId, async (tx) => {
    const sol = await tx.solicitation.create({
      data: {
        companyId: daraUser.companyId,
        title,
        solNumber,
        agency,
        notes: notes || null,
        createdBy: daraUser.id
      }
    });
    if (teamIds.length) {
      const valid = await tx.team.findMany({
        where: { id: { in: teamIds }, companyId: daraUser.companyId },
        select: { id: true }
      });
      if (valid.length) {
        await tx.solicitationDepartment.createMany({
          data: valid.map((t) => ({ companyId: daraUser.companyId, solicitationId: sol.id, teamId: t.id }))
        });
      }
    }
    return sol;
  });

  await recordAudit({
    action: 'solicitation.create',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'solicitation',
    entityId: solicitation.id,
    metadata: { title }
  });

  redirect(`/app/solicitations/${solicitation.id}`);
}

export default async function NewSolicitationPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  const teams = await withTenant(daraUser.companyId, (tx) =>
    tx.team.findMany({ where: { companyId: daraUser.companyId }, orderBy: { name: 'asc' } })
  );

  return (
    <div className="mx-auto max-w-2xl fade">
      <Link
        href="/app/solicitations"
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-t4 transition-colors hover:text-t1"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Solicitations
      </Link>
      <h1 className="text-2xl font-bold tracking-tight text-t1">
        New Solicitation
      </h1>
      <p className="mb-7 text-[13px] text-t4">
        Create a solicitation to start evaluating proposals.
      </p>

      <form action={createSolicitation} className={`${card} space-y-5 p-6`}>
        <div className="space-y-1.5">
          <label htmlFor="title" className={labelClasses}>
            Title <span className="text-[#3b6ef0]">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            placeholder="e.g. IT Modernization Services"
            className={fieldClasses}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="sol_number" className={labelClasses}>
              Solicitation Number
            </label>
            <input
              id="sol_number"
              name="sol_number"
              type="text"
              placeholder="e.g. RFP-2026-0042"
              className={fieldClasses}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agency" className={labelClasses}>
              Agency
            </label>
            <input
              id="agency"
              name="agency"
              type="text"
              placeholder="e.g. Department of Defense"
              className={fieldClasses}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="notes" className={labelClasses}>
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="Optional context or internal notes"
            className={fieldClasses}
          />
        </div>

        {teams.length > 0 && (
          <div className="space-y-1.5">
            <label className={labelClasses}>Departments</label>
            <p className="text-[12px] text-t5">
              Choose which departments can see this solicitation. Leave empty and only
              you (and company admins) will see it until you assign one.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {teams.map((t) => (
                <label
                  key={t.id.toString()}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-t3 transition-colors hover:border-[#3b6ef0]/40 has-[:checked]:border-[#3b6ef0] has-[:checked]:bg-[#3b6ef0]/5 has-[:checked]:text-t1"
                >
                  <input type="checkbox" name="dept" value={t.id.toString()} className="peer sr-only" />
                  <span className="h-2 w-2 rounded-full bg-t5 peer-checked:bg-[#3b6ef0]" />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <Link href="/app/solicitations" className={btnGhost}>
            Cancel
          </Link>
          <button type="submit" className={btnPrimary}>
            <Plus className="h-4 w-4" />
            Create Solicitation
          </button>
        </div>
      </form>
    </div>
  );
}
