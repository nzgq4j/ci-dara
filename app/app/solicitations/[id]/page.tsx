import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Upload,
  FileText,
  Inbox,
  Sparkles,
  Loader2
} from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { userTeamIds, canViewSolicitation, canManageDepartments } from '@/utils/dara/sol-access';
import { recordAudit } from '@/utils/dara/audit';
import { uploadAndExtract, removeStored } from '@/utils/dara/documents';
import { runEvaluation, regenerateResult, setResultArchived } from '@/utils/dara/evaluator';
import { shredRequirements } from '@/utils/dara/requirements';
import Tabs, { type TabDef } from '@/components/dara/Tabs';
import CuiBoundaryNotice from '@/components/dara/CuiBoundaryNotice';
import ResultCard from '@/components/dara/ResultCard';
import SubmitButton from '@/components/dara/SubmitButton';
import RunPanel, { type RunState } from '@/components/dara/RunPanel';
import RunningBanner from '@/components/dara/RunningBanner';
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

const REQUIREMENT_SOURCES: { value: string; label: string }[] = [
  { value: 'instruction', label: 'Section L — Instruction' },
  { value: 'evaluation_factor', label: 'Section M — Evaluation factor' },
  { value: 'sow_pws', label: 'SOW / PWS requirement' },
  { value: 'far_clause', label: 'FAR / DFARS clause' },
  { value: 'other', label: 'Other' }
];
const COMPLIANCE_STATUSES: { value: string; label: string }[] = [
  { value: 'not_assessed', label: 'Not assessed' },
  { value: 'compliant', label: 'Compliant' },
  { value: 'partial', label: 'Partial' },
  { value: 'non_compliant', label: 'Non-compliant' },
  { value: 'not_applicable', label: 'N/A' }
];
const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  REQUIREMENT_SOURCES.map((s) => [s.value, s.label])
);
// Compliance-status pill colors for the matrix.
const STATUS_PILL: Record<string, string> = {
  not_assessed: 'text-t5',
  compliant: 'text-[#7de0a0]',
  partial: 'text-[#e0c97d]',
  non_compliant: 'text-[#e07d7d]',
  not_applicable: 'text-t4'
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

// Gate: the solicitation must exist in the company AND be viewable by this user
// under the department-access rules (admins all; creator own; others only via an
// assigned department). Used by the page and every mutation, so a user who can't
// see a solicitation also can't act on it via a directly-invoked server action.
async function requireViewableSolicitation(
  solId: bigint,
  daraUser: { id: string; companyId: bigint; role: string }
) {
  const owned = await withTenant(daraUser.companyId, async (tx) => {
    const s = await tx.solicitation.findFirst({
      where: { id: solId, companyId: daraUser.companyId },
      include: { departments: { select: { teamId: true } } }
    });
    if (!s) return null;
    const teamSet = new Set(await userTeamIds(tx, daraUser.id));
    const ok = canViewSolicitation(
      daraUser.id,
      daraUser.role,
      s.createdBy,
      s.departments.map((d) => d.teamId),
      teamSet
    );
    return ok ? s : null;
  });
  if (!owned) redirect('/app/solicitations');
  return owned;
}

// ---- Solicitation actions ----
async function updateSolicitation(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(id, daraUser);
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

// Assign the solicitation to a set of departments (replaces the current set).
// Gated to admins + the creator (canManageDepartments). Department access itself
// is enforced on read via requireViewableSolicitation.
async function setSolicitationDepartments(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('solId')));
  const sol = await requireViewableSolicitation(id, daraUser);
  if (!canManageDepartments(daraUser.id, daraUser.role, sol.createdBy)) return;
  const teamIds = formData
    .getAll('dept')
    .map((v) => String(v))
    .filter((v) => /^\d+$/.test(v))
    .map((v) => BigInt(v));

  await withTenant(daraUser.companyId, async (tx) => {
    // Keep only departments that actually belong to this company.
    const valid = teamIds.length
      ? await tx.team.findMany({
          where: { id: { in: teamIds }, companyId: daraUser.companyId },
          select: { id: true }
        })
      : [];
    const validIds = valid.map((t) => t.id);
    await tx.solicitationDepartment.deleteMany({ where: { solicitationId: id, companyId: daraUser.companyId } });
    if (validIds.length) {
      await tx.solicitationDepartment.createMany({
        data: validIds.map((teamId) => ({ companyId: daraUser.companyId, solicitationId: id, teamId }))
      });
    }
  });
  await recordAudit({
    action: 'solicitation.departments.set',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'solicitation',
    entityId: id,
    metadata: { teamIds: teamIds.map((t) => t.toString()) }
  });
  revalidatePath(`/app/solicitations/${id}`);
}

async function deleteSolicitation(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(id, daraUser);
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

// ---- Compliance matrix (requirement) actions ----
const VALID_SOURCES = new Set(REQUIREMENT_SOURCES.map((s) => s.value));
const VALID_STATUSES = new Set(COMPLIANCE_STATUSES.map((s) => s.value));

// AI-shred the solicitation documents into requirement rows (appended).
async function generateMatrixAction(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const summary = await shredRequirements(solId, daraUser.companyId);
  await recordAudit({
    action: 'requirement.shred',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'solicitation',
    entityId: solId,
    metadata: {
      ok: summary.ok,
      count: summary.count,
      error: summary.error ?? null,
      provider: daraUser.company.activeProvider,
      mode: daraUser.company.aiKeyMode
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function addRequirement(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const source = String(formData.get('source') ?? 'evaluation_factor');
  await withTenant(daraUser.companyId, (tx) =>
    tx.requirement.create({
      data: {
        companyId: daraUser.companyId,
        solicitationId: solId,
        name,
        description: String(formData.get('description') ?? '').trim() || null,
        source: (VALID_SOURCES.has(source) ? source : 'other') as any,
        isScored: formData.get('isScored') === 'on',
        farReference: String(formData.get('farReference') ?? '').trim(),
        weight: parseInt(String(formData.get('weight') ?? '0'), 10) || 0,
        sortOrder: parseInt(String(formData.get('sortOrder') ?? '0'), 10) || 0
      }
    })
  );
  revalidatePath(`/app/solicitations/${solId}`);
}

async function updateRequirement(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('requirementId')));
  const solId = BigInt(String(formData.get('solId')));
  const source = String(formData.get('source') ?? '');
  const status = String(formData.get('complianceStatus') ?? '');
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.requirement.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    await tx.requirement.update({
      where: { id },
      data: {
        name: String(formData.get('name') ?? '').trim() || owned.name,
        description: String(formData.get('description') ?? '').trim() || null,
        source: (VALID_SOURCES.has(source) ? source : owned.source) as any,
        isScored: formData.get('isScored') === 'on',
        complianceStatus: (VALID_STATUSES.has(status) ? status : owned.complianceStatus) as any,
        proposalRef: String(formData.get('proposalRef') ?? '').trim(),
        farReference: String(formData.get('farReference') ?? '').trim(),
        weight: parseInt(String(formData.get('weight') ?? '0'), 10) || 0
      }
    });
    return true;
  });
  if (!ok) redirect('/app/solicitations');
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteRequirement(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('requirementId')));
  const solId = BigInt(String(formData.get('solId')));
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.requirement.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    await tx.requirement.delete({ where: { id } });
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
  await requireViewableSolicitation(solId, daraUser);
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
  await requireViewableSolicitation(solId, daraUser);
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
// Returns a summary so the client RunPanel can show a completion notice.
async function runEvaluationsAction(formData: FormData): Promise<RunState> {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const responseId = BigInt(String(formData.get('responseId')));
  await requireViewableSolicitation(solId, daraUser);
  const activePersonas = await withTenant(daraUser.companyId, async (tx) => {
    const response = await tx.response.findFirst({
      where: { id: responseId, companyId: daraUser.companyId }
    });
    if (!response) return null;
    return tx.persona.findMany({
      where: { companyId: daraUser.companyId, isActive: true }
    });
  });
  if (!activePersonas || activePersonas.length === 0) {
    return { ok: false, personas: 0, results: 0, errors: 0 };
  }

  let totalResults = 0;
  let totalErrors = 0;
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
    const summary = await runEvaluation(evaluation.id, daraUser.companyId);
    totalResults += summary.results;
    totalErrors += summary.errors;
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
  return {
    ok: totalResults > 0,
    personas: activePersonas.length,
    results: totalResults,
    errors: totalErrors
  };
}

// ---- Regenerate / archive a single result (section) ----
async function regenerateResultAction(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const resultId = BigInt(String(formData.get('resultId')));
  await requireViewableSolicitation(solId, daraUser);
  const res = await regenerateResult(resultId, daraUser.companyId);
  await recordAudit({
    action: 'evaluation.result.regenerate',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'result',
    entityId: resultId,
    metadata: { ok: res.ok, error: res.error ?? null }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function archiveResultAction(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const resultId = BigInt(String(formData.get('resultId')));
  const archived = String(formData.get('archived') ?? '') === '1';
  await requireViewableSolicitation(solId, daraUser);
  await setResultArchived(resultId, daraUser.companyId, archived);
  await recordAudit({
    action: archived ? 'evaluation.result.archive' : 'evaluation.result.restore',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'result',
    entityId: resultId
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
        requirements: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        solDocs: { orderBy: { uploadedAt: 'desc' } },
        departments: { include: { team: true } },
        responses: {
          orderBy: { createdAt: 'desc' },
          include: { files: { orderBy: { uploadedAt: 'desc' } } }
        },
        evaluations: {
          orderBy: { createdAt: 'desc' },
          include: {
            response: true,
            results: {
              include: {
                requirement: true,
                persona: true,
                versions: { orderBy: { version: 'desc' } }
              },
              orderBy: { requirementId: 'asc' }
            }
          }
        }
      }
    });
    if (!solicitation) return null;
    // Department-access gate (admins all; creator own; others via assigned dept).
    const teamSet = new Set(await userTeamIds(tx, daraUser.id));
    const viewable = canViewSolicitation(
      daraUser.id,
      daraUser.role,
      solicitation.createdBy,
      solicitation.departments.map((d) => d.teamId),
      teamSet
    );
    if (!viewable) return null;
    const personas = await tx.persona.findMany({
      where: { companyId: daraUser.companyId }
    });
    const allTeams = await tx.team.findMany({
      where: { companyId: daraUser.companyId },
      orderBy: { name: 'asc' }
    });
    return { solicitation, personas, allTeams };
  });

  if (!data) notFound();
  const { solicitation, personas, allTeams } = data;
  const personaMap = new Map(personas.map((p) => [p.id.toString(), p.displayName]));
  const activeCount = personas.filter((p) => p.isActive).length;
  const assignedTeamIds = new Set(solicitation.departments.map((d) => d.teamId.toString()));
  const canManageDepts = canManageDepartments(daraUser.id, daraUser.role, solicitation.createdBy);

  const sid = solicitation.id.toString();
  const canEvaluate = activeCount > 0 && solicitation.requirements.length > 0;

  // ---- Build the score matrix (offerors × requirements) from evaluation results ----
  // For each offeror/requirement pair, average the numeric AI scores across every
  // persona that scored it; fall back to the first determination otherwise.
  const cellMap = new Map<string, { scores: number[]; determinations: string[] }>();
  for (const ev of solicitation.evaluations) {
    for (const res of ev.results) {
      const key = `${ev.responseId.toString()}:${res.requirementId.toString()}`;
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

      <section className={`${card} p-6`}>
        <h2 className={`mb-1 ${sectionTitle}`}>Departments</h2>
        <p className="mb-4 text-[13px] text-t4">
          Members of an assigned department can see this solicitation. Company admins
          and the creator can always see it; with no departments assigned, no one else can.
        </p>
        {allTeams.length === 0 ? (
          <p className="text-[13px] text-t5">
            No departments exist yet. Create them on the{' '}
            <Link href="/app/team" className="text-[#3b6ef0] hover:underline">Team</Link> page.
          </p>
        ) : canManageDepts ? (
          <form action={setSolicitationDepartments} className="space-y-4">
            <input type="hidden" name="solId" value={sid} />
            <div className="flex flex-wrap gap-2">
              {allTeams.map((t) => (
                <label
                  key={t.id.toString()}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-t3 transition-colors hover:border-[#3b6ef0]/40 has-[:checked]:border-[#3b6ef0] has-[:checked]:bg-[#3b6ef0]/5 has-[:checked]:text-t1"
                >
                  <input type="checkbox" name="dept" value={t.id.toString()} defaultChecked={assignedTeamIds.has(t.id.toString())} className="peer sr-only" />
                  <span className="h-2 w-2 rounded-full bg-t5 peer-checked:bg-[#3b6ef0]" />
                  {t.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <button type="submit" className={btnPrimary}><Save className="h-4 w-4" />Save departments</button>
            </div>
          </form>
        ) : solicitation.departments.length === 0 ? (
          <p className="text-[13px] text-t5">No departments assigned.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {solicitation.departments.map((d) => (
              <span key={d.id.toString()} className="inline-flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-t3">
                <span className="h-2 w-2 rounded-full bg-[#3b6ef0]" />{d.team.name}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[10px] border border-[#5a1f1f]/50 bg-surf p-6">
        <h2 className={sectionTitle}>Danger zone</h2>
        <p className="mt-1 text-[13px] text-t4">
          Deleting this solicitation also removes its requirements, offerors,
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

  const requirements = solicitation.requirements;
  const statusCounts = COMPLIANCE_STATUSES.map((s) => ({
    ...s,
    n: requirements.filter((r) => r.complianceStatus === s.value).length
  }));

  const compliancePanel = (
    <div className="space-y-4">
      <CuiBoundaryNotice
        provider={daraUser.company.activeProvider}
        mode={daraUser.company.aiKeyMode}
      />

      {/* Generate + summary */}
      <div className={`${card} p-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className={sectionTitle}>Compliance matrix</h2>
            <p className="mt-1 max-w-xl text-[13px] text-t4">
              Shred the solicitation into discrete requirements (Section L instructions,
              Section M factors, SOW/PWS tasks, FAR clauses), then track coverage and where
              each is answered in your proposal.
            </p>
          </div>
          <form action={generateMatrixAction} className="flex-shrink-0">
            <input type="hidden" name="solId" value={sid} />
            <SubmitButton
              className={btnPrimary}
              pending={(<><Loader2 className="h-4 w-4 animate-spin" />Generating…</>)}
            >
              <Sparkles className="h-4 w-4" />
              {requirements.length ? 'Generate more' : 'Generate from solicitation'}
            </SubmitButton>
          </form>
        </div>
        {solicitation.solDocs.length === 0 && (
          <p className="mt-3 rounded-lg border border-[#5a4a1f]/50 bg-surf px-4 py-2.5 text-[12px] text-[#e0c97d]">
            Upload solicitation documents on the Documents tab first — the generator reads
            their extracted text.
          </p>
        )}
        {requirements.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {statusCounts.map((s) => (
              <span
                key={s.value}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg px-2.5 py-1 text-[12px] text-t3"
              >
                <span className={`font-semibold ${STATUS_PILL[s.value]}`}>{s.n}</span>
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Requirements grouped by source */}
      {requirements.length === 0 ? (
        <div className={`${cardDashed} flex flex-col items-center justify-center px-6 py-10 text-center`}>
          <Inbox className="h-8 w-8 text-t5" />
          <p className="mt-3 text-[13px] text-t4">
            No requirements yet. Generate them from the solicitation above, or add one manually below.
          </p>
        </div>
      ) : (
        REQUIREMENT_SOURCES.map((s) => {
          const group = requirements.filter((r) => r.source === s.value);
          if (group.length === 0) return null;
          return (
            <div key={s.value} className="space-y-3">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                {s.label} ({group.length})
              </h3>
              {group.map((r) => (
                <div key={r.id.toString()} className={`${card} p-4`}>
                  <form action={updateRequirement} className="space-y-3">
                    <input type="hidden" name="solId" value={sid} />
                    <input type="hidden" name="requirementId" value={r.id.toString()} />
                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="space-y-1.5 sm:col-span-8">
                        <label className={labelClasses}>Requirement</label>
                        <input name="name" type="text" defaultValue={r.name} className={fieldClasses} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-4">
                        <label className={labelClasses}>Source</label>
                        <select name="source" defaultValue={r.source} className={fieldClasses}>
                          {REQUIREMENT_SOURCES.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Requirement text</label>
                      <textarea name="description" rows={2} defaultValue={r.description ?? ''} className={fieldClasses} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="space-y-1.5 sm:col-span-4">
                        <label className={labelClasses}>Compliance</label>
                        <select name="complianceStatus" defaultValue={r.complianceStatus} className={fieldClasses}>
                          {COMPLIANCE_STATUSES.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5 sm:col-span-4">
                        <label className={labelClasses}>Proposal reference</label>
                        <input name="proposalRef" type="text" defaultValue={r.proposalRef} placeholder="Vol / §  / page" className={fieldClasses} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className={labelClasses}>FAR Ref.</label>
                        <input name="farReference" type="text" defaultValue={r.farReference} className={fieldClasses} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className={labelClasses}>Weight</label>
                        <input name="weight" type="number" defaultValue={r.weight} className={fieldClasses} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-t3">
                        <input type="checkbox" name="isScored" defaultChecked={r.isScored} className="h-3.5 w-3.5 accent-[#3b6ef0]" />
                        Scored factor
                      </label>
                      <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save</button>
                    </div>
                  </form>
                  <form action={deleteRequirement} className="mt-2 flex justify-end border-t border-line pt-2">
                    <input type="hidden" name="solId" value={sid} />
                    <input type="hidden" name="requirementId" value={r.id.toString()} />
                    <button type="submit" className={btnDanger}><Trash2 className="h-4 w-4" />Delete</button>
                  </form>
                </div>
              ))}
            </div>
          );
        })
      )}

      {/* Add requirement */}
      <div className={`${cardDashed} p-4`}>
        <h3 className={`mb-3 ${sectionTitle}`}>Add requirement</h3>
        <form action={addRequirement} className="space-y-3">
          <input type="hidden" name="solId" value={sid} />
          <input type="hidden" name="sortOrder" value={requirements.length} />
          <div className="grid gap-3 sm:grid-cols-12">
            <div className="space-y-1.5 sm:col-span-8">
              <label className={labelClasses}>Requirement <span className="text-[#3b6ef0]">*</span></label>
              <input name="name" type="text" required placeholder="e.g. Page limit — Volume II" className={fieldClasses} />
            </div>
            <div className="space-y-1.5 sm:col-span-4">
              <label className={labelClasses}>Source</label>
              <select name="source" defaultValue="evaluation_factor" className={fieldClasses}>
                {REQUIREMENT_SOURCES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelClasses}>Requirement text</label>
            <textarea name="description" rows={2} className={fieldClasses} />
          </div>
          <div className="grid gap-3 sm:grid-cols-12">
            <div className="space-y-1.5 sm:col-span-3">
              <label className={labelClasses}>FAR Ref.</label>
              <input name="farReference" type="text" className={fieldClasses} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <label className={labelClasses}>Weight</label>
              <input name="weight" type="number" defaultValue={0} className={fieldClasses} />
            </div>
            <div className="flex items-end sm:col-span-6">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-t3">
                <input type="checkbox" name="isScored" className="h-3.5 w-3.5 accent-[#3b6ef0]" />
                Scored factor
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" />Add requirement</button>
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
          ({solicitation.requirements.length} criteria, {activeCount} active personas).
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

          <div className="mt-3 flex items-start justify-between gap-3 border-t border-line pt-3">
            <RunPanel
              action={runEvaluationsAction}
              solId={sid}
              responseId={r.id.toString()}
              activeCount={activeCount}
              disabled={!canEvaluate || r.files.length === 0}
            />
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

  const runningCount = solicitation.evaluations.filter(
    (e) => e.status === 'running' || e.status === 'pending'
  ).length;

  const matrixPanel = (
    <div className="space-y-6">
      <RunningBanner count={runningCount} />
      {/* Score matrix */}
      {hasResults && solicitation.requirements.length > 0 && solicitation.responses.length > 0 ? (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surf3">
                <th className="sticky left-0 z-10 bg-surf3 px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Offeror
                </th>
                {solicitation.requirements.map((c) => (
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
                  {solicitation.requirements.map((c) => {
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
            No evaluation results yet. Build the compliance matrix and add offerors, upload
            proposal documents, then run an evaluation from the Offerors tab.
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
              {e.results.length > 0 &&
                (() => {
                  const active = e.results.filter((res) => !res.archivedAt);
                  const archived = e.results.filter((res) => res.archivedAt);
                  return (
                    <div className="space-y-2">
                      {active.map((res) => (
                        <ResultCard
                          key={res.id.toString()}
                          res={res}
                          solId={sid}
                          regenerateAction={regenerateResultAction}
                          archiveAction={archiveResultAction}
                        />
                      ))}
                      {archived.length > 0 && (
                        <details className="rounded-lg border border-dashed border-line p-2">
                          <summary className="cursor-pointer list-none px-1 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                            Archived sections ({archived.length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {archived.map((res) => (
                              <ResultCard
                                key={res.id.toString()}
                                res={res}
                                solId={sid}
                                regenerateAction={regenerateResultAction}
                                archiveAction={archiveResultAction}
                              />
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', content: overviewPanel },
    { id: 'documents', label: 'Documents', count: solicitation.solDocs.length, content: documentsPanel },
    { id: 'compliance', label: 'Compliance', count: solicitation.requirements.length, content: compliancePanel },
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
