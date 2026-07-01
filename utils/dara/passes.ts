// Multi-pass AI review engine.
//
// Each color-team review runs three sequential passes (Compliance & Format → Technical
// Responsiveness → Risk & Competitive). A run is enqueued into the JobQueue and driven by
// the async worker (app/api/cron/passes) so 3 full-document analyses never block a request
// or hit the function timeout; the UI polls each pass's status/progress.
//
// Mirrors the evaluator's burst pattern — the slow LLM call runs OUTSIDE any tenant
// transaction; short withTenant() bursts wrap the DB reads/writes around it.

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

const PASS_MAX_TOKENS = 6000;

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
      include: { review: { include: { documents: true } } }
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
    return { pass, company, solDocs, requirements };
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

  await withTenant(companyId, async (tx) => {
    await tx.finding.deleteMany({ where: { passId, companyId } });
    if (parsed.findings.length) {
      await tx.finding.createMany({
        data: parsed.findings.map((f, i) => ({
          companyId,
          passId,
          severity: f.severity,
          text: f.text,
          requirementRef: f.requirementRef,
          recommendedAction: f.recommendedAction,
          sortOrder: i
        }))
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
    if (Date.now() > deadlineMs) break;
    const pass = await withTenant(companyId, (tx) =>
      tx.reviewPass.findFirst({ where: { reviewId, companyId, passType } })
    );
    if (!pass || pass.status === 'complete' || pass.status === 'error') continue;
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
 * Drain pending review-pass jobs until the deadline. Claims one job at a time across all
 * tenants (prismaAdmin), runs its passes under the job's company tenant, and either
 * completes the job or requeues it (deadline hit mid-run) for the next tick. Called by the
 * cron route and by the immediate post-enqueue trigger.
 */
export async function processReviewJobs(deadlineMs: number): Promise<{ processed: number }> {
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
    const payload = (pending.payload ?? {}) as { kind?: string; reviewId?: string; passId?: string };

    try {
      let done = true;
      if (payload.kind === 'single_pass' && payload.passId) {
        await runPass(BigInt(payload.passId), companyId, deadlineMs);
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
