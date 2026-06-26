import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';

const fieldClasses =
  'w-full rounded-md border border-[#1a2f4a] bg-[#070c16] px-3 py-2 text-sm text-white placeholder:text-[#7d97b3] focus:border-[#378ADD] focus:outline-none focus:ring-1 focus:ring-[#378ADD]';
const labelClasses = 'text-xs font-medium uppercase tracking-wide text-[#7d97b3]';
const primaryBtn =
  'inline-flex items-center gap-2 rounded-md bg-[#378ADD] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f78c2]';
const ghostBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#1a2f4a] px-3 py-2 text-sm text-[#7d97b3] transition-colors hover:text-white';
const dangerBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#5a1f1f] px-3 py-2 text-sm text-[#e07d7d] transition-colors hover:bg-[#5a1f1f]/30';

const CRITERION_TYPES = ['scored_factor', 'pass_fail', 'requirement', 'subfactor'];

const statusStyles: Record<string, string> = {
  pending: 'bg-[#1a2f4a] text-[#7d97b3]',
  running: 'bg-[#378ADD]/20 text-[#7db8e0]',
  complete: 'bg-[#1f5a31]/30 text-[#7de0a0]',
  failed: 'bg-[#5a1f1f]/30 text-[#e07d7d]'
};

async function authedUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  return daraUser;
}

async function requireOwnedSolicitation(solId: bigint, companyId: bigint) {
  const owned = await prisma.solicitation.findFirst({
    where: { id: solId, companyId }
  });
  if (!owned) redirect('/app/solicitations');
  return owned;
}

// ---- Solicitation actions ----
async function updateSolicitation(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('solId')));
  await requireOwnedSolicitation(id, daraUser.companyId);

  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;

  await prisma.solicitation.update({
    where: { id },
    data: {
      title,
      solNumber: String(formData.get('solNumber') ?? '').trim(),
      agency: String(formData.get('agency') ?? '').trim(),
      notes: String(formData.get('notes') ?? '').trim() || null
    }
  });
  revalidatePath(`/app/solicitations/${id}`);
}

async function deleteSolicitation(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('solId')));
  await requireOwnedSolicitation(id, daraUser.companyId);
  await prisma.solicitation.delete({ where: { id } });
  redirect('/app/solicitations');
}

// ---- Criterion actions ----
async function addCriterion(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireOwnedSolicitation(solId, daraUser.companyId);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  await prisma.criterion.create({
    data: {
      companyId: daraUser.companyId,
      solicitationId: solId,
      name,
      description: String(formData.get('description') ?? '').trim() || null,
      criterionType: String(formData.get('criterionType') ?? 'scored_factor'),
      farReference: String(formData.get('farReference') ?? '').trim(),
      weight: parseInt(String(formData.get('weight') ?? '0'), 10) || 0,
      sortOrder: parseInt(String(formData.get('sortOrder') ?? '0'), 10) || 0
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function updateCriterion(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('criterionId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await prisma.criterion.findFirst({
    where: { id, companyId: daraUser.companyId }
  });
  if (!owned) redirect('/app/solicitations');

  await prisma.criterion.update({
    where: { id },
    data: {
      name: String(formData.get('name') ?? '').trim() || owned.name,
      description: String(formData.get('description') ?? '').trim() || null,
      criterionType: String(formData.get('criterionType') ?? owned.criterionType),
      farReference: String(formData.get('farReference') ?? '').trim(),
      weight: parseInt(String(formData.get('weight') ?? '0'), 10) || 0,
      sortOrder: parseInt(String(formData.get('sortOrder') ?? '0'), 10) || 0
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteCriterion(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('criterionId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await prisma.criterion.findFirst({
    where: { id, companyId: daraUser.companyId }
  });
  if (!owned) redirect('/app/solicitations');
  await prisma.criterion.delete({ where: { id } });
  revalidatePath(`/app/solicitations/${solId}`);
}

// ---- Response (offeror) actions ----
async function addResponse(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireOwnedSolicitation(solId, daraUser.companyId);

  const offerorName = String(formData.get('offerorName') ?? '').trim();
  if (!offerorName) return;

  await prisma.response.create({
    data: {
      companyId: daraUser.companyId,
      solicitationId: solId,
      offerorName,
      notes: String(formData.get('notes') ?? '').trim() || null
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function updateResponse(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('responseId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await prisma.response.findFirst({
    where: { id, companyId: daraUser.companyId }
  });
  if (!owned) redirect('/app/solicitations');

  await prisma.response.update({
    where: { id },
    data: {
      offerorName: String(formData.get('offerorName') ?? '').trim() || owned.offerorName,
      notes: String(formData.get('notes') ?? '').trim() || null
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteResponse(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('responseId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await prisma.response.findFirst({
    where: { id, companyId: daraUser.companyId }
  });
  if (!owned) redirect('/app/solicitations');
  await prisma.response.delete({ where: { id } });
  revalidatePath(`/app/solicitations/${solId}`);
}

export default async function SolicitationDetailPage({
  params
}: {
  params: { id: string };
}) {
  const daraUser = await authedUser();

  if (!/^\d+$/.test(params.id)) notFound();
  const solId = BigInt(params.id);

  const solicitation = await prisma.solicitation.findFirst({
    where: { id: solId, companyId: daraUser.companyId },
    include: {
      criteria: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      responses: {
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { files: true, evaluations: true } } }
      },
      evaluations: {
        orderBy: { createdAt: 'desc' },
        include: { response: true }
      }
    }
  });

  if (!solicitation) notFound();

  const sid = solicitation.id.toString();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link
          href="/app/solicitations"
          className="inline-flex items-center gap-2 text-sm text-[#7d97b3] transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Solicitations
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-white">
          {solicitation.title}
        </h1>
        <p className="text-sm text-[#7d97b3]">
          {solicitation.solNumber || 'No solicitation number'}
          {solicitation.agency ? ` · ${solicitation.agency}` : ''}
        </p>
      </div>

      {/* Edit details */}
      <section className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Details</h2>
        <form action={updateSolicitation} className="space-y-4">
          <input type="hidden" name="solId" value={sid} />
          <div className="space-y-1.5">
            <label htmlFor="title" className={labelClasses}>
              Title <span className="text-[#378ADD]">*</span>
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              defaultValue={solicitation.title}
              className={fieldClasses}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="solNumber" className={labelClasses}>
                Solicitation Number
              </label>
              <input
                id="solNumber"
                name="solNumber"
                type="text"
                defaultValue={solicitation.solNumber}
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
                defaultValue={solicitation.agency}
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
              rows={3}
              defaultValue={solicitation.notes ?? ''}
              className={fieldClasses}
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" className={primaryBtn}>
              <Save className="h-4 w-4" />
              Save changes
            </button>
          </div>
        </form>
      </section>

      {/* Criteria */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Criteria{' '}
          <span className="text-sm font-normal text-[#7d97b3]">
            ({solicitation.criteria.length})
          </span>
        </h2>

        {solicitation.criteria.map((c) => (
          <div
            key={c.id.toString()}
            className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-4"
          >
            <form action={updateCriterion} className="space-y-3">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="criterionId" value={c.id.toString()} />
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-6">
                  <label className={labelClasses}>Name</label>
                  <input
                    name="name"
                    type="text"
                    defaultValue={c.name}
                    className={fieldClasses}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClasses}>Type</label>
                  <select
                    name="criterionType"
                    defaultValue={c.criterionType}
                    className={fieldClasses}
                  >
                    {CRITERION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClasses}>Weight</label>
                  <input
                    name="weight"
                    type="number"
                    defaultValue={c.weight}
                    className={fieldClasses}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-9">
                  <label className={labelClasses}>Description</label>
                  <input
                    name="description"
                    type="text"
                    defaultValue={c.description ?? ''}
                    className={fieldClasses}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClasses}>FAR Ref.</label>
                  <input
                    name="farReference"
                    type="text"
                    defaultValue={c.farReference}
                    className={fieldClasses}
                  />
                </div>
              </div>
              <input type="hidden" name="sortOrder" value={c.sortOrder} />
              <div className="flex justify-end">
                <button type="submit" className={ghostBtn}>
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </div>
            </form>
            <form action={deleteCriterion} className="mt-2 flex justify-end border-t border-[#1a2f4a] pt-2">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="criterionId" value={c.id.toString()} />
              <button type="submit" className={dangerBtn}>
                <Trash2 className="h-4 w-4" />
                Delete criterion
              </button>
            </form>
          </div>
        ))}

        <div className="rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Add criterion</h3>
          <form action={addCriterion} className="space-y-3">
            <input type="hidden" name="solId" value={sid} />
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-6">
                <label className={labelClasses}>
                  Name <span className="text-[#378ADD]">*</span>
                </label>
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="e.g. Technical Approach"
                  className={fieldClasses}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <label className={labelClasses}>Type</label>
                <select name="criterionType" defaultValue="scored_factor" className={fieldClasses}>
                  {CRITERION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <label className={labelClasses}>Weight</label>
                <input name="weight" type="number" defaultValue={0} className={fieldClasses} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-9">
                <label className={labelClasses}>Description</label>
                <input name="description" type="text" className={fieldClasses} />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <label className={labelClasses}>FAR Ref.</label>
                <input name="farReference" type="text" className={fieldClasses} />
              </div>
            </div>
            <input type="hidden" name="sortOrder" value={solicitation.criteria.length} />
            <div className="flex justify-end">
              <button type="submit" className={primaryBtn}>
                <Plus className="h-4 w-4" />
                Add criterion
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Offerors / Responses */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Offerors{' '}
          <span className="text-sm font-normal text-[#7d97b3]">
            ({solicitation.responses.length})
          </span>
        </h2>

        {solicitation.responses.map((r) => (
          <div
            key={r.id.toString()}
            className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-4"
          >
            <form action={updateResponse} className="space-y-3">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="responseId" value={r.id.toString()} />
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-5">
                  <label className={labelClasses}>Offeror name</label>
                  <input
                    name="offerorName"
                    type="text"
                    defaultValue={r.offerorName}
                    className={fieldClasses}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-7">
                  <label className={labelClasses}>Notes</label>
                  <input
                    name="notes"
                    type="text"
                    defaultValue={r.notes ?? ''}
                    className={fieldClasses}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#7d97b3]">
                  {r._count.files} file(s) · {r._count.evaluations} evaluation(s)
                </span>
                <button type="submit" className={ghostBtn}>
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </div>
            </form>
            <form action={deleteResponse} className="mt-2 flex justify-end border-t border-[#1a2f4a] pt-2">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="responseId" value={r.id.toString()} />
              <button type="submit" className={dangerBtn}>
                <Trash2 className="h-4 w-4" />
                Delete offeror
              </button>
            </form>
          </div>
        ))}

        <div className="rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Add offeror</h3>
          <form action={addResponse} className="space-y-3">
            <input type="hidden" name="solId" value={sid} />
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-5">
                <label className={labelClasses}>
                  Offeror name <span className="text-[#378ADD]">*</span>
                </label>
                <input
                  name="offerorName"
                  type="text"
                  required
                  placeholder="e.g. Acme Corp"
                  className={fieldClasses}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-7">
                <label className={labelClasses}>Notes</label>
                <input name="notes" type="text" className={fieldClasses} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" className={primaryBtn}>
                <Plus className="h-4 w-4" />
                Add offeror
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Evaluations (read-only) */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Evaluations{' '}
          <span className="text-sm font-normal text-[#7d97b3]">
            ({solicitation.evaluations.length})
          </span>
        </h2>
        {solicitation.evaluations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] px-4 py-6 text-center text-sm text-[#7d97b3]">
            No evaluations yet. Evaluations are produced by the AI pipeline once
            offerors and criteria are in place.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#1a2f4a] bg-[#0d1527]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#1a2f4a] text-xs uppercase tracking-wide text-[#7d97b3]">
                <tr>
                  <th className="px-5 py-3 font-medium">Offeror</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {solicitation.evaluations.map((e) => (
                  <tr
                    key={e.id.toString()}
                    className="border-b border-[#1a2f4a] last:border-0"
                  >
                    <td className="px-5 py-3 text-white">
                      {e.response?.offerorName ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          statusStyles[e.status] ?? statusStyles.pending
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[#7d97b3]">
                      {e.createdAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-[#5a1f1f]/50 bg-[#0d1527] p-6">
        <h2 className="text-lg font-semibold text-white">Danger zone</h2>
        <p className="mt-1 text-sm text-[#7d97b3]">
          Deleting this solicitation also removes its criteria, offerors,
          documents, and evaluations. This cannot be undone.
        </p>
        <form action={deleteSolicitation} className="mt-4">
          <input type="hidden" name="solId" value={sid} />
          <button type="submit" className={dangerBtn}>
            <Trash2 className="h-4 w-4" />
            Delete solicitation
          </button>
        </form>
      </section>
    </div>
  );
}
