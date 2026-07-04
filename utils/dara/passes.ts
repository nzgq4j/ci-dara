// Multi-pass AI review engine.
//
// Each color-team review runs three sequential passes (Compliance & Format → Technical
// Responsiveness → Risk & Competitive). A run is enqueued into the JobQueue and driven by
// the async worker (app/api/cron/passes) so 3 full-document analyses never block a request
// or hit the function timeout; the UI polls each pass's status/progress.
//
// Mirrors the evaluator's burst pattern — the slow LLM call runs OUTSIDE any tenant
// transaction; short withTenant() bursts wrap the DB reads/writes around it.

import { Prisma } from '@prisma/client';
import { withTenant, prismaAdmin } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import {
  buildPassPrompt,
  parsePassResult,
  PASS_TYPES,
  PASS_LENS,
  type PassTypeValue
} from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { runComplianceCheck } from '@/utils/dara/evaluator';
import { shredRequirements } from '@/utils/dara/requirements';
import { reconcileAmendment } from '@/utils/dara/amendments';
import { runDirectReview, submitDateFromDays } from '@/utils/dara/direct-review';

const PASS_MAX_TOKENS = 8000;

// Don't START a pass unless at least this much of the worker's deadline remains — a full
// single-document pass can take a couple of minutes, and a pass killed mid-call (function
// timeout) orphans the job. With too little headroom we leave the pass `queued` for the
// next worker tick instead, where it runs with a full budget.
const PASS_BUDGET_MS = 160_000;

// A JobQueue row / ReviewPass stuck in `running` longer than this is orphaned: the owning
// function was killed mid-run (no catch ran to requeue it). The cron route's maxDuration is
// 300s, so anything running past this margin is certainly dead and safe to reap.
const STALE_MS = 6 * 60_000;

// Passes run in this fixed order; a review can't start pass N+1 before pass N.
const PASS_ORDER: PassTypeValue[] = [...PASS_TYPES];

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

/** Create the three pass rows for a review if they don't exist yet (idempotent). */
export async function ensurePasses(reviewId: bigint, companyId: bigint): Promise<void> {
  await withTenant(companyId, async (tx) => {
    for (const passType of PASS_ORDER) {
      await tx.reviewPass.upsert({
        where: { reviewId_passType: { reviewId, passType } },
        create: { companyId, reviewId, passType, status: 'not_started' },
        update: {}
      });
    }
  });
}

/**
 * Enqueue a full review run: reset the three passes to `queued` and drop a JobQueue row
 * the worker will pick up. Returns nothing — the UI polls pass status.
 */
export async function enqueueReviewRun(reviewId: bigint, companyId: bigint): Promise<void> {
  await ensurePasses(reviewId, companyId);
  await withTenant(companyId, async (tx) => {
    await tx.reviewPass.updateMany({
      where: { reviewId, companyId },
      data: { status: 'queued', progress: 0, progressLabel: '', errorMessage: null }
    });
    await tx.review.update({ where: { id: reviewId }, data: { status: 'in_progress' } });
    await tx.jobQueue.create({
      data: {
        companyId,
        jobType: 'evaluate',
        payload: { kind: 'review_passes', reviewId: reviewId.toString() },
        status: 'pending'
      }
    });
  });
}

/**
 * Enqueue an async compliance-matrix check for a solicitation. The pass/fail compliance
 * requirements are graded against the current proposal draft in the background worker
 * (resumable across ticks) rather than in a long synchronous request that would time out on
 * a large matrix. Idempotent — no-ops if a check is already queued/running for this sol.
 */
export async function enqueueComplianceCheck(
  solicitationId: bigint,
  companyId: bigint
): Promise<{ ok: boolean; error?: string }> {
  return withTenant(companyId, async (tx) => {
    const total = await tx.requirement.count({
      where: { solicitationId, companyId, removedAt: null, disposition: 'compliance' }
    });
    if (total === 0) {
      return { ok: false, error: 'No pass/fail compliance requirements to check. Generate the matrix first.' };
    }
    // Filter the (small) set of active jobs in JS rather than a JSON-path SQL filter — robust
    // across driver adapters.
    const activeJobs = await tx.jobQueue.findMany({
      where: { companyId, jobType: 'evaluate', status: { in: ['pending', 'running'] } },
      select: { payload: true }
    });
    if (activeJobs.some((j) => jobPayloadMatches(j.payload, 'compliance_check', 'solicitationId', solicitationId))) {
      return { ok: true }; // already in progress — the UI is polling it
    }
    await tx.jobQueue.create({
      data: {
        companyId,
        jobType: 'evaluate',
        payload: { kind: 'compliance_check', solicitationId: solicitationId.toString() },
        status: 'pending'
      }
    });
    return { ok: true };
  });
}

// ---- Async background jobs (compliance check / shred / amendment reconcile) ----
// All three run in the worker instead of a long synchronous request. They share the
// `evaluate` job type; the payload `kind` + entity id distinguish them.

/** Does a JobQueue payload match a given kind + entity id (e.g. kind='shred', field='solicitationId')? */
function jobPayloadMatches(payload: unknown, kind: string, field: string, id: bigint): boolean {
  const p = (payload ?? {}) as Record<string, unknown>;
  return p.kind === kind && p[field] === id.toString();
}

/** The (small) set of active evaluate-job payloads for a company. */
function activeEvaluatePayloads(companyId: bigint) {
  return withTenant(companyId, (tx) =>
    tx.jobQueue.findMany({
      where: { companyId, jobType: 'evaluate', status: { in: ['pending', 'running'] } },
      select: { payload: true }
    })
  );
}

/** Enqueue a background job of `kind` for one entity, unless an identical one is already active. */
async function enqueueUniqueJob(
  companyId: bigint,
  kind: string,
  field: string,
  id: bigint
): Promise<{ ok: boolean; error?: string }> {
  return withTenant(companyId, async (tx) => {
    const active = await tx.jobQueue.findMany({
      where: { companyId, jobType: 'evaluate', status: { in: ['pending', 'running'] } },
      select: { payload: true }
    });
    if (active.some((j) => jobPayloadMatches(j.payload, kind, field, id))) return { ok: true };
    await tx.jobQueue.create({
      data: { companyId, jobType: 'evaluate', payload: { kind, [field]: id.toString() }, status: 'pending' }
    });
    return { ok: true };
  });
}

/** True when a compliance check is queued/running for this solicitation (drives the UI poll). */
export async function isComplianceCheckActive(solicitationId: bigint, companyId: bigint): Promise<boolean> {
  const jobs = await activeEvaluatePayloads(companyId);
  return jobs.some((j) => jobPayloadMatches(j.payload, 'compliance_check', 'solicitationId', solicitationId));
}

/** Enqueue an async matrix shred ("Generate from solicitation") for a solicitation. */
export function enqueueShred(solicitationId: bigint, companyId: bigint): Promise<{ ok: boolean; error?: string }> {
  return enqueueUniqueJob(companyId, 'shred', 'solicitationId', solicitationId);
}

/** True when a shred is queued/running for this solicitation. */
export async function isShredActive(solicitationId: bigint, companyId: bigint): Promise<boolean> {
  const jobs = await activeEvaluatePayloads(companyId);
  return jobs.some((j) => jobPayloadMatches(j.payload, 'shred', 'solicitationId', solicitationId));
}

/** Enqueue an async amendment reconcile ("Reconcile with AI") for an amendment. */
export function enqueueReconcile(amendmentId: bigint, companyId: bigint): Promise<{ ok: boolean; error?: string }> {
  return enqueueUniqueJob(companyId, 'reconcile', 'amendmentId', amendmentId);
}

/** Ids of amendments with a reconcile queued/running (for per-amendment poll state). */
export async function activeReconcileAmendmentIds(companyId: bigint): Promise<string[]> {
  const jobs = await activeEvaluatePayloads(companyId);
  return jobs
    .map((j) => (j.payload ?? {}) as { kind?: string; amendmentId?: string })
    .filter((p) => p.kind === 'reconcile' && !!p.amendmentId)
    .map((p) => p.amendmentId as string);
}

/** Enqueue a single pass re-run / retry (leaves the other passes untouched). */
export async function enqueuePassRun(passId: bigint, companyId: bigint): Promise<void> {
  const reviewId = await withTenant(companyId, async (tx) => {
    const pass = await tx.reviewPass.findFirst({ where: { id: passId, companyId } });
    if (!pass) return null;
    await tx.reviewPass.update({
      where: { id: passId },
      data: { status: 'queued', progress: 0, progressLabel: '', errorMessage: null }
    });
    await tx.review.update({ where: { id: pass.reviewId }, data: { status: 'in_progress' } });
    await tx.jobQueue.create({
      data: {
        companyId,
        jobType: 'evaluate',
        payload: { kind: 'single_pass', passId: passId.toString() },
        status: 'pending'
      }
    });
    return pass.reviewId;
  });
  return void reviewId;
}

/**
 * Run one pass: load context, call the model for this lens, write the score + findings.
 * Resumable/idempotent — a re-run replaces the pass's findings.
 */
export async function runPass(
  passId: bigint,
  companyId: bigint,
  deadlineMs = Infinity
): Promise<{ ok: boolean; error?: string }> {
  const loaded = await withTenant(companyId, async (tx) => {
    const pass = await tx.reviewPass.findFirst({
      where: { id: passId, companyId },
      include: { review: { include: { documents: true, solicitation: { select: { dueDate: true } } } } }
    });
    if (!pass) return null;
    const company = await tx.company.findUnique({ where: { id: companyId } });
    const solDocs = await tx.solDocument.findMany({
      where: { solicitationId: pass.review.solicitationId, companyId }
    });
    const requirements = await tx.requirement.findMany({
      where: { solicitationId: pass.review.solicitationId, companyId, removedAt: null },
      select: { name: true, citation: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    // Preserve user-driven status/owner-name across a pass re-run (matched by ref + text).
    const priorFindings = await tx.finding.findMany({
      where: { passId, companyId },
      select: { requirementRef: true, text: true, status: true, ownerName: true }
    });
    return { pass, company, solDocs, requirements, priorFindings };
  });

  if (!loaded?.pass) return { ok: false, error: 'Pass not found.' };
  const passType = loaded.pass.passType as PassTypeValue;

  if (!loaded.company) {
    await failPass(passId, companyId, 'Company not found.');
    return { ok: false, error: 'Company not found.' };
  }

  // Mark running.
  await withTenant(companyId, (tx) =>
    tx.reviewPass.update({
      where: { id: passId },
      data: {
        status: 'running',
        progress: 15,
        progressLabel: PASS_LENS[passType].blurb,
        startedAt: new Date(),
        errorMessage: null
      }
    })
  );

  const proposalText = concatDocs(loaded.pass.review.documents);
  const solText = concatDocs(loaded.solDocs.filter((d) => d.docType === 'rfp'));
  const requirementsRef = loaded.requirements
    .map((r) => `- ${r.name}${r.citation ? ` (${r.citation})` : ''}`)
    .join('\n');

  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(loaded.company, platform);
  if (!apiKey) {
    await failPass(passId, companyId, `No API key configured for provider "${provider}".`);
    return { ok: false, error: 'No API key.' };
  }

  const { system, user } = buildPassPrompt(passType, solText, proposalText, requirementsRef);

  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, PASS_MAX_TOKENS);
  } catch (e) {
    await failPass(passId, companyId, e instanceof Error ? e.message.slice(0, 480) : 'AI request failed.');
    return { ok: false, error: 'AI request failed.' };
  }

  const parsed = parsePassResult(ai.text);
  const priorByKey = new Map(
    loaded.priorFindings.map((p) => [`${p.requirementRef} ${p.text}`, p])
  );
  // The Risk pass is the final, holistic one — it carries the consolidated report block, which
  // we persist on the parent Review (color-team's home for the report outputs).
  const isRiskPass = passType === 'risk_competitive';
  const recommendedSubmitAt = isRiskPass
    ? submitDateFromDays(loaded.pass.review.solicitation?.dueDate ?? null, parsed.recommendedSubmitDays)
    : null;

  await withTenant(companyId, async (tx) => {
    await tx.finding.deleteMany({ where: { passId, companyId } });
    if (parsed.findings.length) {
      await tx.finding.createMany({
        data: parsed.findings.map((f, i) => {
          const prior = priorByKey.get(`${f.requirementRef} ${f.text}`);
          return {
            companyId,
            passId,
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
    await tx.reviewPass.update({
      where: { id: passId },
      data: {
        status: 'complete',
        score: parsed.score ?? 0,
        progress: 100,
        progressLabel: '',
        findingsCount: parsed.findings.length,
        completedAt: new Date()
      }
    });
    if (isRiskPass) {
      await tx.review.update({
        where: { id: loaded.pass.reviewId },
        data: {
          recommendation: parsed.recommendation,
          recommendedSubmitAt,
          checklist: parsed.checklist as unknown as Prisma.InputJsonValue
        }
      });
    }
  });

  return { ok: true };
}

async function failPass(passId: bigint, companyId: bigint, message: string): Promise<void> {
  await withTenant(companyId, (tx) =>
    tx.reviewPass.update({
      where: { id: passId },
      data: { status: 'error', progress: 0, progressLabel: '', errorMessage: message }
    })
  );
}

/**
 * Run a review's passes in order, skipping any already complete. Time-boxed — if the
 * deadline hits mid-run the remaining passes stay `queued` for the next worker tick.
 * Returns whether every pass reached a terminal state (complete or error).
 */
export async function runReviewPasses(
  reviewId: bigint,
  companyId: bigint,
  deadlineMs = Infinity
): Promise<{ done: boolean }> {
  await ensurePasses(reviewId, companyId);
  for (const passType of PASS_ORDER) {
    const pass = await withTenant(companyId, (tx) =>
      tx.reviewPass.findFirst({ where: { reviewId, companyId, passType } })
    );
    if (!pass || pass.status === 'complete' || pass.status === 'error') continue;
    // Not enough headroom to finish this pass before the function is killed — stop and leave
    // it queued; the next worker tick picks it up (passes 1-2 already done) with a full budget.
    if (deadlineMs - Date.now() < PASS_BUDGET_MS) break;
    await runPass(pass.id, companyId, deadlineMs);
  }

  // Terminal when no pass is still queued/running.
  const remaining = await withTenant(companyId, (tx) =>
    tx.reviewPass.count({ where: { reviewId, companyId, status: { in: ['queued', 'running', 'not_started'] } } })
  );
  if (remaining === 0) {
    await withTenant(companyId, (tx) =>
      tx.review.update({ where: { id: reviewId }, data: { status: 'complete' } }).catch(() => undefined)
    );
  }
  return { done: remaining === 0 };
}

function normRef(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Fold the most recent completed Compliance & Format pass's findings into the compliance
 * matrix — no new LLM call. Matches each finding to a requirement by its reference vs the
 * requirement's citation, writes an "AI:" notes block (idempotent), and nudges the status
 * of matched requirements that are still unassessed. Returns how many requirements changed.
 */
export async function syncMatrixFromPasses(
  solicitationId: bigint,
  companyId: bigint
): Promise<{ ok: boolean; synced: number; error?: string }> {
  const loaded = await withTenant(companyId, async (tx) => {
    const pass = await tx.reviewPass.findFirst({
      where: { companyId, passType: 'compliance_format', status: 'complete', review: { solicitationId } },
      orderBy: { completedAt: 'desc' },
      include: { findings: { orderBy: { sortOrder: 'asc' } } }
    });
    if (!pass) return null;
    const requirements = await tx.requirement.findMany({
      where: { solicitationId, companyId, removedAt: null }
    });
    return { pass, requirements };
  });
  if (!loaded) {
    return { ok: false, synced: 0, error: 'No completed Compliance & Format pass yet — run an AI review first.' };
  }

  // Group findings by the requirement they reference (fuzzy: normalized containment).
  type Fnd = { severity: 'critical' | 'high' | 'medium' | 'low'; text: string; recommendedAction: string };
  type Req = (typeof loaded.requirements)[number];
  const sevRank: Record<Fnd['severity'], number> = { critical: 3, high: 2, medium: 1, low: 0 };
  const groups = new Map<string, Fnd[]>();
  const reqById = new Map<string, Req>(loaded.requirements.map((r) => [r.id.toString(), r] as const));

  for (const f of loaded.pass.findings) {
    const fr = normRef(f.requirementRef);
    if (fr.length < 3) continue;
    const match = loaded.requirements.find((r) => {
      const cite = normRef(r.citation);
      return cite.length >= 3 && (cite.includes(fr) || fr.includes(cite));
    });
    if (!match) continue;
    const key = match.id.toString();
    const list = groups.get(key) ?? [];
    list.push({ severity: f.severity, text: f.text, recommendedAction: f.recommendedAction });
    groups.set(key, list);
  }
  if (groups.size === 0) return { ok: true, synced: 0 };

  const entries = Array.from(groups.entries());
  let synced = 0;
  await withTenant(companyId, async (tx) => {
    for (const [key, findings] of entries) {
      const req = reqById.get(key);
      if (!req) continue;
      let worst = 0;
      for (const f of findings) worst = Math.max(worst, sevRank[f.severity]);
      // Rebuild the AI notes block: keep the user's lines, replace prior "AI:" lines.
      const userLines = (req.notes ?? '').split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('AI:'));
      const aiLines = findings.map(
        (f) => `AI: [${f.severity.toUpperCase()}] ${f.text}${f.recommendedAction ? ` → ${f.recommendedAction}` : ''}`
      );
      const notes = [...userLines, ...aiLines].join('\n').slice(0, 4000);
      const nudged = worst >= 2 ? 'non_compliant' : 'partial';
      await tx.requirement.update({
        where: { id: req.id },
        data: {
          notes,
          // Only set status when the user/sweep hasn't already assessed it.
          ...(req.complianceStatus === 'not_assessed' ? { complianceStatus: nudged as any } : {})
        }
      });
      synced++;
    }
  });
  return { ok: true, synced };
}

/**
 * Best-effort immediate kick of the worker route so a run starts without waiting for the
 * next cron tick. Fire-and-forget — never awaited, never throws; the every-minute cron is
 * the guaranteed backstop if this doesn't land.
 */
export function triggerWorker(): void {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) return;
  const headers: Record<string, string> = {};
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  void fetch(`${base}/api/cron/passes`, { headers, cache: 'no-store' }).catch(() => {});
}

// ===================== JobQueue worker =====================

/**
 * Recover work orphaned by a killed function. A serverless timeout mid-pass leaves the
 * JobQueue row stuck in `running` (no catch ran to requeue it) and the in-flight ReviewPass
 * stuck in `running` — and the worker only claims `pending` jobs, so the review hangs forever.
 * Anything `running` past STALE_MS is certainly dead: requeue the job (or fail it if it's out
 * of attempts, marking its passes errored), and reset orphaned passes so they re-run.
 * Cross-tenant maintenance sweep — runs on prismaAdmin like the rest of the worker.
 */
async function reapOrphanedJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_MS);

  const staleJobs = await prismaAdmin.jobQueue.findMany({
    where: { status: 'running', startedAt: { lt: staleBefore } },
    select: { id: true, attempts: true, maxAttempts: true, payload: true }
  });

  for (const j of staleJobs) {
    if (j.attempts < j.maxAttempts) {
      // Retry: passes 1-2 are already complete, so the retry runs the stuck pass with a
      // full budget. Its `running` row is reset below so it re-runs.
      await prismaAdmin.jobQueue.update({
        where: { id: j.id },
        data: { status: 'pending', availableAt: new Date() }
      });
    } else {
      // Out of attempts — give up and surface the failure instead of spinning forever.
      await prismaAdmin.jobQueue.update({
        where: { id: j.id },
        data: { status: 'failed', finishedAt: new Date(), error: 'Worker timed out before the review finished.' }
      });
      const payload = (j.payload ?? {}) as { passId?: string; reviewId?: string; directReviewId?: string };
      // A Direct AI review is a single call — out of attempts means surface the failure.
      if (payload.directReviewId) {
        await prismaAdmin.directReview.updateMany({
          where: { id: BigInt(payload.directReviewId), status: { in: ['running'] } },
          data: { status: 'error', progress: 0, progressLabel: '', errorMessage: 'Timed out — re-run the review.' }
        });
      }
      const where = payload.passId
        ? { id: BigInt(payload.passId) }
        : payload.reviewId
          ? { reviewId: BigInt(payload.reviewId) }
          : null;
      if (where) {
        await prismaAdmin.reviewPass.updateMany({
          where: { ...where, status: { in: ['queued', 'running'] } },
          data: { status: 'error', progress: 0, progressLabel: '', errorMessage: 'Timed out — retry this pass.' }
        });
      }
    }
  }

  // Any remaining `running` pass whose job we requeued (or whose job is already gone) is
  // reset to `queued` so it re-runs and the UI shows a live status instead of a frozen bar.
  await prismaAdmin.reviewPass.updateMany({
    where: { status: 'running', startedAt: { lt: staleBefore } },
    data: { status: 'queued', progress: 0, progressLabel: '' }
  });

  // A Direct AI review left `running` past the stale margin whose job was requeued (attempts
  // remain) re-runs from scratch on the next tick — runDirectReview is idempotent and
  // replaces findings, so just clear the stale progress so the UI shows a live status.
  await prismaAdmin.directReview.updateMany({
    where: { status: 'running', startedAt: { lt: staleBefore } },
    data: { progress: 0, progressLabel: '' }
  });
}

/**
 * Grade a chunk of a solicitation's pass/fail compliance requirements within this tick's
 * budget. Returns true when the job is finished — either every compliance requirement is
 * graded, or a whole tick graded nothing new (a stall; stop rather than loop forever). The
 * next tick resumes the remainder (runComplianceCheck grades only not-yet-assessed rows).
 */
async function runComplianceJob(solicitationId: bigint, companyId: bigint, deadlineMs: number): Promise<boolean> {
  const res = await runComplianceCheck(solicitationId, companyId, deadlineMs);
  const remaining = await withTenant(companyId, (tx) =>
    tx.requirement.count({
      where: { solicitationId, companyId, removedAt: null, disposition: 'compliance', complianceStatus: 'not_assessed' }
    })
  );
  return remaining === 0 || res.checked === 0;
}

/**
 * Drain pending review-pass jobs until the deadline. Claims one job at a time across all
 * tenants (prismaAdmin), runs its passes under the job's company tenant, and either
 * completes the job or requeues it (deadline hit mid-run) for the next tick. Called by the
 * cron route and by the immediate post-enqueue trigger.
 */
export async function processReviewJobs(deadlineMs: number): Promise<{ processed: number }> {
  await reapOrphanedJobs();

  let processed = 0;
  while (Date.now() < deadlineMs) {
    const pending = await prismaAdmin.jobQueue.findFirst({
      where: { status: 'pending', availableAt: { lte: new Date() } },
      orderBy: { availableAt: 'asc' }
    });
    if (!pending) break;

    // Optimistic claim — skip if another worker grabbed it first.
    const claim = await prismaAdmin.jobQueue.updateMany({
      where: { id: pending.id, status: 'pending' },
      data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } }
    });
    if (claim.count === 0) continue;

    const companyId = pending.companyId;
    const payload = (pending.payload ?? {}) as { kind?: string; reviewId?: string; passId?: string; solicitationId?: string; amendmentId?: string; directReviewId?: string };

    try {
      let done = true;
      if (payload.kind === 'direct_review' && payload.directReviewId) {
        // Single unified LLM call — always finishes within one tick (no time-boxing needed).
        await runDirectReview(BigInt(payload.directReviewId), companyId);
      } else if (payload.kind === 'single_pass' && payload.passId) {
        await runPass(BigInt(payload.passId), companyId, deadlineMs);
      } else if (payload.kind === 'compliance_check' && payload.solicitationId) {
        done = await runComplianceJob(BigInt(payload.solicitationId), companyId, deadlineMs);
      } else if (payload.kind === 'shred' && payload.solicitationId) {
        // Shred runs its own passes (initial + coverage) to completion within one tick.
        await shredRequirements(BigInt(payload.solicitationId), companyId);
      } else if (payload.kind === 'reconcile' && payload.amendmentId) {
        await reconcileAmendment(BigInt(payload.amendmentId), companyId);
      } else if (payload.reviewId) {
        ({ done } = await runReviewPasses(BigInt(payload.reviewId), companyId, deadlineMs));
      }

      if (done) {
        await prismaAdmin.jobQueue.update({
          where: { id: pending.id },
          data: { status: 'done', finishedAt: new Date() }
        });
      } else {
        // Deadline hit with passes still queued — requeue for the next worker tick.
        await prismaAdmin.jobQueue.update({
          where: { id: pending.id },
          data: { status: 'pending', availableAt: new Date() }
        });
        break; // out of time this tick
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 480) : 'Job failed.';
      const retry = pending.attempts < pending.maxAttempts;
      await prismaAdmin.jobQueue.update({
        where: { id: pending.id },
        data: retry
          ? { status: 'pending', availableAt: new Date(Date.now() + 30_000), error: msg }
          : { status: 'failed', finishedAt: new Date(), error: msg }
      });
    }
    processed++;
  }
  return { processed };
}
