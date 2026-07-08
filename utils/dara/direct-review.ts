// Direct AI review engine — the single-click, non-process-driven review path.
//
// A Direct AI review runs ONE unified analysis of a solicitation's proposal working draft
// against the RFP (across compliance/format, technical responsiveness, and risk/competitive
// concerns) and writes a single 0-100 readiness score plus a flat, severity-ranked findings
// list. It reuses the same async JobQueue worker as the color-team passes (see passes.ts):
// enqueue drops a `direct_review` job; the worker calls runDirectReview under the job's
// tenant. Unlike the 3-pass flow this is a single LLM call, so it always finishes within one
// worker tick — no per-pass time-boxing needed.
//
// Mirrors the pass engine's burst pattern: the slow LLM call runs OUTSIDE any tenant
// transaction; short withTenant() bursts wrap the DB reads/writes around it.

import { Prisma } from '@prisma/client';
import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildDirectReviewPrompt, parseDirectReviewResult } from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { requireTrialCapacity } from '@/utils/dara/trial';
import { renderPersonaGuidance } from '@/utils/dara/personas';
import { selectEvidenceContext } from '@/utils/dara/evidence-context';

const DIRECT_MAX_TOKENS = 10000;

// The direct review is intentionally broad, but it should not resend an entire large proposal
// and solicitation on every run. Build a deterministic, requirement-driven evidence package
// first. These caps are conservative enough to preserve broad coverage while materially reducing
// prompt size on large pursuits. The future semantic retrieval layer can replace this selector
// without changing the GenAI contract.
const DIRECT_PROPOSAL_CONTEXT_CHARS = 40_000;
const DIRECT_SOL_CONTEXT_CHARS = 20_000;

// The AI advises submitting `days` before the deadline; turn that into a concrete date.
export function submitDateFromDays(dueDate: Date | null | undefined, days: number | null): Date | null {
  if (!dueDate || days == null) return null;
  const d = new Date(dueDate);
  d.setDate(d.getDate() - days);
  return d;
}

interface DocFile {
  originalFilename: string;
  extractedText: string | null;
  extractionStatus: string;
}

function concatDocs(files: DocFile[]): string {
  return files
    .filter((f) => f.extractionStatus === 'complete')
    .map((f) => ({ name: f.originalFilename, text: decryptField(f.extractedText) }))
    .filter((d) => d.text.trim() !== '')
    .map((d) => `=== ${d.name} ===\n\n${d.text}`)
    .join('\n\n');
}

/** Create the DirectReview row for a solicitation if it doesn't exist yet (idempotent). */
export async function ensureDirectReview(solicitationId: bigint, companyId: bigint): Promise<bigint> {
  return withTenant(companyId, async (tx) => {
    const existing = await tx.directReview.findUnique({ where: { solicitationId } });
    if (existing) return existing.id;
    const created = await tx.directReview.create({
      data: { companyId, solicitationId, status: 'not_started' }
    });
    return created.id;
  });
}

/**
 * Enqueue a Direct AI review run: reset the solicitation's DirectReview to `running` and drop
 * a JobQueue row the worker picks up. Idempotent — reuses the single DirectReview row per
 * solicitation, so a re-run replaces the prior findings/score in place.
 */
export async function enqueueDirectReview(solicitationId: bigint, companyId: bigint): Promise<void> {
  // Trial gate: only the FIRST run of this solicitation's review consumes a review-run slot.
  // A DirectReview counts once it leaves `not_started`, so gate when there's no row yet or it's
  // still `not_started` — re-runs (status running/complete/error) are free and never blocked.
  const existing = await withTenant(companyId, (tx) =>
    tx.directReview.findUnique({ where: { solicitationId }, select: { status: true } })
  );
  if (!existing || existing.status === 'not_started') {
    await requireTrialCapacity(companyId, 'review_run');
  }

  const directReviewId = await ensureDirectReview(solicitationId, companyId);
  await withTenant(companyId, async (tx) => {
    await tx.directReview.update({
      where: { id: directReviewId },
      data: { status: 'running', progress: 0, progressLabel: '', errorMessage: null, startedAt: new Date() }
    });
    await tx.jobQueue.create({
      data: {
        companyId,
        jobType: 'evaluate',
        payload: { kind: 'direct_review', directReviewId: directReviewId.toString() },
        status: 'pending'
      }
    });
  });
}

/** True when a Direct AI review is running (or queued) for this solicitation — drives the UI poll. */
export async function isDirectReviewActive(solicitationId: bigint, companyId: bigint): Promise<boolean> {
  return withTenant(companyId, async (tx) => {
    const dr = await tx.directReview.findUnique({
      where: { solicitationId },
      select: { id: true, status: true }
    });
    if (!dr) return false;
    if (dr.status === 'running') return true;
    // Also active if a direct_review job is queued but the row hasn't flipped to running yet.
    const jobs = await tx.jobQueue.findMany({
      where: { companyId, jobType: 'evaluate', status: { in: ['pending', 'running'] } },
      select: { payload: true }
    });
    const drId = dr.id.toString();
    return jobs.some((j) => {
      const p = (j.payload ?? {}) as { kind?: string; directReviewId?: string };
      return p.kind === 'direct_review' && p.directReviewId === drId;
    });
  });
}

async function failDirectReview(directReviewId: bigint, companyId: bigint, message: string): Promise<void> {
  await withTenant(companyId, (tx) =>
    tx.directReview.update({
      where: { id: directReviewId },
      data: { status: 'error', progress: 0, progressLabel: '', errorMessage: message }
    })
  );
}

/**
 * Run a Direct AI review: load the proposal draft + solicitation + requirements, call the
 * model once for the unified lens, and write the score + flat findings. Resumable/idempotent
 * — a re-run replaces the review's findings. Returns whether it reached a terminal state.
 */
export async function runDirectReview(
  directReviewId: bigint,
  companyId: bigint
): Promise<{ ok: boolean; error?: string }> {
  const loaded = await withTenant(companyId, async (tx) => {
    const review = await tx.directReview.findFirst({ where: { id: directReviewId, companyId } });
    if (!review) return null;
    const company = await tx.company.findUnique({ where: { id: companyId } });
    const solicitation = await tx.solicitation.findUnique({
      where: { id: review.solicitationId },
      select: { dueDate: true, title: true, solNumber: true }
    });
    const solDocs = await tx.solDocument.findMany({
      where: { solicitationId: review.solicitationId, companyId }
    });
    // Active company personas steer the direct review (its tweakable reviewer lens).
    const activePersonas = await tx.persona.findMany({
      where: { companyId, isActive: true },
      select: { displayName: true, systemPrompt: true },
      orderBy: { sortOrder: 'asc' }
    });
    const requirements = await tx.requirement.findMany({
      where: { solicitationId: review.solicitationId, companyId, removedAt: null },
      select: { name: true, citation: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    // Snapshot the user-driven fields on the current findings so a re-run preserves them
    // (matched by requirementRef + text). AI re-suggests owner_role/effort; the human's status
    // and assigned owner name survive.
    const priorFindings = await tx.finding.findMany({
      where: { directReviewId, companyId },
      select: { requirementRef: true, text: true, status: true, ownerName: true }
    });
    return { review, company, solicitation, solDocs, requirements, activePersonas, priorFindings };
  });

  if (!loaded?.review) return { ok: false, error: 'Direct review not found.' };
  if (!loaded.company) {
    await failDirectReview(directReviewId, companyId, 'Company not found.');
    return { ok: false, error: 'Company not found.' };
  }

  // Mark running (idempotent — enqueue already did, but a worker retry re-enters here).
  await withTenant(companyId, (tx) =>
    tx.directReview.update({
      where: { id: directReviewId },
      data: {
        status: 'running',
        progress: 20,
        progressLabel: 'Analyzing the proposal against the solicitation…',
        startedAt: loaded.review.startedAt ?? new Date(),
        errorMessage: null
      }
    })
  );

  const proposalText = concatDocs(loaded.solDocs.filter((d) => d.docType === 'proposal'));
  const solText = concatDocs(loaded.solDocs.filter((d) => d.docType === 'rfp'));
  const requirementsRef = loaded.requirements
    .map((r) => `- ${r.name}${r.citation ? ` (${r.citation})` : ''}`)
    .join('\n');

  // Build a bounded evidence package before the GenAI call. The direct review remains broad:
  // every active requirement contributes to the lexical query, but only the highest-value source
  // windows are sent to the provider. This avoids repeatedly paying to resend irrelevant pages.
  const evidenceQueries = loaded.requirements.map((r) => ({
    name: r.name,
    farReference: r.citation
  }));
  const proposalEvidence = selectEvidenceContext(proposalText, evidenceQueries, {
    maxChars: DIRECT_PROPOSAL_CONTEXT_CHARS,
    windowChars: 4_500,
    overlapChars: 700,
    maxWindows: 14
  });
  const solicitationEvidence = selectEvidenceContext(solText, evidenceQueries, {
    maxChars: DIRECT_SOL_CONTEXT_CHARS,
    windowChars: 4_000,
    overlapChars: 600,
    maxWindows: 8
  });

  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(loaded.company, platform);
  if (!apiKey) {
    await failDirectReview(directReviewId, companyId, `No API key configured for provider "${provider}".`);
    return { ok: false, error: 'No API key.' };
  }

  const personaGuidance = renderPersonaGuidance(loaded.activePersonas, {
    title: loaded.solicitation?.title,
    solNumber: loaded.solicitation?.solNumber
  });
  const { system, user } = buildDirectReviewPrompt(
    solicitationEvidence,
    proposalEvidence,
    requirementsRef,
    personaGuidance
  );

  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, DIRECT_MAX_TOKENS);
  } catch (e) {
    await failDirectReview(directReviewId, companyId, e instanceof Error ? e.message.slice(0, 480) : 'AI request failed.');
    return { ok: false, error: 'AI request failed.' };
  }

  const parsed = parseDirectReviewResult(ai.text);
  const recommendedSubmitAt = submitDateFromDays(loaded.solicitation?.dueDate ?? null, parsed.recommendedSubmitDays);
  // Re-apply the human's status/owner-name onto matching re-suggested findings.
  const priorByKey = new Map(
    loaded.priorFindings.map((p) => [`${p.requirementRef}\u0000${p.text}`, p])
  );

  await withTenant(companyId, async (tx) => {
    await tx.finding.deleteMany({ where: { directReviewId, companyId } });
    if (parsed.findings.length) {
      await tx.finding.createMany({
        data: parsed.findings.map((f, i) => {
          const prior = priorByKey.get(`${f.requirementRef}\u0000${f.text}`);
          return {
            companyId,
            directReviewId,
            severity: f.severity,
            text: f.text,
            requirementRef: f.requirementRef,
            recommendedAction: f.recommendedAction,
            ownerRole: f.ownerRole,
            ownerName: prior?.ownerName ?? '',
            effortBand: f.effortBand,
            effortEstimate: f.effortEstimate,
            status: prior?.status ?? 'open',
            sortOrder: i
          };
        })
      });
    }
    const now = new Date();
    await tx.directReview.update({
      where: { id: directReviewId },
      data: {
        status: 'complete',
        score: parsed.score ?? 0,
        progress: 100,
        progressLabel: '',
        findingsCount: parsed.findings.length,
        recommendation: parsed.recommendation,
        recommendedSubmitAt,
        checklist: parsed.checklist as unknown as Prisma.InputJsonValue,
        runAt: now,
        completedAt: now
      }
    });
  });

  return { ok: true };
}
