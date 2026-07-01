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
  CheckSquare
} from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { userTeamIds, canViewSolicitation, canManageDepartments } from '@/utils/dara/sol-access';
import { recordAudit } from '@/utils/dara/audit';
import { uploadAndExtract, removeStored } from '@/utils/dara/documents';
import { runEvaluation, runComplianceSweep, runComplianceCheck, regenerateResult, setResultArchived } from '@/utils/dara/evaluator';
import { shredRequirements } from '@/utils/dara/requirements';
import { captureSnapshot } from '@/utils/dara/reviews';
import { reconcileAmendment, applyAmendmentChange } from '@/utils/dara/amendments';
import { enqueueReviewRun, enqueuePassRun, triggerWorker } from '@/utils/dara/passes';
import PipelineStepper from '@/components/dara/PipelineStepper';
import CuiBoundaryModal from '@/components/dara/CuiBoundaryModal';
import ResultCard from '@/components/dara/ResultCard';
import AiActionButton from '@/components/dara/AiActionButton';
import AddSection from '@/components/dara/AddSection';
import RequirementDetail from '@/components/dara/RequirementDetail';
import PrintButton from '@/components/dara/PrintButton';
import ReviewPassPanel from '@/components/dara/ReviewPassPanel';
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

// Reviews run the AI provider across evaluation factors (concurrently) + a compliance
// sweep; give the function generous room (Fluid Compute allows up to 800s) so a full
// run completes in one round.
export const maxDuration = 800;

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
// How each requirement is handled — set automatically by the shred, overridable per row.
const REQUIREMENT_DISPOSITIONS: { value: string; label: string; short: string }[] = [
  { value: 'scored', label: 'Scored — holistic review', short: 'Scored' },
  { value: 'compliance', label: 'Compliance — pass/fail', short: 'Compliance' },
  { value: 'administrative', label: 'Administrative — not in proposal', short: 'Admin' }
];
const DISPOSITION_LABEL: Record<string, string> = Object.fromEntries(
  REQUIREMENT_DISPOSITIONS.map((d) => [d.value, d.short])
);
const VALID_DISPOSITIONS = new Set(REQUIREMENT_DISPOSITIONS.map((d) => d.value));
const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  REQUIREMENT_SOURCES.map((s) => [s.value, s.label])
);
const COMPLIANCE_LABEL: Record<string, string> = Object.fromEntries(
  COMPLIANCE_STATUSES.map((s) => [s.value, s.label])
);
// Compliance-status pill colors for the matrix.
const STATUS_PILL: Record<string, string> = {
  not_assessed: 'text-t5',
  compliant: 'text-[#7de0a0]',
  partial: 'text-[#e0c97d]',
  non_compliant: 'text-[#e07d7d]',
  not_applicable: 'text-t4'
};

// Color-team gates. The color is a label only — review behavior comes from the
// chosen personas. `dot` drives the swatch; `text` tints the name.
const COLOR_TEAMS: { value: string; label: string; dot: string; text: string }[] = [
  { value: 'pink', label: 'Pink', dot: '#ec4899', text: 'text-[#ec4899]' },
  { value: 'red', label: 'Red', dot: '#ef4444', text: 'text-[#ef4444]' },
  { value: 'gold', label: 'Gold', dot: '#eab308', text: 'text-[#eab308]' },
  { value: 'blue', label: 'Blue', dot: '#3b82f6', text: 'text-[#6f9bf5]' },
  { value: 'green', label: 'Green', dot: '#22c55e', text: 'text-[#7de0a0]' },
  { value: 'black', label: 'Black', dot: '#9ca3af', text: 'text-t3' },
  { value: 'white', label: 'White', dot: '#e5e7eb', text: 'text-t2' }
];
const COLOR_TEAM_MAP: Record<string, { label: string; dot: string; text: string }> =
  Object.fromEntries(COLOR_TEAMS.map((c) => [c.value, c]));

// What each color-team gate focuses on (for the pipeline stage headers). The pipeline
// is a suggestion, not a hard workflow — every stage is optional and skippable.
const STAGE_META: Record<string, { focus: string; desc: string }> = {
  pink: { focus: 'Strategy & outline', desc: 'Early-draft review — is the approach sound and compliant, and are the win themes present in the outline/storyboards?' },
  red: { focus: 'Full draft review', desc: 'Near-final review — assess the draft as the evaluator would: weaknesses, compliance gaps, and persuasiveness.' },
  gold: { focus: 'Executive review', desc: 'Final leadership review before submission — go/no-go, risk, and top-level polish.' },
  white: { focus: 'Production-ready', desc: 'Final production/quality pass — formatting, consistency, and submission readiness.' },
  blue: { focus: 'Win strategy', desc: 'Capture / win-strategy review before writing begins.' },
  green: { focus: 'Cost / price', desc: 'Pricing and cost-realism review.' },
  black: { focus: 'Competitive', desc: 'Competitor and win-probability assessment.' }
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Deterministic UTC date (YYYY-MM-DD). Locale/timezone-dependent formatters like
// toLocaleDateString() render differently on the server (UTC) vs the client, which
// for a UTC-midnight date shifts the day in western timezones — a hydration mismatch
// that crashes the page. ISO-from-UTC is identical on both sides.
function fmtDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
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
async function generateMatrixAction(formData: FormData): Promise<{ ok: boolean; count: number; error?: string }> {
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
  return { ok: summary.ok, count: summary.count, error: summary.error };
}

// Standalone compliance sweep: check the pass/fail administrative requirements against
// the current proposal draft and set their statuses (the compliance matrix).
async function runComplianceCheckAction(formData: FormData): Promise<{ ok: boolean; count: number; error?: string }> {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const res = await runComplianceCheck(solId, daraUser.companyId, Date.now() + 760_000);
  await recordAudit({
    action: 'requirement.compliance_check',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'solicitation',
    entityId: solId,
    metadata: {
      ok: res.ok,
      checked: res.checked,
      error: res.error ?? null,
      provider: daraUser.company.activeProvider,
      mode: daraUser.company.aiKeyMode
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
  return { ok: res.ok, count: res.checked, error: res.error };
}

async function addRequirement(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const source = String(formData.get('source') ?? 'evaluation_factor');
  const dispIn = String(formData.get('disposition') ?? 'compliance');
  const disposition = VALID_DISPOSITIONS.has(dispIn) ? dispIn : 'compliance';
  await withTenant(daraUser.companyId, (tx) =>
    tx.requirement.create({
      data: {
        companyId: daraUser.companyId,
        solicitationId: solId,
        name,
        description: String(formData.get('description') ?? '').trim() || null,
        source: (VALID_SOURCES.has(source) ? source : 'other') as any,
        disposition: disposition as any,
        isScored: disposition === 'scored',
        // Administrative rows aren't graded — default them to N/A.
        complianceStatus: (disposition === 'administrative' ? 'not_applicable' : 'not_assessed') as any,
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
  const dispIn = String(formData.get('disposition') ?? '');
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.requirement.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    const disposition = VALID_DISPOSITIONS.has(dispIn) ? dispIn : owned.disposition;
    await tx.requirement.update({
      where: { id },
      data: {
        name: String(formData.get('name') ?? '').trim() || owned.name,
        description: String(formData.get('description') ?? '').trim() || null,
        source: (VALID_SOURCES.has(source) ? source : owned.source) as any,
        disposition: disposition as any,
        isScored: disposition === 'scored',
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

// ---- Color-team review actions ----
const VALID_COLORS = new Set(COLOR_TEAMS.map((c) => c.value));

async function createReview(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const name = String(formData.get('name') ?? '').trim();
  if (!name) redirect(`/app/solicitations/${solId}`);
  const color = String(formData.get('colorTeam') ?? 'pink');
  const personaIds = formData
    .getAll('persona')
    .map((v) => String(v))
    .filter((v) => /^\d+$/.test(v))
    .map((v) => BigInt(v));

  // Guard against an accidental re-create: a transient client render error can make a
  // successful create look like it failed, prompting the user to submit again. If an
  // identical review was created moments ago, treat this as a duplicate and just land
  // on the page (which now shows the already-created review).
  const recentDuplicate = await withTenant(daraUser.companyId, (tx) =>
    tx.review.findFirst({
      where: {
        solicitationId: solId,
        companyId: daraUser.companyId,
        name,
        createdAt: { gte: new Date(Date.now() - 120_000) }
      },
      select: { id: true }
    })
  );
  if (recentDuplicate) redirect(`/app/solicitations/${solId}`);

  const created = await withTenant(daraUser.companyId, async (tx) => {
    const review = await tx.review.create({
      data: {
        companyId: daraUser.companyId,
        solicitationId: solId,
        name,
        colorTeam: (VALID_COLORS.has(color) ? color : 'pink') as any,
        notes: String(formData.get('notes') ?? '').trim() || null,
        createdBy: daraUser.id
      }
    });
    if (personaIds.length) {
      // Keep only personas that belong to this company.
      const valid = await tx.persona.findMany({
        where: { id: { in: personaIds }, companyId: daraUser.companyId },
        select: { id: true }
      });
      if (valid.length) {
        await tx.reviewPersona.createMany({
          data: valid.map((p) => ({ companyId: daraUser.companyId, reviewId: review.id, personaId: p.id }))
        });
      }
    }
    return review;
  });
  // Freeze the current proposal draft into the new review (no-op if none uploaded yet).
  await captureSnapshot(created.id, daraUser.companyId);
  await recordAudit({
    action: 'review.create',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'review',
    entityId: created.id,
    metadata: { solicitationId: solId.toString(), name, colorTeam: color }
  });
  // Land on the page via a fresh navigation rather than an in-place client patch — the
  // patch reconciliation is what was throwing the client-side render error after create.
  redirect(`/app/solicitations/${solId}`);
}

async function updateReview(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('reviewId')));
  const solId = BigInt(String(formData.get('solId')));
  const color = String(formData.get('colorTeam') ?? '');
  const personaIds = formData
    .getAll('persona')
    .map((v) => String(v))
    .filter((v) => /^\d+$/.test(v))
    .map((v) => BigInt(v));
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.review.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    await tx.review.update({
      where: { id },
      data: {
        name: String(formData.get('name') ?? '').trim() || owned.name,
        colorTeam: (VALID_COLORS.has(color) ? color : owned.colorTeam) as any,
        notes: String(formData.get('notes') ?? '').trim() || null
      }
    });
    // Replace the reviewer set.
    await tx.reviewPersona.deleteMany({ where: { reviewId: id, companyId: daraUser.companyId } });
    if (personaIds.length) {
      const valid = await tx.persona.findMany({
        where: { id: { in: personaIds }, companyId: daraUser.companyId },
        select: { id: true }
      });
      if (valid.length) {
        await tx.reviewPersona.createMany({
          data: valid.map((p) => ({ companyId: daraUser.companyId, reviewId: id, personaId: p.id }))
        });
      }
    }
    return true;
  });
  if (!ok) redirect('/app/solicitations');
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteReview(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('reviewId')));
  const solId = BigInt(String(formData.get('solId')));
  // Snapshots reference the proposal's shared stored files (owned by SolDocument), so
  // deleting a review must NOT remove the blobs — just drop the rows (cascades docs +
  // personas + evaluations).
  const ok = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.review.findFirst({ where: { id, companyId: daraUser.companyId } });
    if (!owned) return false;
    await tx.review.delete({ where: { id } });
    return true;
  });
  if (!ok) redirect('/app/solicitations');
  await recordAudit({
    action: 'review.delete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'review',
    entityId: id
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

// Re-freeze the current proposal draft into a review.
async function captureSnapshotAction(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('reviewId')));
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const summary = await captureSnapshot(id, daraUser.companyId);
  await recordAudit({
    action: 'review.snapshot',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'review',
    entityId: id,
    metadata: { docs: summary.count }
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
  // rfp = the solicitation; proposal = our working draft; amendment = an amendment doc.
  const rawType = String(formData.get('docType') ?? 'rfp');
  const docType = (['rfp', 'proposal', 'amendment'].includes(rawType) ? rawType : 'rfp') as
    | 'rfp'
    | 'proposal'
    | 'amendment';
  const amendmentRaw = String(formData.get('amendmentId') ?? '');
  // Verify the amendment belongs to this solicitation before attributing the file.
  const amendmentId =
    docType === 'amendment' && /^\d+$/.test(amendmentRaw)
      ? (await withTenant(daraUser.companyId, (tx) =>
          tx.amendment.findFirst({
            where: { id: BigInt(amendmentRaw), companyId: daraUser.companyId, solicitationId: solId },
            select: { id: true }
          })
        ))?.id ?? null
      : null;
  // Upload + extraction (Storage + CPU) outside any transaction.
  const doc = await uploadAndExtract(file, daraUser.companyId, 'sol', Date.now());
  const created = await withTenant(daraUser.companyId, (tx) =>
    tx.solDocument.create({
      data: {
        companyId: daraUser.companyId,
        solicitationId: solId,
        docType,
        amendmentId,
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
    metadata: { solicitationId: solId.toString(), filename: doc.originalFilename, docType }
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

// ---- Amendment actions ----
async function createAmendment(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const number = String(formData.get('number') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  if (!number && !title) return;
  const effRaw = String(formData.get('effectiveDate') ?? '').trim();
  const effectiveDate = effRaw ? new Date(effRaw) : null;
  const created = await withTenant(daraUser.companyId, (tx) =>
    tx.amendment.create({
      data: {
        companyId: daraUser.companyId,
        solicitationId: solId,
        number,
        title,
        effectiveDate: effectiveDate && !isNaN(effectiveDate.getTime()) ? effectiveDate : null,
        createdBy: daraUser.id
      }
    })
  );
  await recordAudit({
    action: 'amendment.create',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'amendment',
    entityId: created.id,
    metadata: { solicitationId: solId.toString(), number }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

async function deleteAmendment(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('amendmentId')));
  const solId = BigInt(String(formData.get('solId')));
  // Amendment cascade removes its changes + attributed documents. Remove the stored
  // blobs for those documents (Storage I/O outside any transaction).
  const owned = await withTenant(daraUser.companyId, (tx) =>
    tx.amendment.findFirst({
      where: { id, companyId: daraUser.companyId },
      include: { documents: true }
    })
  );
  if (!owned) redirect('/app/solicitations');
  await removeStored(owned.documents.map((d) => d.storedFilename));
  await withTenant(daraUser.companyId, (tx) => tx.amendment.delete({ where: { id } }));
  await recordAudit({
    action: 'amendment.delete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'amendment',
    entityId: id
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

// AI-diff the amendment against the current compliance matrix → proposed changes.
async function reconcileAmendmentAction(formData: FormData): Promise<{ ok: boolean; count: number; error?: string }> {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('amendmentId')));
  const solId = BigInt(String(formData.get('solId')));
  await requireViewableSolicitation(solId, daraUser);
  const summary = await reconcileAmendment(id, daraUser.companyId);
  await recordAudit({
    action: 'amendment.reconcile',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'amendment',
    entityId: id,
    metadata: {
      ok: summary.ok,
      changes: summary.changes,
      error: summary.error ?? null,
      provider: daraUser.company.activeProvider,
      mode: daraUser.company.aiKeyMode
    }
  });
  revalidatePath(`/app/solicitations/${solId}`);
  return { ok: summary.ok, count: summary.changes, error: summary.error };
}

async function applyChangeAction(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const changeId = BigInt(String(formData.get('changeId')));
  const solId = BigInt(String(formData.get('solId')));
  const accept = String(formData.get('accept') ?? '') === '1';
  await requireViewableSolicitation(solId, daraUser);
  const res = await applyAmendmentChange(changeId, daraUser.companyId, accept);
  await recordAudit({
    action: accept ? 'amendment.change.accept' : 'amendment.change.reject',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'amendment_change',
    entityId: changeId,
    metadata: { ok: res.ok, error: res.error ?? null }
  });
  revalidatePath(`/app/solicitations/${solId}`);
}

// ---- Run a color-team review ----
// Run a color-team review as a multi-pass AI review: enqueue the three passes (Compliance
// & Format → Technical Responsiveness → Risk & Competitive) and kick the async worker so
// they run without blocking the request. The UI polls each pass's status/progress.
async function runReviewAction(formData: FormData): Promise<{ ok: boolean }> {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const reviewId = BigInt(String(formData.get('reviewId')));
  await requireViewableSolicitation(solId, daraUser);

  await enqueueReviewRun(reviewId, daraUser.companyId);
  await recordAudit({
    action: 'review.run',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'review',
    entityId: reviewId,
    // Record the CUI egress target for the data-boundary trail (DARA-007).
    metadata: {
      solicitationId: solId.toString(),
      kind: 'review_passes',
      provider: daraUser.company.activeProvider,
      mode: daraUser.company.aiKeyMode
    }
  });
  // Kick the worker immediately (fire-and-forget); the every-minute cron is the backstop.
  triggerWorker();
  revalidatePath(`/app/solicitations/${solId}`);
  return { ok: true };
}

// Re-run / retry a single pass (leaves the review's other passes untouched).
async function rerunPassAction(formData: FormData): Promise<{ ok: boolean }> {
  'use server';
  const daraUser = await authedUser();
  const solId = BigInt(String(formData.get('solId')));
  const passId = BigInt(String(formData.get('passId')));
  await requireViewableSolicitation(solId, daraUser);
  await enqueuePassRun(passId, daraUser.companyId);
  triggerWorker();
  revalidatePath(`/app/solicitations/${solId}`);
  return { ok: true };
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
        amendments: {
          orderBy: { createdAt: 'desc' },
          include: {
            documents: { orderBy: { uploadedAt: 'desc' } },
            changes: {
              orderBy: { id: 'asc' },
              include: { requirement: { select: { name: true } } }
            }
          }
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: {
            documents: { orderBy: { capturedAt: 'desc' } },
            reviewPersonas: true,
            passes: {
              orderBy: { passType: 'asc' },
              include: { findings: { orderBy: { sortOrder: 'asc' } } }
            }
          }
        },
        evaluations: {
          orderBy: { createdAt: 'desc' },
          include: {
            review: true,
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
  // Active matrix excludes requirements struck by an amendment (retained, not deleted).
  const activeRequirements = solicitation.requirements.filter((r) => !r.removedAt);
  const removedRequirements = solicitation.requirements.filter((r) => r.removedAt);
  // The Review-tab scorecard covers only the EVALUATION FACTORS (scored) — the holistic
  // review. The pass/fail administrative bulk lives in the Compliance tab, not here.
  const scoredFactors = activeRequirements.filter((r) => r.isScored);
  const canEvaluate = activeCount > 0 && activeRequirements.length > 0;
  const reviews = solicitation.reviews;
  const amendments = solicitation.amendments;
  const rfpDocs = solicitation.solDocs.filter((d) => d.docType === 'rfp');
  const proposalDocs = solicitation.solDocs.filter((d) => d.docType === 'proposal');
  // Latest moment the matrix was changed by an applied amendment — a review snapshotted
  // before this saw an outdated matrix (flagged stale in the Color Teams / Review tabs).
  const latestAmendmentAt = amendments
    .map((a) => a.appliedAt)
    .filter((d): d is Date => !!d)
    .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
  const isStale = (rv: { snapshotAt: Date | null; createdAt: Date }) =>
    !!latestAmendmentAt && (rv.snapshotAt ?? rv.createdAt) < latestAmendmentAt;

  // ---- Build the score matrix (reviews × requirements) from evaluation results ----
  // For each review/requirement pair, average the numeric AI scores across every
  // persona that scored it; fall back to the first determination otherwise.
  const cellMap = new Map<string, { scores: number[]; determinations: string[] }>();
  for (const ev of solicitation.evaluations) {
    for (const res of ev.results) {
      const key = `${ev.reviewId.toString()}:${res.requirementId.toString()}`;
      const cell = cellMap.get(key) ?? { scores: [], determinations: [] };
      if (res.aiScore != null) cell.scores.push(Number(res.aiScore));
      else if (res.aiDetermination) cell.determinations.push(res.aiDetermination);
      cellMap.set(key, cell);
    }
  }
  const hasResults = cellMap.size > 0;

  // ===================== Tab panels =====================

  const overviewPanel = (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className={`${card} p-4`}>
        <h2 className={`mb-3 ${sectionTitle}`}>Details</h2>
        <form action={updateSolicitation} className="space-y-2.5">
          <input type="hidden" name="solId" value={sid} />
          <div className="space-y-1">
            <label htmlFor="title" className={labelClasses}>Title <span className="text-[#3b6ef0]">*</span></label>
            <input id="title" name="title" type="text" required defaultValue={solicitation.title} className={fieldClasses} />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="solNumber" className={labelClasses}>Solicitation Number</label>
              <input id="solNumber" name="solNumber" type="text" defaultValue={solicitation.solNumber} className={fieldClasses} />
            </div>
            <div className="space-y-1">
              <label htmlFor="agency" className={labelClasses}>Agency</label>
              <input id="agency" name="agency" type="text" defaultValue={solicitation.agency} className={fieldClasses} />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="notes" className={labelClasses}>Notes</label>
            <textarea id="notes" name="notes" rows={2} defaultValue={solicitation.notes ?? ''} className={fieldClasses} />
          </div>
          <div className="flex justify-end">
            <button type="submit" className={btnPrimary}><Save className="h-4 w-4" />Save</button>
          </div>
        </form>
      </section>

      <div className="space-y-3">
        <section className={`${card} p-4`}>
          <h2 className={`mb-1 ${sectionTitle}`}>Departments</h2>
          <p className="mb-3 text-[12px] text-t4">
            Members of an assigned department can see this solicitation (admins + creator always can).
          </p>
          {allTeams.length === 0 ? (
            <p className="text-[12px] text-t5">
              No departments yet — create them on the{' '}
              <Link href="/app/team" className="text-[#3b6ef0] hover:underline">Team</Link> page.
            </p>
          ) : canManageDepts ? (
            <form action={setSolicitationDepartments} className="space-y-3">
              <input type="hidden" name="solId" value={sid} />
              <div className="flex flex-wrap gap-1.5">
                {allTeams.map((t) => (
                  <label
                    key={t.id.toString()}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] text-t3 transition-colors hover:border-[#3b6ef0]/40 has-[:checked]:border-[#3b6ef0] has-[:checked]:bg-[#3b6ef0]/5 has-[:checked]:text-t1"
                  >
                    <input type="checkbox" name="dept" value={t.id.toString()} defaultChecked={assignedTeamIds.has(t.id.toString())} className="peer sr-only" />
                    <span className="h-2 w-2 rounded-full bg-t5 peer-checked:bg-[#3b6ef0]" />
                    {t.name}
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save</button>
              </div>
            </form>
          ) : solicitation.departments.length === 0 ? (
            <p className="text-[12px] text-t5">No departments assigned.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {solicitation.departments.map((d) => (
                <span key={d.id.toString()} className="inline-flex items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] text-t3">
                  <span className="h-2 w-2 rounded-full bg-[#3b6ef0]" />{d.team.name}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="flex items-center justify-between gap-3 rounded-[10px] border border-[#5a1f1f]/50 bg-surf px-4 py-3">
          <p className="text-[12px] text-t4">
            <span className="font-semibold text-t3">Delete solicitation</span> — removes its
            requirements, reviews, documents, and evaluations. Cannot be undone.
          </p>
          <form action={deleteSolicitation} className="flex-shrink-0">
            <input type="hidden" name="solId" value={sid} />
            <button type="submit" className={btnDanger}><Trash2 className="h-4 w-4" />Delete</button>
          </form>
        </section>
      </div>
    </div>
  );

  const docList = (docs: typeof solicitation.solDocs, empty: string) =>
    docs.length > 0 ? (
      <ul className="mb-4 space-y-2">
        {docs.map((d) => (
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
      <p className="mb-4 text-[13px] text-t5">{empty}</p>
    );

  const documentsPanel = (
    <div className="space-y-4">

      <div className={`${card} p-5`}>
        <h2 className={`mb-1 ${sectionTitle}`}>Solicitation (RFP)</h2>
        <p className="mb-4 text-[13px] text-t4">
          The solicitation itself — the compliance matrix is generated from these.
        </p>
        {docList(rfpDocs, 'No solicitation documents uploaded yet.')}
        <form action={uploadSolDoc} className="flex items-center gap-3">
          <input type="hidden" name="solId" value={sid} />
          <input type="hidden" name="docType" value="rfp" />
          <input type="file" name="file" required accept=".pdf,.docx,.txt,.md" className={fileInputClasses} />
          <button type="submit" className={btnPrimary}><Upload className="h-4 w-4" />Upload</button>
        </form>
      </div>

      <div className={`${card} p-5`}>
        <h2 className={`mb-1 ${sectionTitle}`}>Our proposal (working draft)</h2>
        <p className="mb-4 text-[13px] text-t4">
          The draft your color teams review. Each review freezes a snapshot of these at
          the moment it is captured.
        </p>
        {docList(proposalDocs, 'No proposal documents uploaded yet.')}
        <form action={uploadSolDoc} className="flex items-center gap-3">
          <input type="hidden" name="solId" value={sid} />
          <input type="hidden" name="docType" value="proposal" />
          <input type="file" name="file" required accept=".pdf,.docx,.txt,.md" className={fileInputClasses} />
          <button type="submit" className={btnGhost}><Upload className="h-4 w-4" />Upload</button>
        </form>
      </div>
    </div>
  );

  const requirements = activeRequirements;
  const statusCounts = COMPLIANCE_STATUSES.map((s) => ({
    ...s,
    n: requirements.filter((r) => r.complianceStatus === s.value).length
  }));

  const compliancePanel = (
    <div className="space-y-4">

      {/* Generate + summary */}
      <div className={`${card} p-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className={sectionTitle}>Compliance matrix</h2>
            <p className="mt-1 max-w-xl text-[13px] text-t4">
              <span className="font-semibold text-t2">1.</span> Shred the solicitation — each
              requirement is auto-classified as <span className="text-t2">Scored</span> (Section&nbsp;M
              factors → holistic color-team review), <span className="text-t2">Compliance</span>{' '}
              (pass/fail, addressed in your proposal), or <span className="text-t2">Administrative</span>{' '}
              (complied with but not written up — reps &amp; certs, submission logistics).
              <span className="font-semibold text-t2"> 2.</span> Adjust any row's type if needed.
              <span className="font-semibold text-t2"> 3.</span>{' '}
              <span className="text-t2">Run compliance check</span> to grade the Compliance items
              (Met / Partial / Gap) against your proposal draft.
            </p>
          </div>
          <div className="no-print flex flex-shrink-0 flex-col gap-2">
            <AiActionButton
              action={generateMatrixAction}
              fields={{ solId: sid }}
              idle={<Sparkles className="h-4 w-4" />}
              label={requirements.length ? 'Generate more' : 'Generate from solicitation'}
              pendingLabel="Reading the solicitation & extracting requirements…"
              noun="requirement"
              verb="added"
              className={btnPrimary}
            />
            {requirements.some((r) => r.disposition === 'compliance') && (
              <AiActionButton
                action={runComplianceCheckAction}
                fields={{ solId: sid }}
                idle={<CheckSquare className="h-4 w-4" />}
                label="Run compliance check"
                pendingLabel={`Grading ${requirements.filter((r) => r.disposition === 'compliance').length} pass/fail requirements against your proposal…`}
                noun="requirement"
                verb="checked"
                className={btnGhost}
              />
            )}
            {requirements.length > 0 && <PrintButton label="Print matrix" className={btnGhost} />}
          </div>
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

      {/* Compliance matrix — dense, inline-editable table */}
      {requirements.length === 0 ? (
        <div className={`${cardDashed} flex flex-col items-center justify-center px-6 py-10 text-center`}>
          <Inbox className="h-8 w-8 text-t5" />
          <p className="mt-3 text-[13px] text-t4">
            No requirements yet. Generate them from the solicitation above, or add one manually below.
          </p>
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[112px_minmax(0,1fr)_138px_118px_120px_36px_36px] items-center gap-2 bg-surf2 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">
              <span>Status</span>
              <span>Requirement</span>
              <span>Source</span>
              <span>Type</span>
              <span>Proposal ref</span>
              <span className="col-span-2 text-right">Edit</span>
            </div>
            {requirements.map((r) => (
              <div
                key={r.id.toString()}
                className="grid grid-cols-[112px_minmax(0,1fr)_138px_118px_120px_36px_36px] items-center gap-2 border-t border-line px-3 py-1.5"
              >
                <form action={updateRequirement} className="contents">
                  <input type="hidden" name="solId" value={sid} />
                  <input type="hidden" name="requirementId" value={r.id.toString()} />
                  <input type="hidden" name="description" value={r.description ?? ''} />
                  <input type="hidden" name="farReference" value={r.farReference} />
                  <input type="hidden" name="weight" value={r.weight} />
                  <select
                    name="complianceStatus"
                    defaultValue={r.complianceStatus}
                    className={`w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] font-semibold outline-none ${STATUS_PILL[r.complianceStatus]}`}
                  >
                    {COMPLIANCE_STATUSES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                  <div className="min-w-0">
                    <input
                      name="name"
                      defaultValue={r.name}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-t2 outline-none hover:border-line focus:border-[#3b6ef0]/50"
                    />
                    <div className="flex items-center gap-1.5 px-1">
                      {r.citation && (
                        <span className="flex-shrink-0 font-mono text-[10px] text-t5" title={r.citation}>{r.citation}</span>
                      )}
                      {r.addedByAmendmentId && (
                        <span className="flex-shrink-0 rounded bg-[#1f5a31]/25 px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-[#7de0a0]">new</span>
                      )}
                      {r.changedByAmendmentId && (
                        <span className="flex-shrink-0 rounded bg-[#5a4a1f]/30 px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-[#e0c97d]">amended v{r.version}</span>
                      )}
                    </div>
                    <div className="px-1">
                      <RequirementDetail
                        abridged={r.description ?? ''}
                        name={r.name}
                        description={r.description ?? ''}
                        citation={r.citation}
                        source={SOURCE_LABEL[r.source] ?? r.source}
                        farReference={r.farReference}
                        status={COMPLIANCE_LABEL[r.complianceStatus] ?? r.complianceStatus}
                        proposalRef={r.proposalRef}
                        disposition={REQUIREMENT_DISPOSITIONS.find((d) => d.value === r.disposition)?.label ?? DISPOSITION_LABEL[r.disposition] ?? r.disposition}
                      />
                    </div>
                  </div>
                  <select
                    name="source"
                    defaultValue={r.source}
                    className="w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-t3 outline-none"
                  >
                    {REQUIREMENT_SOURCES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                  <select
                    name="disposition"
                    defaultValue={r.disposition}
                    className="w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-t3 outline-none"
                  >
                    {REQUIREMENT_DISPOSITIONS.map((o) => (<option key={o.value} value={o.value}>{o.short}</option>))}
                  </select>
                  <input
                    name="proposalRef"
                    defaultValue={r.proposalRef}
                    placeholder="Vol/§/pg"
                    className="w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-t2 outline-none focus:border-[#3b6ef0]/50"
                  />
                  <button type="submit" title="Save row" className="flex justify-center rounded border border-line py-1 text-t4 transition-colors hover:text-[#7de0a0]">
                    <Save className="h-3.5 w-3.5" />
                  </button>
                </form>
                <form action={deleteRequirement} className="contents">
                  <input type="hidden" name="solId" value={sid} />
                  <input type="hidden" name="requirementId" value={r.id.toString()} />
                  <button type="submit" title="Delete row" className="flex justify-center rounded border border-line py-1 text-t5 transition-colors hover:text-[#e07d7d]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Removed by amendment (retained, excluded from the active matrix) */}
      {removedRequirements.length > 0 && (
        <details className="rounded-lg border border-dashed border-line p-3">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
            Removed by amendment ({removedRequirements.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {removedRequirements.map((r) => (
              <div key={r.id.toString()} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-t4 line-through">
                <span className="truncate">{r.name}</span>
                <span className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wide text-t5">{SOURCE_LABEL[r.source]}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Add requirement */}
      <AddSection label="Add requirement">
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
            <div className="space-y-1.5 sm:col-span-5">
              <label className={labelClasses}>Type</label>
              <select name="disposition" defaultValue="compliance" className={fieldClasses}>
                {REQUIREMENT_DISPOSITIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-4">
              <label className={labelClasses}>FAR Ref.</label>
              <input name="farReference" type="text" className={fieldClasses} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <label className={labelClasses}>Weight</label>
              <input name="weight" type="number" defaultValue={0} className={fieldClasses} />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" />Add requirement</button>
          </div>
        </form>
      </AddSection>
    </div>
  );

  const personaChips = (selected: Set<string>) => (
    <div className="space-y-1.5">
      <label className={labelClasses}>Reviewers (personas)</label>
      {personas.length === 0 ? (
        <p className="text-[12px] text-t5">
          No personas yet — create them on the{' '}
          <Link href="/app/personas" className="text-[#3b6ef0] hover:underline">Personas</Link> page.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {personas.map((p) => (
            <label
              key={p.id.toString()}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] transition-colors hover:border-[#3b6ef0]/40 has-[:checked]:border-[#3b6ef0] has-[:checked]:bg-[#3b6ef0]/5 has-[:checked]:text-t1 ${p.isActive ? 'text-t3' : 'text-t5'}`}
            >
              <input type="checkbox" name="persona" value={p.id.toString()} defaultChecked={selected.has(p.id.toString())} className="peer sr-only" />
              <span className="h-2 w-2 rounded-full bg-t5 peer-checked:bg-[#3b6ef0]" />
              {p.icon ? `${p.icon} ` : ''}{p.displayName}{p.isActive ? '' : ' (inactive)'}
            </label>
          ))}
        </div>
      )}
      <p className="text-[11px] text-t5">No reviewers selected → all active personas run.</p>
    </div>
  );

  const colorStage = (focusColor: string) => {
    const meta = STAGE_META[focusColor] ?? { focus: '', desc: '' };
    const ct = COLOR_TEAM_MAP[focusColor] ?? COLOR_TEAM_MAP.pink;
    const stageReviews = reviews.filter((rv) => rv.colorTeam === focusColor);
    return (
    <div className="space-y-4">
      {/* Stage header */}
      <div className={`${card} p-4`} style={{ borderLeft: `3px solid ${ct.dot}` }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ct.dot }} />
          <h2 className={`text-[15px] font-bold ${ct.text}`}>{ct.label} Team</h2>
          <span className="text-[11px] text-t5">· {meta.focus}</span>
        </div>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-t4">{meta.desc}</p>
      </div>

      {!canEvaluate && (
        <p className="rounded-lg border border-[#5a4a1f]/50 bg-surf px-4 py-2.5 text-[12px] text-[#e0c97d]">
          To run a review you need at least one requirement (Compliance stage) and one active
          persona ({activeRequirements.length} requirements, {activeCount} active personas).
        </p>
      )}
      {proposalDocs.length === 0 && (
        <p className="rounded-lg border border-line bg-surf px-4 py-2.5 text-[12px] text-t4">
          Upload your proposal working draft on the <span className="text-t2">Solicitation</span> stage,
          then capture a snapshot for each review.
        </p>
      )}
      {stageReviews.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-4 py-3 text-[12px] text-t4">
          No {ct.label}-team reviews yet — create one below to run a holistic {ct.label.toLowerCase()}-team
          review of your current draft.
        </p>
      )}

      {stageReviews.map((rv) => {
        const ct = COLOR_TEAM_MAP[rv.colorTeam] ?? COLOR_TEAM_MAP.pink;
        const sel = new Set(rv.reviewPersonas.map((rp) => rp.personaId.toString()));
        const reviewEvals = solicitation.evaluations.filter((e) => e.reviewId === rv.id);
        return (
          <div key={rv.id.toString()} className={`${card} p-3`}>
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: ct.dot }} />
              <span className="text-[13px] font-semibold text-t1">{rv.name}</span>
              <StatusBadge status={rv.status} />
              {isStale(rv) && (
                <span className="rounded bg-[#5a4a1f]/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#e0c97d]">
                  pre-amendment
                </span>
              )}
              <span className="ml-auto text-[11px] text-t5">
                {rv.snapshotAt ? `${rv.documents.length} doc snapshot · ${fmtDate(rv.snapshotAt)}` : 'no draft captured'}
                {' · '}{sel.size || activeCount} reviewers
              </span>
            </div>

            {/* Snapshot / delete controls */}
            <div className="no-print mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-2">
              <form action={captureSnapshotAction}>
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="reviewId" value={rv.id.toString()} />
                <button type="submit" className={`${btnGhost} !py-1.5 !text-[12px]`}><Upload className="h-3.5 w-3.5" />{rv.snapshotAt ? 'Re-capture' : 'Capture draft'}</button>
              </form>
              <form action={deleteReview}>
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="reviewId" value={rv.id.toString()} />
                <button type="submit" title="Delete review" className="rounded border border-line p-1.5 text-t5 transition-colors hover:text-[#e07d7d]"><Trash2 className="h-3.5 w-3.5" /></button>
              </form>
            </div>

            {/* Multi-pass AI review */}
            <div className="mt-3 border-t border-line pt-3">
              <ReviewPassPanel
                solId={sid}
                reviewId={rv.id.toString()}
                canRun={canEvaluate && rv.documents.length > 0}
                disabledReason={
                  rv.documents.length === 0
                    ? 'Capture the proposal draft first (button above).'
                    : 'Add at least one requirement (Compliance stage) and one active persona.'
                }
                runAction={runReviewAction}
                rerunAction={rerunPassAction}
                passes={rv.passes.map((p) => ({
                  id: p.id.toString(),
                  passType: p.passType,
                  status: p.status,
                  score: p.score,
                  progress: p.progress,
                  progressLabel: p.progressLabel,
                  findingsCount: p.findingsCount,
                  errorMessage: p.errorMessage,
                  findings: p.findings.map((f) => ({
                    id: f.id.toString(),
                    severity: f.severity,
                    text: f.text,
                    requirementRef: f.requirementRef,
                    recommendedAction: f.recommendedAction
                  }))
                }))}
              />
            </div>

            {/* Legacy per-reviewer holistic findings (prior runs) */}
            {reviewEvals.some((e) => e.results.some((res) => !res.archivedAt)) && (
              <details className="no-print mt-3 border-t border-line pt-2">
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                  Earlier per-reviewer findings ({reviewEvals.length})
                </summary>
                <div className="mt-2 space-y-3">
                  {reviewEvals.map((e) => {
                    const active = e.results.filter((res) => !res.archivedAt);
                    if (active.length === 0) return null;
                    return (
                      <div key={e.id.toString()}>
                        <div className="mb-1.5 flex items-center gap-2 text-[12px]">
                          <span className="font-semibold text-t2">{personaMap.get(e.personaId.toString()) ?? 'Reviewer'}</span>
                          <StatusBadge status={e.status} />
                        </div>
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {/* Settings (collapsed) */}
            <details className="no-print mt-3 border-t border-line pt-2">
              <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                Review settings
              </summary>
              <form action={updateReview} className="mt-2 space-y-3">
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="reviewId" value={rv.id.toString()} />
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="space-y-1.5 sm:col-span-8">
                    <label className={labelClasses}>Review name</label>
                    <input name="name" type="text" defaultValue={rv.name} className={fieldClasses} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-4">
                    <label className={labelClasses}>Color team</label>
                    <select name="colorTeam" defaultValue={rv.colorTeam} className={fieldClasses}>
                      {COLOR_TEAMS.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClasses}>Notes</label>
                  <input name="notes" type="text" defaultValue={rv.notes ?? ''} className={fieldClasses} />
                </div>
                {personaChips(sel)}
                <div className="flex justify-end">
                  <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save settings</button>
                </div>
              </form>
            </details>
          </div>
        );
      })}

      <AddSection label={`New ${ct.label}-team review`}>
        <form action={createReview} className="space-y-3">
          <input type="hidden" name="solId" value={sid} />
          <input type="hidden" name="colorTeam" value={focusColor} />
          <div className="space-y-1.5">
            <label className={labelClasses}>Review name <span className="text-[#3b6ef0]">*</span></label>
            <input name="name" type="text" required defaultValue={`${ct.label} Team review`} className={fieldClasses} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClasses}>Notes</label>
            <input name="notes" type="text" className={fieldClasses} />
          </div>
          {personaChips(new Set(personas.filter((p) => p.isActive).map((p) => p.id.toString())))}
          <div className="flex justify-end">
            <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" />Create {ct.label} review</button>
          </div>
        </form>
      </AddSection>
    </div>
    );
  };

  // Only 'running' = actively processing in a live request. 'pending' now means a
  // time-boxed run paused mid-way (resume by clicking Run again), so it must NOT spin
  // the live banner.
  const runningEvals = solicitation.evaluations.filter((e) => e.status === 'running');
  const runningCount = runningEvals.length;
  // Live progress from the accumulating results: how many factor assessments are done
  // across the running evaluations, and which factor is being reviewed right now.
  let factorsDone = 0;
  let currentFactorName = '';
  for (const e of runningEvals) {
    const doneForEval = e.results.filter((r) => !r.archivedAt);
    factorsDone += doneForEval.length;
    if (!currentFactorName) {
      const doneIds = new Set(doneForEval.map((r) => r.requirementId.toString()));
      const next = scoredFactors.find((f) => !doneIds.has(f.id.toString()));
      if (next) currentFactorName = next.name;
    }
  }
  const factorsTotal = runningEvals.length * scoredFactors.length;
  const runLabel = currentFactorName
    ? `Reviewing “${currentFactorName}”`
    : factorsTotal > 0
      ? 'Finishing factor reviews…'
      : 'Checking compliance…';

  const reviewPanel = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-t1">Review results</h2>
        {solicitation.evaluations.length > 0 && <PrintButton label="Print results" className={`no-print ${btnGhost}`} />}
      </div>

      {/* Scorecard: reviews × EVALUATION FACTORS (scored). The pass/fail administrative
          requirements are graded on the Compliance tab, not in this scorecard. */}
      {hasResults && scoredFactors.length > 0 && reviews.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className={sectionTitle}>Scorecard — evaluation factors</h2>
            <span className="text-[11px] text-t5">
              Pass/fail compliance → <span className="text-t3">Compliance</span> tab
            </span>
          </div>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surf3">
                  <th className="sticky left-0 z-10 bg-surf3 px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                    Review
                  </th>
                  {scoredFactors.map((c) => (
                    <th key={c.id.toString()} className="px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wide text-t5">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => {
                  const ct = COLOR_TEAM_MAP[r.colorTeam] ?? COLOR_TEAM_MAP.pink;
                  return (
                    <tr key={r.id.toString()} className="border-t border-line">
                      <td className="sticky left-0 z-10 bg-surf px-[18px] py-3 text-[13px] font-semibold text-t2">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: ct.dot }} />
                          {r.name}
                        </span>
                      </td>
                      {scoredFactors.map((c) => {
                        const cell = cellMap.get(`${r.id.toString()}:${c.id.toString()}`);
                        let label = '—';
                        let color = 'text-t5';
                        if (cell && cell.scores.length > 0) {
                          const avg = Math.round(cell.scores.reduce((a, b) => a + b, 0) / cell.scores.length);
                          label = `${avg}`;
                          color = avg >= 75 ? 'text-[#7de0a0]' : avg >= 50 ? 'text-[#6f9bf5]' : 'text-[#e0a07d]';
                        }
                        return (
                          <td key={c.id.toString()} className={`px-3.5 py-3 text-center text-[13px] font-semibold ${color}`}>
                            {label}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`${cardDashed} flex flex-col items-center justify-center px-6 py-12 text-center`}>
          <Inbox className="h-9 w-9 text-t5" />
          <p className="mt-3 max-w-md text-[13px] text-t4">
            No holistic review results yet. On the <span className="text-t3">Compliance</span> tab,
            generate the matrix (the Section&nbsp;M factors are auto-classified{' '}
            <span className="text-t3">Scored</span>); upload your proposal draft (Documents); then create and run a review from{' '}
            <span className="text-t3">Color Teams</span>. The rich per-factor findings appear below.
          </p>
        </div>
      )}

      {/* Holistic findings, per reviewer (persona) */}
      {solicitation.evaluations.length > 0 && (
        <div className="space-y-4">
          <h2 className={sectionTitle}>
            Holistic findings by reviewer{' '}
            <span className="font-mono text-[11px] font-normal text-t5">
              ({solicitation.evaluations.length})
            </span>
          </h2>
          {solicitation.evaluations.map((e) => (
            <div key={e.id.toString()} className={`${card} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px]">
                  {e.review && (
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: (COLOR_TEAM_MAP[e.review.colorTeam] ?? COLOR_TEAM_MAP.pink).dot }}
                    />
                  )}
                  <span className="font-semibold text-t1">{personaMap.get(e.personaId.toString()) ?? 'Persona'}</span>
                  <span className="text-t4"> · {e.review?.name ?? '—'}</span>
                  {e.review && isStale(e.review) && (
                    <span className="rounded bg-[#5a4a1f]/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#e0c97d]">
                      pre-amendment
                    </span>
                  )}
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

  const CHANGE_BADGE: Record<string, string> = {
    add: 'bg-[#1f5a31]/25 text-[#7de0a0]',
    modify: 'bg-[#5a4a1f]/30 text-[#e0c97d]',
    remove: 'bg-[#5a1f1f]/30 text-[#e07d7d]'
  };

  const amendmentsPanel = (
    <div className="space-y-4">
      <p className="text-[13px] text-t4">
        Upload an amendment, then reconcile it with AI: it diffs the amendment against the
        current compliance matrix and proposes additions, modifications, and removals for
        your approval. Accepted changes fold into the matrix (modified requirements are
        versioned; removed ones are retained but struck).
      </p>

      {/* Amendment log */}
      {amendments.length > 0 && (
        <div>
          <h3 className={`mb-2 ${sectionTitle}`}>Amendment log</h3>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="bg-surf2">
                  {['Amendment', 'Title', 'Effective', 'Docs', 'Changes', 'Status'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5 ${i >= 3 ? 'text-center' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {amendments.map((a) => (
                  <tr key={a.id.toString()} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-t2">#{a.number || '—'}</td>
                    <td className="px-3 py-2 text-t3">{a.title || <span className="text-t5">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-t4">{a.effectiveDate ? fmtDate(a.effectiveDate) : '—'}</td>
                    <td className="px-3 py-2 text-center text-t4">{a.documents.length}</td>
                    <td className="px-3 py-2 text-center text-t4">{a.changes.length}</td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={a.reconciliationStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {amendments.map((a) => {
        const proposedChanges = a.changes.filter((c) => c.status === 'proposed');
        const resolved = a.changes.filter((c) => c.status !== 'proposed');
        return (
          <div key={a.id.toString()} className={`${card} p-4`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-semibold text-t1">
                  Amendment {a.number || '—'}
                </span>
                {a.title && <span className="text-t4">· {a.title}</span>}
                {a.effectiveDate && (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-t5">
                    eff. {fmtDate(a.effectiveDate)}
                  </span>
                )}
                <StatusBadge status={a.reconciliationStatus} />
              </div>
              <form action={deleteAmendment}>
                <input type="hidden" name="solId" value={sid} />
                <input type="hidden" name="amendmentId" value={a.id.toString()} />
                <button type="submit" className="text-[#e07d7d] transition-colors hover:text-[#ff9b9b]"><Trash2 className="h-4 w-4" /></button>
              </form>
            </div>

            {/* Amendment documents */}
            {a.documents.length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {a.documents.map((d) => (
                  <li key={d.id.toString()} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
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
            )}
            <form action={uploadSolDoc} className="flex items-center gap-3">
              <input type="hidden" name="solId" value={sid} />
              <input type="hidden" name="docType" value="amendment" />
              <input type="hidden" name="amendmentId" value={a.id.toString()} />
              <input type="file" name="file" required accept=".pdf,.docx,.txt,.md" className={fileInputClasses} />
              <button type="submit" className={btnGhost}><Upload className="h-4 w-4" />Upload</button>
            </form>

            {/* Reconcile */}
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
              <AiActionButton
                action={reconcileAmendmentAction}
                fields={{ solId: sid, amendmentId: a.id.toString() }}
                idle={<Sparkles className="h-4 w-4" />}
                label={a.changes.length ? 'Re-reconcile with AI' : 'Reconcile with AI'}
                pendingLabel="Diffing the amendment against the compliance matrix…"
                noun="change"
                verb="proposed"
                className={btnPrimary}
                disabled={a.documents.length === 0}
              />
            </div>

            {a.aiSummary && (
              <p className="mt-3 rounded-lg border border-line bg-bg px-3 py-2 text-[12px] leading-relaxed text-t3">
                {a.aiSummary}
              </p>
            )}

            {/* Proposed changes */}
            {proposedChanges.length > 0 && (
              <div className="mt-3 space-y-2">
                <h4 className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                  Proposed changes ({proposedChanges.length})
                </h4>
                {proposedChanges.map((c) => {
                  const p = (c.proposed ?? {}) as any;
                  return (
                    <div key={c.id.toString()} className="rounded-lg border border-line bg-bg p-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${CHANGE_BADGE[c.changeType]}`}>
                          {c.changeType}
                        </span>
                        <span className="text-[13px] font-semibold text-t2">
                          {c.changeType === 'remove' ? (c.requirement?.name ?? 'Requirement') : (p.name ?? 'Requirement')}
                        </span>
                      </div>
                      {c.changeType === 'modify' && c.requirement && (
                        <p className="mt-1 text-[11px] text-t5">Replaces: {c.requirement.name}</p>
                      )}
                      {c.changeType !== 'remove' && p.description && (
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-t3">{p.description}</p>
                      )}
                      {c.rationale && (
                        <p className="mt-1 text-[11px] italic text-t4">{c.rationale}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <form action={applyChangeAction}>
                          <input type="hidden" name="solId" value={sid} />
                          <input type="hidden" name="changeId" value={c.id.toString()} />
                          <input type="hidden" name="accept" value="1" />
                          <button type="submit" className={`${btnGhost} !py-1.5 !text-[12px]`}>Accept</button>
                        </form>
                        <form action={applyChangeAction}>
                          <input type="hidden" name="solId" value={sid} />
                          <input type="hidden" name="changeId" value={c.id.toString()} />
                          <input type="hidden" name="accept" value="0" />
                          <button type="submit" className={`${btnGhost} !py-1.5 !text-[12px]`}>Reject</button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {resolved.length > 0 && (
              <details className="mt-3 rounded-lg border border-dashed border-line p-2">
                <summary className="cursor-pointer list-none px-1 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                  Resolved ({resolved.length})
                </summary>
                <div className="mt-2 space-y-1.5">
                  {resolved.map((c) => {
                    const p = (c.proposed ?? {}) as any;
                    return (
                      <div key={c.id.toString()} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-1.5 text-[12px]">
                        <span className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${CHANGE_BADGE[c.changeType]}`}>{c.changeType}</span>
                          <span className="truncate text-t3">{c.changeType === 'remove' ? (c.requirement?.name ?? '—') : (p.name ?? '—')}</span>
                        </span>
                        <span className={`font-mono text-[10px] uppercase tracking-wide ${c.status === 'accepted' ? 'text-[#7de0a0]' : 'text-[#e07d7d]'}`}>{c.status}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        );
      })}

      <AddSection label="Log new amendment">
        <form action={createAmendment} className="space-y-3">
          <input type="hidden" name="solId" value={sid} />
          <div className="grid gap-3 sm:grid-cols-12">
            <div className="space-y-1.5 sm:col-span-3">
              <label className={labelClasses}>Number</label>
              <input name="number" type="text" placeholder="e.g. 0001" className={fieldClasses} />
            </div>
            <div className="space-y-1.5 sm:col-span-6">
              <label className={labelClasses}>Title</label>
              <input name="title" type="text" placeholder="e.g. Revised SOW + due date" className={fieldClasses} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <label className={labelClasses}>Effective date</label>
              <input name="effectiveDate" type="date" className={fieldClasses} />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" />Add amendment</button>
          </div>
        </form>
      </AddSection>
    </div>
  );

  // Advisory "done" flags — the pipeline is a suggestion, so these only tint the dots.
  const colorDone = (c: string) => reviews.some((rv) => rv.colorTeam === c && rv.status === 'complete');
  const anyComplianceChecked = activeRequirements.some(
    (r) => r.disposition === 'compliance' && r.complianceStatus !== 'not_assessed'
  );
  const anyReviewComplete = reviews.some((rv) => rv.status === 'complete');

  const pipelineViews: Record<string, React.ReactNode> = {
    documents: documentsPanel,
    compliance: compliancePanel,
    overview: overviewPanel,
    pink: colorStage('pink'),
    red: colorStage('red'),
    gold: colorStage('gold'),
    white: colorStage('white'),
    review: reviewPanel,
    amendments: amendmentsPanel
  };

  const pipelineStages = [
    { id: 's1', num: 1, label: 'Solicitation', sub: 'RFP & proposal', color: '#3b6ef0', view: 'documents', done: rfpDocs.length > 0 },
    { id: 's2', num: 2, label: 'Compliance', sub: 'Shred & matrix', color: '#3b6ef0', view: 'compliance', done: activeRequirements.length > 0 },
    { id: 's3', num: 3, label: 'Kickoff', sub: 'Setup & draft', color: '#3b6ef0', view: 'overview', done: proposalDocs.length > 0 },
    { id: 's4', num: 4, label: 'Pink Team', sub: 'Strategy & outline', color: '#ec4899', view: 'pink', done: colorDone('pink') },
    { id: 's5', num: 5, label: 'Red Team', sub: 'Full draft review', color: '#ef4444', view: 'red', done: colorDone('red') },
    { id: 's6', num: 6, label: 'Gold Team', sub: 'Executive review', color: '#f59e0b', view: 'gold', done: colorDone('gold') },
    { id: 's7', num: 7, label: 'White Glove', sub: 'Production ready', color: '#94a3b8', view: 'white', done: colorDone('white') },
    { id: 's8', num: 8, label: 'Compliance', sub: 'Final check', color: '#3b6ef0', view: 'compliance', done: anyComplianceChecked },
    { id: 's9', num: 9, label: 'Submit', sub: 'Proposal', color: '#22c55e', view: 'review', done: anyReviewComplete }
  ];

  const pipelineTools = [{ id: 'amendments', label: 'Amendments', view: 'amendments', badge: amendments.length }];

  return (
    <div className="mx-auto max-w-6xl fade">
      <Link
        href="/app/solicitations"
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-t4 transition-colors hover:text-t1"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Solicitations
      </Link>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-t5">
            {solicitation.solNumber || 'No reference number'}
            {solicitation.agency ? ` · ${solicitation.agency}` : ''}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-t1">{solicitation.title}</h1>
          <p className="mt-1 text-[12px] text-t5">
            Color review cycle — a suggested flow. Every stage is optional; jump to any stage.
          </p>
        </div>
        <div className="flex-shrink-0 pt-1">
          <CuiBoundaryModal
            provider={daraUser.company.activeProvider}
            mode={daraUser.company.aiKeyMode}
          />
        </div>
      </div>

      <RunningBanner
        count={runningCount}
        done={factorsDone}
        total={factorsTotal}
        currentLabel={runLabel}
      />

      <PipelineStepper stages={pipelineStages} tools={pipelineTools} views={pipelineViews} />
    </div>
  );
}
