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
  FileText,
  Inbox
} from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import { uploadAndExtract, removeStored } from '@/utils/dara/documents';
import { runEvaluation } from '@/utils/dara/evaluator';
import Tabs, { type TabDef } from '@/components/dara/Tabs';
import CuiBoundaryNotice from '@/components/dara/CuiBoundaryNotice';
import {
  card,
  cardDashed,
  fieldClasses,
  labelClasses,
  btnPrimary,
  btnGhost,
  btnDanger,
  fileInputClasses,
  badgeBase,
  statusBadge,
  sectionTitle
} from '@/components/dara/theme';

// Evaluations call the AI provider once per criterion per active persona, which
// can take a while; give the synchronous run room before the function times out.
export const maxDuration = 300;

const CRITERION_TYPES = ['scored_factor', 'pass_fail', 'requirement', 'subfactor', 'administrative'];

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
  const owned = await withTenant(companyId, (tx) =>
    tx.solicitation.findFirst({ where: { id: solId, companyId } })
  );
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
  await withTenant(daraUser.companyId, (tx) =>
    tx.solicitation.update({
      where: { id },
      data: {
        title,
        solNumber: String(formData.get('solNumber') ?? '').trim(),
        agency: String(formData.get('agency') ?? '').trim(),
        notes: String(formData.get('notes') ?? '').trim() || null
      }
    })
  );
  revalidatePath(`/app/solicitations/${id}`);
}

async function deleteSolicitation(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('solId')));
  await requireOwnedSolicitation(id, daraUser.companyId);
  await withTenant(daraUser.companyId, (tx) => tx.solicitation.delete({ where: { id } }));
  await recordAudit({
    action: 'solicitation.delete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'solicitation',
    entityId: id
  });
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
  await withTenant(daraUser.companyId, (tx) =>
    tx.criterion.create({
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
    })
  );
  revalidatePath(`/app/solicitations/${solId}`);
}

async function updateCriterion(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('criterionId')));
  const solId = BigInt(String(formData.get('solId')));
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.criterion.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    await tx.criterion.update({
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
    return true;
  });
  if (!ok) redirect('/app/solicitations');
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteCriterion(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('criterionId')));
  const solId = BigInt(String(formData.get('solId')));
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.criterion.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    await tx.criterion.delete({ where: { id } });
    return true;
  });
  if (!ok) redirect('/app/solicitations');
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
  const created = await withTenant(daraUser.companyId, (tx) =>
    tx.response.create({
      data: {
        companyId: daraUser.companyId,
        solicitationId: solId,
        offerorName,
        notes: String(formData.get('notes') ?? '').trim() || null
      }
    })
  );
  await recordAudit({
    action: 'response.create',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'response',
    entityId: created.id,
    metadata: { solicitationId: solId.toString(), offerorName }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function updateResponse(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('responseId')));
  const solId = BigInt(String(formData.get('solId')));
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.response.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    await tx.response.update({
      where: { id },
      data: {
        offerorName: String(formData.get('offerorName') ?? '').trim() || owned.offerorName,
        notes: String(formData.get('notes') ?? '').trim() || null
      }
    });
    return true;
  });
  if (!ok) redirect('/app/solicitations');
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteResponse(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('responseId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await withTenant(daraUser.companyId, (tx) =>
    tx.response.findFirst({
      where: { id, companyId: daraUser.companyId },
      include: { files: true }
    })
  );
  if (!owned) redirect('/app/solicitations');
  // Storage I/O outside any transaction.
  await removeStored(owned.files.map((f) => f.storedFilename));
  await withTenant(daraUser.companyId, (tx) => tx.response.delete({ where: { id } }));
  await recordAudit({
    action: 'response.delete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'response',
    entityId: id,
    metadata: { offerorName: owned.offerorName, files: owned.files.length }
  });
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
  // Upload + extraction (Storage + CPU) outside any transaction.
  const doc = await uploadAndExtract(file, daraUser.companyId, 'sol', Date.now());
  const created = await withTenant(daraUser.companyId, (tx) =>
    tx.solDocument.create({
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
    })
  );
  await recordAudit({
    action: 'document.upload',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'sol_document',
    entityId: created.id,
    metadata: { solicitationId: solId.toString(), filename: doc.originalFilename }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteSolDoc(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('docId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await withTenant(daraUser.companyId, (tx) =>
    tx.solDocument.findFirst({ where: { id, companyId: daraUser.companyId } })
  );
  if (!owned) return;
  await removeStored([owned.storedFilename]);
  await withTenant(daraUser.companyId, (tx) => tx.solDocument.delete({ where: { id } }));
  await recordAudit({
    action: 'document.delete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'sol_document',
    entityId: id,
    metadata: { filename: owned.originalFilename }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function uploadResponseFile(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const responseId = BigInt(String(formData.get('responseId')));
  const response = await withTenant(daraUser.companyId, (tx) =>
    tx.response.findFirst({
      where: { id: responseId, companyId: daraUser.companyId }
    })
  );
  if (!response) return;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return;
  // Upload + extraction (Storage + CPU) outside any transaction.
  const doc = await uploadAndExtract(file, daraUser.companyId, 'response', Date.now());
  const created = await withTenant(daraUser.companyId, (tx) =>
    tx.responseFile.create({
      data: {
        companyId: daraUser.companyId,
        responseId,
        originalFilename: doc.originalFilename,
        storedFilename: doc.storedFilename,
        fileSize: doc.fileSize,
        extractionStatus: doc.extractionStatus,
        extractedText: doc.extractedText || null
      }
    })
  );
  await recordAudit({
    action: 'responsefile.upload',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'response_file',
    entityId: created.id,
    metadata: { responseId: responseId.toString(), filename: doc.originalFilename }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteResponseFile(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('fileId')));
  const solId = BigInt(String(formData.get('solId')));
  const owned = await withTenant(daraUser.companyId, (tx) =>
    tx.responseFile.findFirst({ where: { id, companyId: daraUser.companyId } })
  );
  if (!owned) return;
  await removeStored([owned.storedFilename]);
  await withTenant(daraUser.companyId, (tx) => tx.responseFile.delete({ where: { id } }));
  await recordAudit({
    action: 'responsefile.delete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'response_file',
    entityId: id,
    metadata: { filename: owned.originalFilename }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

// ---- Run evaluations ----
async function runEvaluations(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const responseId = BigInt(String(formData.get('responseId')));
  await requireOwnedSolicitation(solId, daraUser.companyId);
  const activePersonas = await withTenant(daraUser.companyId, async (tx) => {
    const response = await tx.response.findFirst({
      where: { id: responseId, companyId: daraUser.companyId }
    });
    if (!response) return null;
    return tx.persona.findMany({
      where: { companyId: daraUser.companyId, isActive: true }
    });
  });
  if (!activePersonas) return;

  for (const persona of activePersonas) {
    // Find-or-create the evaluation row in its own short burst...
    const evaluation = await withTenant(daraUser.companyId, async (tx) => {
      const existing = await tx.evaluation.findFirst({
        where: { companyId: daraUser.companyId, responseId, personaId: persona.id }
      });
      return (
        existing ??
        tx.evaluation.create({
          data: {
            companyId: daraUser.companyId,
            solicitationId: solId,
            responseId,
            personaId: persona.id,
            status: 'pending'
          }
        })
      );
    });
    // ...then run it OUTSIDE any transaction — runEvaluation manages its own
    // withTenant bursts around the slow LLM calls (do not nest transactions).
    await runEvaluation(evaluation.id, daraUser.companyId);
  }
  await recordAudit({
    action: 'evaluation.run',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'response',
    entityId: responseId,
    // Record the CUI egress target for the data-boundary trail (DARA-007).
    metadata: {
      solicitationId: solId.toString(),
      personas: activePersonas.length,
      provider: daraUser.company.activeProvider,
      mode: daraUser.company.aiKeyMode
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${badgeBase} ${statusBadge[status] ?? statusBadge.pending}`}>
      {status}
    </span>
  );
}

export default async function SolicitationDetailPage({
  params
}: {
  params: { id: string };
}) {
  const daraUser = await authedUser();

  if (!/^\d+$/.test(params.id)) notFound();
  const solId = BigInt(params.id);

  const data = await withTenant(daraUser.companyId, async (tx) => {
    const solicitation = await tx.solicitation.findFirst({
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
    if (!solicitation) return null;
    const personas = await tx.persona.findMany({
      where: { companyId: daraUser.companyId }
    });
    return { solicitation, personas };
  });

  if (!data) notFound();
  const { solicitation, personas } = data;
  const personaMap = new Map(personas.map((p) => [p.id.toString(), p.displayName]));
  const activeCount = personas.filter((p) => p.isActive).length;

  const sid = solicitation.id.toString();
  const canEvaluate = activeCount > 0 && solicitation.criteria.length > 0;

  // ---- Build the score matrix (offerors × criteria) from evaluation results ----
  // For each offeror/criterion pair, average the numeric AI scores across every
  // persona that scored it; fall back to the first determination otherwise.
  const cellMap = new Map<string, { scores: number[]; determinations: string[] }>();
  for (const ev of solicitation.evaluations) {
    for (const res of ev.results) {
      const key = `${ev.responseId.toString()}:${res.criterionId.toString()}`;
      const cell = cellMap.get(key) ?? { scores: [], determinations: [] };
      if (res.aiScore != null) cell.scores.push(Number(res.aiScore));
      else if (res.aiDetermination) cell.determinations.push(res.aiDetermination);
      cellMap.set(key, cell);
    }
  }
  const hasResults = cellMap.size > 0;

  // ===================== Tab panels =====================

  const overviewPanel = (
    <div className="space-y-6">
      <section className={`${card} p-6`}>
        <h2 className={`mb-4 ${sectionTitle}`}>Details</h2>
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
            <button type="submit" className={btnPrimary}><Save className="h-4 w-4" />Save changes</button>
          </div>
        </form>
      </section>

      <section className="rounded-[10px] border border-[#5a1f1f]/50 bg-surf p-6">
        <h2 className={sectionTitle}>Danger zone</h2>
        <p className="mt-1 text-[13px] text-t4">
          Deleting this solicitation also removes its criteria, offerors,
          documents, and evaluations. This cannot be undone.
        </p>
        <form action={deleteSolicitation} className="mt-4">
          <input type="hidden" name="solId" value={sid} />
          <button type="submit" className={btnDanger}><Trash2 className="h-4 w-4" />Delete solicitation</button>
        </form>
      </section>
    </div>
  );

  const documentsPanel = (
    <div className="space-y-4">
      <CuiBoundaryNotice
        provider={daraUser.company.activeProvider}
        mode={daraUser.company.aiKeyMode}
      />
      <div className={`${card} p-5`}>
      {solicitation.solDocs.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {solicitation.solDocs.map((d) => (
            <li key={d.id.toString()} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <FileText className="h-4 w-4 flex-shrink-0 text-t5" />
                <span className="truncate text-[13px] text-t2">{d.originalFilename}</span>
                <span className="flex-shrink-0 text-[11px] text-t5">{fmtSize(d.fileSize)}</span>
                <StatusBadge status={d.extractionStatus} />
              </span>
              <form action={deleteSolDoc}>
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="docId" value={d.id.toString()} />
                <button type="submit" className="text-[#e07d7d] transition-colors hover:text-[#ff9b9b]"><Trash2 className="h-4 w-4" /></button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-[13px] text-t5">No solicitation documents uploaded yet.</p>
      )}
      <form action={uploadSolDoc} className="flex items-center gap-3">
        <input type="hidden" name="solId" value={sid} />
        <input type="file" name="file" required accept=".pdf,.docx,.txt,.md" className={fileInputClasses} />
        <button type="submit" className={btnPrimary}><Upload className="h-4 w-4" />Upload</button>
      </form>
      </div>
    </div>
  );

  const criteriaPanel = (
    <div className="space-y-4">
      {solicitation.criteria.map((c) => (
        <div key={c.id.toString()} className={`${card} p-4`}>
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
              <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save</button>
            </div>
          </form>
          <form action={deleteCriterion} className="mt-2 flex justify-end border-t border-line pt-2">
            <input type="hidden" name="solId" value={sid} />
            <input type="hidden" name="criterionId" value={c.id.toString()} />
            <button type="submit" className={btnDanger}><Trash2 className="h-4 w-4" />Delete criterion</button>
          </form>
        </div>
      ))}
      <div className={`${cardDashed} p-4`}>
        <h3 className={`mb-3 ${sectionTitle}`}>Add criterion</h3>
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
            <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" />Add criterion</button>
          </div>
        </form>
      </div>
    </div>
  );

  const offerorsPanel = (
    <div className="space-y-4">
      <CuiBoundaryNotice
        provider={daraUser.company.activeProvider}
        mode={daraUser.company.aiKeyMode}
      />
      {!canEvaluate && (
        <p className="rounded-lg border border-[#5a4a1f]/50 bg-surf px-4 py-2.5 text-[12px] text-[#e0c97d]">
          To run evaluations you need at least one criterion and one active persona
          ({solicitation.criteria.length} criteria, {activeCount} active personas).
        </p>
      )}
      {solicitation.responses.map((r) => (
        <div key={r.id.toString()} className={`${card} p-4`}>
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
              <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save</button>
            </div>
          </form>

          {/* Proposal files */}
          <div className="mt-3 border-t border-line pt-3">
            <p className={labelClasses}>Proposal documents</p>
            {r.files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {r.files.map((f) => (
                  <li key={f.id.toString()} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <FileText className="h-4 w-4 flex-shrink-0 text-t5" />
                      <span className="truncate text-[13px] text-t2">{f.originalFilename}</span>
                      <span className="flex-shrink-0 text-[11px] text-t5">{fmtSize(f.fileSize)}</span>
                      <StatusBadge status={f.extractionStatus} />
                    </span>
                    <form action={deleteResponseFile}>
                      <input type="hidden" name="solId" value={sid} />
                      <input type="hidden" name="fileId" value={f.id.toString()} />
                      <button type="submit" className="text-[#e07d7d] transition-colors hover:text-[#ff9b9b]"><Trash2 className="h-4 w-4" /></button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={uploadResponseFile} className="mt-2 flex items-center gap-3">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="responseId" value={r.id.toString()} />
              <input type="file" name="file" required accept=".pdf,.docx,.txt,.md" className={fileInputClasses} />
              <button type="submit" className={btnGhost}><Upload className="h-4 w-4" />Upload</button>
            </form>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <form action={runEvaluations}>
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="responseId" value={r.id.toString()} />
              <button type="submit" disabled={!canEvaluate || r.files.length === 0} className={btnPrimary}>
                <Play className="h-4 w-4" />
                Run evaluation{activeCount > 0 ? ` (${activeCount} personas)` : ''}
              </button>
            </form>
            <form action={deleteResponse}>
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="responseId" value={r.id.toString()} />
              <button type="submit" className={btnDanger}><Trash2 className="h-4 w-4" />Delete offeror</button>
            </form>
          </div>
        </div>
      ))}
      <div className={`${cardDashed} p-4`}>
        <h3 className={`mb-3 ${sectionTitle}`}>Add offeror</h3>
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
            <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" />Add offeror</button>
          </div>
        </form>
      </div>
    </div>
  );

  const matrixPanel = (
    <div className="space-y-6">
      {/* Score matrix */}
      {hasResults && solicitation.criteria.length > 0 && solicitation.responses.length > 0 ? (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surf3">
                <th className="sticky left-0 z-10 bg-surf3 px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Offeror
                </th>
                {solicitation.criteria.map((c) => (
                  <th key={c.id.toString()} className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {solicitation.responses.map((r) => (
                <tr key={r.id.toString()} className="border-t border-line">
                  <td className="sticky left-0 z-10 bg-surf px-[18px] py-3 text-[13px] font-semibold text-t2">
                    {r.offerorName}
                  </td>
                  {solicitation.criteria.map((c) => {
                    const cell = cellMap.get(`${r.id.toString()}:${c.id.toString()}`);
                    let label = '—';
                    let color = 'text-t5';
                    if (cell && cell.scores.length > 0) {
                      const avg = Math.round(
                        cell.scores.reduce((a, b) => a + b, 0) / cell.scores.length
                      );
                      label = `${avg}`;
                      color =
                        avg >= 75 ? 'text-[#7de0a0]' : avg >= 50 ? 'text-[#6f9bf5]' : 'text-[#e0a07d]';
                    } else if (cell && cell.determinations.length > 0) {
                      label = cell.determinations[0];
                      color = 'text-t3';
                    }
                    return (
                      <td key={c.id.toString()} className={`px-3.5 py-3 text-center text-[13px] font-semibold ${color}`}>
                        {label}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`${cardDashed} flex flex-col items-center justify-center px-6 py-12 text-center`}>
          <Inbox className="h-9 w-9 text-t5" />
          <p className="mt-3 text-[13px] text-t4">
            No evaluation results yet. Add criteria and offerors, upload proposal
            documents, then run an evaluation from the Offerors tab.
          </p>
        </div>
      )}

      {/* Detailed evaluation results */}
      {solicitation.evaluations.length > 0 && (
        <div className="space-y-4">
          <h2 className={sectionTitle}>
            Detailed results{' '}
            <span className="font-mono text-[11px] font-normal text-t5">
              ({solicitation.evaluations.length})
            </span>
          </h2>
          {solicitation.evaluations.map((e) => (
            <div key={e.id.toString()} className={`${card} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[13px]">
                  <span className="font-semibold text-t1">{personaMap.get(e.personaId.toString()) ?? 'Persona'}</span>
                  <span className="text-t4"> · {e.response?.offerorName ?? '—'}</span>
                </div>
                <StatusBadge status={e.status} />
              </div>
              {e.errorMessage && (
                <p className="mb-3 rounded-lg border border-[#5a1f1f]/50 bg-[#5a1f1f]/10 px-3 py-2 text-[12px] text-[#e07d7d]">
                  {e.errorMessage}
                </p>
              )}
              {e.results.length > 0 && (
                <div className="space-y-2">
                  {e.results.map((res) => (
                    <div key={res.id.toString()} className="rounded-lg border border-line bg-bg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-t1">{res.criterion.name}</span>
                        <span className="text-[13px] text-[#6f9bf5]">
                          {res.aiScore != null
                            ? `${Number(res.aiScore)}/100`
                            : res.aiDetermination ?? '—'}
                          {res.aiConfidence != null && (
                            <span className="ml-2 text-[11px] text-t5">
                              {Math.round(Number(res.aiConfidence) * 100)}% conf.
                            </span>
                          )}
                        </span>
                      </div>
                      {res.aiRationale && (
                        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-t3">
                          {res.aiRationale}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', content: overviewPanel },
    { id: 'documents', label: 'Documents', count: solicitation.solDocs.length, content: documentsPanel },
    { id: 'criteria', label: 'Criteria', count: solicitation.criteria.length, content: criteriaPanel },
    { id: 'offerors', label: 'Offerors', count: solicitation.responses.length, content: offerorsPanel },
    { id: 'matrix', label: 'Matrix', count: solicitation.evaluations.length, content: matrixPanel }
  ];

  return (
    <div className="mx-auto max-w-5xl fade">
      <Link
        href="/app/solicitations"
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-t4 transition-colors hover:text-t1"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Solicitations
      </Link>
      <div className="mb-6">
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-t5">
          {solicitation.solNumber || 'No reference number'}
          {solicitation.agency ? ` · ${solicitation.agency}` : ''}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-t1">{solicitation.title}</h1>
      </div>

      <Tabs tabs={tabs} />
    </div>
  );
}
