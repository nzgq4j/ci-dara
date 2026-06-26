import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';

async function createSolicitation(formData: FormData) {
  'use server';

  const supabase = createClient();
  const {
    data: { user },
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
      createdBy: daraUser.id,
    },
  });

  redirect(`/app/solicitations/${solicitation.id}`);
}

const fieldClasses =
  'w-full rounded-md border border-[#1a2f4a] bg-[#070c16] px-3 py-2 text-sm text-white placeholder:text-[#7d97b3] focus:border-[#378ADD] focus:outline-none focus:ring-1 focus:ring-[#378ADD]';

export default function NewSolicitationPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/app/solicitations"
          className="inline-flex items-center gap-2 text-sm text-[#7d97b3] transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Solicitations
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-white">
          New Solicitation
        </h1>
        <p className="text-sm text-[#7d97b3]">
          Create a solicitation to start evaluating proposals.
        </p>
      </div>

      <form
        action={createSolicitation}
        className="space-y-5 rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-6"
      >
        <div className="space-y-1.5">
          <label htmlFor="title" className="text-sm font-medium text-white">
            Title <span className="text-[#378ADD]">*</span>
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

        <div className="space-y-1.5">
          <label
            htmlFor="sol_number"
            className="text-sm font-medium text-white"
          >
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
          <label htmlFor="agency" className="text-sm font-medium text-white">
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

        <div className="space-y-1.5">
          <label htmlFor="notes" className="text-sm font-medium text-white">
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

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/app/solicitations"
            className="rounded-md border border-[#1a2f4a] px-4 py-2 text-sm text-[#7d97b3] transition-colors hover:text-white"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="rounded-md bg-[#378ADD] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f78c2]"
          >
            Create Solicitation
          </button>
        </div>
      </form>
    </div>
  );
}
