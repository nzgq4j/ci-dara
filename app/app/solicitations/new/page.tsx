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

type ShellResult = { ok: boolean; error?: string; solId?: string };
type StepResult = { ok: boolean; error?: string; redirect?: string };

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim();
}

// The prod DB path (Supabase transaction-mode pooler) intermittently rejects a connection with
// P1001 (DatabaseNotReachable) or trips an interactive-transaction timeout (P2028). These are
// transient — a short retry clears them — and were a silent cause of "the solicitation just
// didn't get created." Retry only these codes; anything else is a real error, surfaced as-is.
const TRANSIENT_DB_CODES = new Set(['P1001', 'P1002', 'P1017', 'P2024', 'P2028']);

function isTransientDbError(e: unknown): boolean {
  return TRANSIENT_DB_CODES.has((e as { code?: string })?.code ?? '');
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransientDbError(e) || attempt === 3) throw e;
      console.warn(`[new-sol] ${label}: transient DB error ${(e as { code?: string }).code} — retry ${attempt}/2`);
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw lastErr;
}

function isRedirectError(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

// Turn a thrown server-side error into a structured result the client can render, so a failure
// shows a real message instead of silently dropping the user back to the form. redirect() (auth
// bounce) must be re-thrown so Next can perform the navigation.
function toError(label: string, e: unknown): { ok: false; error: string } {
  if (isRedirectError(e)) throw e;
  const code = (e as { code?: string })?.code;
  console.error(`[new-sol] ${label} failed:`, code ?? '', (e as Error)?.message ?? e);
  if (isTransientDbError(e)) {
    return { ok: false, error: 'The database was briefly unreachable. Please try again.' };
  }
  return { ok: false, error: (e as Error)?.message ? `${label} failed: ${(e as Error).message}` : `${label} failed.` };
}

// Screen 4 is now a THREE-step client-orchestrated flow so no single request carries every
// file at once. Vercel caps a Function's request body at ~4.5 MB regardless of Next's
// `serverActions.bodySizeLimit`, so bundling all uploads into one server action 413s (and the
// solicitation is never created) once the combined size crosses that line. Uploading one file
// per request — as the workspace DocUploader already does — keeps every request small.
//
//   1. createSolShell  — create the solicitation row from metadata only (tiny body).
//   2. uploadDocToSol  — upload ONE file (called once per file, client-side).
//   3. finalizeReview  — enqueue the Direct AI review (if applicable) + land in the workspace.

async function currentUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  // getDaraUser hits the DB (daraUser.findUnique) — the exact call that intermittently threw
  // P1001 in prod. Retry the transient case so a blip doesn't abort the whole create.
  const daraUser = await withDbRetry('resolve user', () => getDaraUser(user.id));
  if (!daraUser) redirect('/signin');
  return daraUser;
}

// Step 1 — create the empty solicitation shell from metadata only.
async function createSolShell(formData: FormData): Promise<ShellResult> {
  'use server';

  try {
    const daraUser = await currentUser();
    const companyId = daraUser.companyId;

    const mode =
      String(formData.get('mode') ?? 'direct_ai') === 'color_team' ? 'color_team' : 'direct_ai';
    const solNumber = String(formData.get('solNumber') ?? '').trim();
    const agency = String(formData.get('agency') ?? '').trim();
    const naics = String(formData.get('naics') ?? '').trim().slice(0, 20);
    const dueRaw = String(formData.get('dueDate') ?? '').trim();
    const dueParsed = dueRaw ? new Date(dueRaw) : null;
    const dueDate = dueParsed && !isNaN(dueParsed.getTime()) ? dueParsed : null;
    // The first filename (the files themselves are uploaded in step 2), used to name the sol
    // when no solicitation number was given — matches the old first-file-derived title.
    const titleHint = stripExt(String(formData.get('titleHint') ?? ''));

    const title = solNumber || titleHint || 'New solicitation';

    const sol = await withDbRetry('create solicitation', () =>
      withTenant(companyId, (tx) =>
        tx.solicitation.create({
          data: {
            companyId,
            title: title.slice(0, 500),
            solNumber,
            agency,
            naics,
            dueDate,
            mode,
            createdBy: daraUser.id
          }
        })
      )
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

    return { ok: true, solId: sol.id.toString() };
  } catch (e) {
    return toError('Create solicitation', e);
  }
}

// Step 2 — upload a SINGLE document to a solicitation the caller owns. One request per file.
async function uploadDocToSol(formData: FormData): Promise<StepResult> {
  'use server';

  try {
    const daraUser = await currentUser();
    const companyId = daraUser.companyId;

    const solId = BigInt(String(formData.get('solId')));
    // Confirm the solicitation belongs to the caller's company before attaching a file (RLS is
    // the DB backstop; this is the app-layer check).
    const owned = await withDbRetry('verify solicitation', () =>
      withTenant(companyId, (tx) =>
        tx.solicitation.findFirst({ where: { id: solId, companyId }, select: { id: true } })
      )
    );
    if (!owned) return { ok: false, error: 'Solicitation not found.' };

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Empty file.' };

    const rawType = String(formData.get('docType') ?? 'rfp');
    const docType = (['rfp', 'proposal'].includes(rawType) ? rawType : 'rfp') as 'rfp' | 'proposal';

    const doc = await uploadAndExtract(file, companyId, 'sol', Date.now());
    const created = await withDbRetry('record document', () =>
      withTenant(companyId, (tx) =>
        tx.solDocument.create({
          data: {
            companyId,
            solicitationId: solId,
            docType,
            originalFilename: doc.originalFilename,
            storedFilename: doc.storedFilename,
            fileSize: doc.fileSize,
            extractionStatus: doc.extractionStatus,
            extractedText: doc.extractedText || null,
            uploadedBy: daraUser.id
          }
        })
      )
    );
    await recordAudit({
      action: 'document.upload',
      companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'sol_document',
      entityId: created.id,
      metadata: { solicitationId: solId.toString(), filename: doc.originalFilename, docType }
    });
    return { ok: true };
  } catch (e) {
    return toError('Upload', e);
  }
}

// Step 3 — kick off the unified review (Direct AI + a proposal present) and hand back the
// workspace destination. Color Team mode, or Direct AI with no draft, simply opens the
// workspace.
async function finalizeReview(formData: FormData): Promise<StepResult> {
  'use server';

  const solId = BigInt(String(formData.get('solId')));
  try {
    const daraUser = await currentUser();
    const companyId = daraUser.companyId;
    const owned = await withDbRetry('verify solicitation', () =>
      withTenant(companyId, (tx) =>
        tx.solicitation.findFirst({ where: { id: solId, companyId }, select: { id: true } })
      )
    );
    if (!owned) return { ok: false, error: 'Solicitation not found.' };

    const runReview = String(formData.get('runReview') ?? '') === '1';
    if (runReview) {
      await enqueueDirectReview(solId, companyId);
      await recordAudit({
        action: 'review.run',
        companyId,
        actorId: daraUser.id,
        actorEmail: daraUser.email,
        entityType: 'solicitation',
        entityId: solId,
        // CUI egress trail for the data boundary (DARA-007).
        metadata: {
          kind: 'direct_review',
          provider: daraUser.company.activeProvider,
          aiMode: daraUser.company.aiKeyMode
        }
      });
      triggerWorker();
    }

    return { ok: true, redirect: `/app/solicitations/${solId}` };
  } catch (e) {
    // Even if kicking off the review hiccups, the solicitation + its docs already exist — send
    // the user into the workspace rather than stranding them on the form.
    const err = toError('Start review', e);
    return { ...err, redirect: `/app/solicitations/${solId}` };
  }
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

      <UploadAndReview
        createShell={createSolShell}
        uploadDoc={uploadDocToSol}
        finalize={finalizeReview}
      />
    </div>
  );
}
