import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';
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

  const solicitation = await prisma.solicitation.create({
    data: {
      companyId: daraUser.companyId,
      title,
      solNumber,
      agency,
      notes: notes || null,
      createdBy: daraUser.id
    }
  });

  redirect(`/app/solicitations/${solicitation.id}`);
}

export default function NewSolicitationPage() {
  return (
    <div className="mx-auto max-w-2xl fade">
      <Link
        href="/app/solicitations"
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-[#7d97b3] transition-colors hover:text-[#e8eef7]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Solicitations
      </Link>
      <h1 className="text-2xl font-bold tracking-tight text-[#f0f4ff]">
        New Solicitation
      </h1>
      <p className="mb-7 text-[13px] text-[#7d97b3]">
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
