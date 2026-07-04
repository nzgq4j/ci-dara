import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import { uploadAndExtract } from '@/utils/dara/documents';
import { enqueueDirectReview } from '@/utils/dara/direct-review';
import { triggerWorker } from '@/utils/dara/passes';
import UploadAndReview from '@/components/dara/UploadAndReview';

type CreateResult = { ok: boolean; error?: string };

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim();
}

// Screen 4 — create the solicitation, store its documents, and (for Direct AI mode) kick off
// the unified review, then land the user on the workspace. Color Team mode creates the
// solicitation and opens the workspace to configure passes (no auto-run).
async function createAndRunReview(formData: FormData): Promise<CreateResult> {
  'use server';

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  const companyId = daraUser.companyId;

  const mode = String(formData.get('mode') ?? 'direct_ai') === 'color_team' ? 'color_team' : 'direct_ai';
  const solNumber = String(formData.get('solNumber') ?? '').trim();
  const agency = String(formData.get('agency') ?? '').trim();
  const naics = String(formData.get('naics') ?? '').trim().slice(0, 20);
  const dueRaw = String(formData.get('dueDate') ?? '').trim();
  const dueParsed = dueRaw ? new Date(dueRaw) : null;
  const dueDate = dueParsed && !isNaN(dueParsed.getTime()) ? dueParsed : null;

  const rfpFiles = formData.getAll('rfpFiles').filter((f): f is File => f instanceof File && f.size > 0);
  const proposalFiles = formData
    .getAll('proposalFiles')
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (rfpFiles.length === 0 && proposalFiles.length === 0 && !solNumber) {
    return { ok: false, error: 'Add at least one document or a solicitation number to get started.' };
  }

  // Title isn't a field on Screen 4; derive it from the sol number or the first uploaded file.
  const title =
    solNumber ||
    (rfpFiles[0] ? stripExt(rfpFiles[0].name) : '') ||
    (proposalFiles[0] ? stripExt(proposalFiles[0].name) : '') ||
    'New solicitation';

  const sol = await withTenant(companyId, (tx) =>
    tx.solicitation.create({
      data: { companyId, title: title.slice(0, 500), solNumber, agency, naics, dueDate, mode, createdBy: daraUser.id }
    })
  );

  await recordAudit({
    action: 'solicitation.create',
    companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'solicitation',
    entityId: sol.id,
    metadata: { title, mode }
  });

  // Store documents (upload + extraction outside any transaction, one row per file).
  const uploads: { file: File; docType: 'rfp' | 'proposal' }[] = [
    ...rfpFiles.map((file) => ({ file, docType: 'rfp' as const })),
    ...proposalFiles.map((file) => ({ file, docType: 'proposal' as const }))
  ];
  for (const { file, docType } of uploads) {
    try {
      const doc = await uploadAndExtract(file, companyId, 'sol', Date.now());
      const created = await withTenant(companyId, (tx) =>
        tx.solDocument.create({
          data: {
            companyId,
            solicitationId: sol.id,
            docType,
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
        companyId,
        actorId: daraUser.id,
        actorEmail: daraUser.email,
        entityType: 'sol_document',
        entityId: created.id,
        metadata: { solicitationId: sol.id.toString(), filename: doc.originalFilename, docType }
      });
    } catch (e) {
      // Surface the failure but keep the created solicitation — the user can retry the upload
      // from the workspace rather than losing everything.
      return {
        ok: false,
        error: e instanceof Error ? `Upload failed: ${e.message}` : 'A document failed to upload.'
      };
    }
  }

  // Auto-run the unified review only when there's a proposal draft to score. Without one, we
  // still create the solicitation and drop the user in the workspace to add the draft + run.
  if (mode === 'direct_ai' && proposalFiles.length > 0) {
    await enqueueDirectReview(sol.id, companyId);
    await recordAudit({
      action: 'review.run',
      companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'solicitation',
      entityId: sol.id,
      // CUI egress trail for the data boundary (DARA-007).
      metadata: {
        kind: 'direct_review',
        provider: daraUser.company.activeProvider,
        aiMode: daraUser.company.aiKeyMode
      }
    });
    triggerWorker();
  }

  redirect(`/app/solicitations/${sol.id}`);
}

export default async function NewSolicitationPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  return (
    <div className="mx-auto max-w-2xl fade">
      <Link
        href="/app/solicitations"
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-t4 transition-colors hover:text-t1"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Solicitations
      </Link>
      <h1 className="text-2xl font-bold tracking-tight text-t1">New Solicitation</h1>
      <p className="mb-7 text-[13px] text-t4">
        Upload a solicitation and your proposal draft to run an instant AI review.
      </p>

      <UploadAndReview action={createAndRunReview} />
    </div>
  );
}
