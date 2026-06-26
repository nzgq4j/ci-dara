import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Upload,
  Play,
  FileText
} from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';
import { uploadAndExtract, removeStored } from '@/utils/dara/documents';
import { runEvaluation } from '@/utils/dara/evaluator';

// Evaluations call the AI provider once per criterion per active persona, which
// can take a while; give the synchronous run room before the function times out.
export const maxDuration = 300;

const fieldClasses =
  'w-full rounded-md border border-[#1a2f4a] bg-[#070c16] px-3 py-2 text-sm text-white placeholder:text-[#7d97b3] focus:border-[#3b6ef0] focus:outline-none focus:ring-1 focus:ring-[#3b6ef0]';
const labelClasses = 'text-xs font-medium uppercase tracking-wide text-[#7d97b3]';
const primaryBtn =
  'inline-flex items-center gap-2 rounded-md bg-[#3b6ef0] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f5fd6]';
const ghostBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#1a2f4a] px-3 py-2 text-sm text-[#7d97b3] transition-colors hover:text-white';
const dangerBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#5a1f1f] px-3 py-2 text-sm text-[#e07d7d] transition-colors hover:bg-[#5a1f1f]/30';

const CRITERION_TYPES = ['scored_factor', 'pass_fail', 'requirement', 'subfactor', 'administrative'];

const statusStyles: Record<string, string> = {
  pending: 'bg-[#1a2f4a] text-[#7d97b3]',
  running: 'bg-[#3b6ef0]/20 text-[#6f9bf5]',
  complete: 'bg-[#1f5a31]/30 text-[#7de0a0]',
  failed: 'bg-[#5a1f1f]/30 text-[#e07d7d]'
};

const extractStyles: Record<string, string> = {
  pending: 'text-[#7d97b3]',
  processing: 'text-[#6f9bf5]',
  complete: 'text-[#7de0a0]',
  failed: 'text-[#e07d7d]'
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const owned = await prisma.solicitation.findFirst({ where: { id: solId, companyId } });
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
  const owned = await prisma.criterion.findFirst({ where: { id, companyId: daraUser.companyId } });
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
  const owned = await prisma.criterion.findFirst({ where: { id, companyId: daraUser.companyId } });
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
  const owned = await prisma.response.findFirst({ where: { id, companyId: daraUser.companyId } });
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
    where: { id, companyId: daraUser.companyId },
    include: { files: true }
  });
  if (!owned) redirect('/app/solicitations');
  await removeStored(owned.files.map((f) => f.storedFilename));
  await prisma.response.delete({ where: { id } });
  revalidatePath(`/app/solicitations/${solId}`);
}

// ---- Document actions ----
async function uploadSolDoc(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireOwnedSolicitation(solId, daraUser.companyId);
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return;
  const doc = await uploadAndExtract(file, daraUser.companyId, 'sol', Date.now());
  await prisma.solDocument.create({
    data: {
      companyId: daraUser.companyId,
      solicitationId: solId,
      originalFilename: doc.originalFilename,
      storedFilename: doc.storedFilename,
      fileSize: doc.fileSize,
      extractionStatus: doc.extractionStatus,
      extractedText: doc.extractedText || null,
      uploadedBy: daraUser.id
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteSolDoc(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('docId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await prisma.solDocument.findFirst({ where: { id, companyId: daraUser.companyId } });
  if (!owned) return;
  await removeStored([owned.storedFilename]);
  await prisma.solDocument.delete({ where: { id } });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function uploadResponseFile(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const responseId = BigInt(String(formData.get('responseId')));
  const response = await prisma.response.findFirst({
    where: { id: responseId, companyId: daraUser.companyId }
  });
  if (!response) return;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return;
  const doc = await uploadAndExtract(file, daraUser.companyId, 'response', Date.now());
  await prisma.responseFile.create({
    data: {
      companyId: daraUser.companyId,
      responseId,
      originalFilename: doc.originalFilename,
      storedFilename: doc.storedFilename,
      fileSize: doc.fileSize,
      extractionStatus: doc.extractionStatus,
      extractedText: doc.extractedText || null
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteResponseFile(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('fileId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await prisma.responseFile.findFirst({ where: { id, companyId: daraUser.companyId } });
  if (!owned) return;
  await removeStored([owned.storedFilename]);
  await prisma.responseFile.delete({ where: { id } });
  revalidatePath(`/app/solicitations/${solId}`);
}

// ---- Run evaluations ----
async function runEvaluations(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const responseId = BigInt(String(formData.get('responseId')));
  await requireOwnedSolicitation(solId, daraUser.companyId);
  const response = await prisma.response.findFirst({
    where: { id: responseId, companyId: daraUser.companyId }
  });
  if (!response) return;

  const activePersonas = await prisma.persona.findMany({
    where: { companyId: daraUser.companyId, isActive: true }
  });

  for (const persona of activePersonas) {
    let evaluation = await prisma.evaluation.findFirst({
      where: { companyId: daraUser.companyId, responseId, personaId: persona.id }
    });
    if (!evaluation) {
      evaluation = await prisma.evaluation.create({
        data: {
          companyId: daraUser.companyId,
          solicitationId: solId,
          responseId,
          personaId: persona.id,
          status: 'pending'
        }
      });
    }
    await runEvaluation(evaluation.id, daraUser.companyId);
  }
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
      solDocs: { orderBy: { uploadedAt: 'desc' } },
      responses: {
        orderBy: { createdAt: 'desc' },
        include: { files: { orderBy: { uploadedAt: 'desc' } } }
      },
      evaluations: {
        orderBy: { createdAt: 'desc' },
        include: {
          response: true,
          results: {
            include: { criterion: true, persona: true },
            orderBy: { criterionId: 'asc' }
          }
        }
      }
    }
  });

  if (!solicitation) notFound();

  const personas = await prisma.persona.findMany({
    where: { companyId: daraUser.companyId }
  });
  const personaMap = new Map(personas.map((p) => [p.id.toString(), p.displayName]));
  const activeCount = personas.filter((p) => p.isActive).length;

  const sid = solicitation.id.toString();
  const canEvaluate = activeCount > 0 && solicitation.criteria.length > 0;

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
        <h1 className="mt-3 text-2xl font-semibold text-white">{solicitation.title}</h1>
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
              Title <span className="text-[#3b6ef0]">*</span>
            </label>
            <input id="title" name="title" type="text" required defaultValue={solicitation.title} className={fieldClasses} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="solNumber" className={labelClasses}>Solicitation Number</label>
              <input id="solNumber" name="solNumber" type="text" defaultValue={solicitation.solNumber} className={fieldClasses} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agency" className={labelClasses}>Agency</label>
              <input id="agency" name="agency" type="text" defaultValue={solicitation.agency} className={fieldClasses} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="notes" className={labelClasses}>Notes</label>
            <textarea id="notes" name="notes" rows={3} defaultValue={solicitation.notes ?? ''} className={fieldClasses} />
          </div>
          <div className="flex justify-end">
            <button type="submit" className={primaryBtn}><Save className="h-4 w-4" />Save changes</button>
          </div>
        </form>
      </section>

      {/* Solicitation documents */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Solicitation Documents{' '}
          <span className="text-sm font-normal text-[#7d97b3]">({solicitation.solDocs.length})</span>
        </h2>
        <div className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-4">
          {solicitation.solDocs.length > 0 && (
            <ul className="mb-4 space-y-2">
              {solicitation.solDocs.map((d) => (
                <li key={d.id.toString()} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-white">
                    <FileText className="h-4 w-4 text-[#7d97b3]" />
                    {d.originalFilename}
                    <span className="text-xs text-[#7d97b3]">{fmtSize(d.fileSize)}</span>
                    <span className={`text-xs ${extractStyles[d.extractionStatus] ?? ''}`}>· {d.extractionStatus}</span>
                  </span>
                  <form action={deleteSolDoc}>
                    <input type="hidden" name="solId" value={sid} />
                    <input type="hidden" name="docId" value={d.id.toString()} />
                    <button type="submit" className="text-[#e07d7d] hover:text-[#ff9b9b]"><Trash2 className="h-4 w-4" /></button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={uploadSolDoc} className="flex items-center gap-3">
            <input type="hidden" name="solId" value={sid} />
            <input type="file" name="file" required accept=".pdf,.docx,.txt,.md" className="block w-full text-sm text-[#7d97b3] file:mr-3 file:rounded-md file:border-0 file:bg-[#1a2f4a] file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-[#22405f]" />
            <button type="submit" className={primaryBtn}><Upload className="h-4 w-4" />Upload</button>
          </form>
        </div>
      </section>

      {/* Criteria */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Criteria <span className="text-sm font-normal text-[#7d97b3]">({solicitation.criteria.length})</span>
        </h2>
        {solicitation.criteria.map((c) => (
          <div key={c.id.toString()} className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-4">
            <form action={updateCriterion} className="space-y-3">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="criterionId" value={c.id.toString()} />
              <input type="hidden" name="sortOrder" value={c.sortOrder} />
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-6">
                  <label className={labelClasses}>Name</label>
                  <input name="name" type="text" defaultValue={c.name} className={fieldClasses} />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClasses}>Type</label>
                  <select name="criterionType" defaultValue={c.criterionType} className={fieldClasses}>
                    {CRITERION_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClasses}>Weight</label>
                  <input name="weight" type="number" defaultValue={c.weight} className={fieldClasses} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-9">
                  <label className={labelClasses}>Description</label>
                  <input name="description" type="text" defaultValue={c.description ?? ''} className={fieldClasses} />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClasses}>FAR Ref.</label>
                  <input name="farReference" type="text" defaultValue={c.farReference} className={fieldClasses} />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className={ghostBtn}><Save className="h-4 w-4" />Save</button>
              </div>
            </form>
            <form action={deleteCriterion} className="mt-2 flex justify-end border-t border-[#1a2f4a] pt-2">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="criterionId" value={c.id.toString()} />
              <button type="submit" className={dangerBtn}><Trash2 className="h-4 w-4" />Delete criterion</button>
            </form>
          </div>
        ))}
        <div className="rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Add criterion</h3>
          <form action={addCriterion} className="space-y-3">
            <input type="hidden" name="solId" value={sid} />
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-6">
                <label className={labelClasses}>Name <span className="text-[#3b6ef0]">*</span></label>
                <input name="name" type="text" required placeholder="e.g. Technical Approach" className={fieldClasses} />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <label className={labelClasses}>Type</label>
                <select name="criterionType" defaultValue="scored_factor" className={fieldClasses}>
                  {CRITERION_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
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
              <button type="submit" className={primaryBtn}><Plus className="h-4 w-4" />Add criterion</button>
            </div>
          </form>
        </div>
      </section>

      {/* Offerors */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Offerors <span className="text-sm font-normal text-[#7d97b3]">({solicitation.responses.length})</span>
        </h2>
        {!canEvaluate && (
          <p className="rounded-md border border-[#5a4a1f]/50 bg-[#0d1527] px-4 py-2 text-xs text-[#e0c97d]">
            To run evaluations you need at least one criterion and one active persona
            ({solicitation.criteria.length} criteria, {activeCount} active personas).
          </p>
        )}
        {solicitation.responses.map((r) => (
          <div key={r.id.toString()} className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-4">
            <form action={updateResponse} className="space-y-3">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="responseId" value={r.id.toString()} />
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-5">
                  <label className={labelClasses}>Offeror name</label>
                  <input name="offerorName" type="text" defaultValue={r.offerorName} className={fieldClasses} />
                </div>
                <div className="space-y-1.5 sm:col-span-7">
                  <label className={labelClasses}>Notes</label>
                  <input name="notes" type="text" defaultValue={r.notes ?? ''} className={fieldClasses} />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className={ghostBtn}><Save className="h-4 w-4" />Save</button>
              </div>
            </form>

            {/* Proposal files */}
            <div className="mt-3 border-t border-[#1a2f4a] pt-3">
              <p className={labelClasses}>Proposal documents</p>
              {r.files.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {r.files.map((f) => (
                    <li key={f.id.toString()} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 text-white">
                        <FileText className="h-4 w-4 text-[#7d97b3]" />
                        {f.originalFilename}
                        <span className="text-xs text-[#7d97b3]">{fmtSize(f.fileSize)}</span>
                        <span className={`text-xs ${extractStyles[f.extractionStatus] ?? ''}`}>· {f.extractionStatus}</span>
                      </span>
                      <form action={deleteResponseFile}>
                        <input type="hidden" name="solId" value={sid} />
                        <input type="hidden" name="fileId" value={f.id.toString()} />
                        <button type="submit" className="text-[#e07d7d] hover:text-[#ff9b9b]"><Trash2 className="h-4 w-4" /></button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form action={uploadResponseFile} className="mt-2 flex items-center gap-3">
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="responseId" value={r.id.toString()} />
                <input type="file" name="file" required accept=".pdf,.docx,.txt,.md" className="block w-full text-sm text-[#7d97b3] file:mr-3 file:rounded-md file:border-0 file:bg-[#1a2f4a] file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-[#22405f]" />
                <button type="submit" className={ghostBtn}><Upload className="h-4 w-4" />Upload</button>
              </form>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#1a2f4a] pt-3">
              <form action={runEvaluations}>
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="responseId" value={r.id.toString()} />
                <button type="submit" disabled={!canEvaluate || r.files.length === 0} className={`${primaryBtn} disabled:cursor-not-allowed disabled:opacity-40`}>
                  <Play className="h-4 w-4" />
                  Run evaluation{activeCount > 0 ? ` (${activeCount} personas)` : ''}
                </button>
              </form>
              <form action={deleteResponse}>
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="responseId" value={r.id.toString()} />
                <button type="submit" className={dangerBtn}><Trash2 className="h-4 w-4" />Delete offeror</button>
              </form>
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Add offeror</h3>
          <form action={addResponse} className="space-y-3">
            <input type="hidden" name="solId" value={sid} />
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-5">
                <label className={labelClasses}>Offeror name <span className="text-[#3b6ef0]">*</span></label>
                <input name="offerorName" type="text" required placeholder="e.g. Acme Corp" className={fieldClasses} />
              </div>
              <div className="space-y-1.5 sm:col-span-7">
                <label className={labelClasses}>Notes</label>
                <input name="notes" type="text" className={fieldClasses} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" className={primaryBtn}><Plus className="h-4 w-4" />Add offeror</button>
            </div>
          </form>
        </div>
      </section>

      {/* Evaluations & results */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Evaluations <span className="text-sm font-normal text-[#7d97b3]">({solicitation.evaluations.length})</span>
        </h2>
        {solicitation.evaluations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] px-4 py-6 text-center text-sm text-[#7d97b3]">
            No evaluations yet. Upload proposal documents for an offeror, ensure
            criteria and active personas exist, then click “Run evaluation”.
          </p>
        ) : (
          solicitation.evaluations.map((e) => (
            <div key={e.id.toString()} className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-white">
                  <span className="font-medium">{personaMap.get(e.personaId.toString()) ?? 'Persona'}</span>
                  <span className="text-[#7d97b3]"> · {e.response?.offerorName ?? '—'}</span>
                </div>
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[e.status] ?? statusStyles.pending}`}>
                  {e.status}
                </span>
              </div>
              {e.errorMessage && (
                <p className="mb-3 rounded-md border border-[#5a1f1f]/50 bg-[#5a1f1f]/10 px-3 py-2 text-xs text-[#e07d7d]">
                  {e.errorMessage}
                </p>
              )}
              {e.results.length > 0 && (
                <div className="space-y-2">
                  {e.results.map((res) => (
                    <div key={res.id.toString()} className="rounded-md border border-[#1a2f4a] bg-[#070c16] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white">{res.criterion.name}</span>
                        <span className="text-sm text-[#6f9bf5]">
                          {res.aiScore != null
                            ? `${Number(res.aiScore)}/100`
                            : res.aiDetermination ?? '—'}
                          {res.aiConfidence != null && (
                            <span className="ml-2 text-xs text-[#7d97b3]">
                              {Math.round(Number(res.aiConfidence) * 100)}% conf.
                            </span>
                          )}
                        </span>
                      </div>
                      {res.aiRationale && (
                        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-[#9fb3cc]">
                          {res.aiRationale}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
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
          <button type="submit" className={dangerBtn}><Trash2 className="h-4 w-4" />Delete solicitation</button>
        </form>
      </section>
    </div>
  );
}
