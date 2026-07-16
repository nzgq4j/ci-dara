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
import { requireTrialCapacity } from '@/utils/dara/trial';
import { renderPersonaGuidance } from '@/utils/dara/personas';
import {
  buildPassPrompt,
  parsePassResult,
  PASS_TYPES,
  PASS_LENS,
  type PassTypeValue
} from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { logUsage } from '@/utils/dara/usage';
import { withRunContext } from '@/utils/dara/run-context';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';
import { runComplianceCheck } from '@/utils/dara/evaluator';
import { runFSEA } from '@/utils/dara/fsea/orchestrator';
import { fetchClauseSync, upsertClauses } from '@/utils/dara/fsea/clause-library';
import { reconcileAmendment } from '@/utils/dara/amendments';
import { runDirectReview, submitDateFromDays } from '@/utils/dara/direct-review';
import { parseAndPersist } from '@/utils/dara/modal-parser';

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
  // Trial gate: a "review run" is metered by distinct reviews that have been run, so only the
  // FIRST run of a review consumes a slot — re-runs of an already-counted review are free and
  // must never be blocked. A review counts once it has pass rows, so gate before ensurePasses.
  const alreadyCounted = await withTenant(companyId, (tx) =>
    tx.reviewPass.count({ where: { reviewId, companyId } })
  );
  if (alreadyCounted === 0) await requireTrialCapacity(companyId, 'review_run');

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
  // maxAttempts=1: the FSEA orchestrator handles its own per-pass retry logic internally.
  // Job-level retries re-execute the entire pipeline from Pass 1, wasting tokens on passes
  // that already succeeded. A deterministic failure (temperature 0, same input) will produce
  // the same output on every retry anyway. Surface the error immediately; the user can
  // investigate and re-run manually after addressing the root cause.
  return withTenant(companyId, async (tx) => {
    const active = await tx.jobQueue.findMany({
      where: { companyId, jobType: 'evaluate', status: { in: ['pending', 'running'] } },
      select: { payload: true }
    });
    if (active.some((j) => jobPayloadMatches(j.payload, 'shred', 'solicitationId', solicitationId))) return { ok: true };
    await tx.jobQueue.create({
      data: { companyId, jobType: 'evaluate', payload: { kind: 'shred', solicitationId: solicitationId.toString() }, status: 'pending', maxAttempts: 1 }
    });
    return { ok: true };
  });
}

/** True when a shred is queued/running for this solicitation. */
export async function isShredActive(solicitationId: bigint, companyId: bigint): Promise<boolean> {
  const jobs = await activeEvaluatePayloads(companyId);
  return jobs.some((j) => jobPayloadMatches(j.payload, 'shred', 'solicitationId', solicitationId));
}

/** Returns whether a shred is active AND its current progress label. */
export async function getShredStatus(
  solicitationId: bigint,
  companyId: bigint,
): Promise<{ active: boolean; progressLabel: string | null }> {
  const jobs = await withTenant(companyId, (tx) =>
    tx.jobQueue.findMany({
      where: { companyId, jobType: 'evaluate', status: { in: ['pending', 'running'] } },
      select: { payload: true, progressLabel: true },
    })
  );
  const match = jobs.find((j) =>
    jobPayloadMatches(j.payload, 'shred', 'solicitationId', solicitationId)
  );
  return {
    active: !!match,
    progressLabel: match?.progressLabel ?? null,
  };
}

/** Enqueue an async structural re-parse (Modal) of a single solicitation document. */
export function enqueueReparse(solDocId: bigint, companyId: bigint): Promise<{ ok: boolean; error?: string }> {
  return enqueueUniqueJob(companyId, 'reparse', 'solDocId', solDocId);
}

/**
 * Enqueue the global clause-library sync (admin). Modal clones the GSA DITA repos; the worker upserts
 * the result into dara_clause_library / dara_clause_versions. No entity id — deduped on the `kind`.
 */
export async function enqueueClauseSync(companyId: bigint): Promise<{ ok: boolean; error?: string }> {
  return withTenant(companyId, async (tx) => {
    const active = await tx.jobQueue.findMany({ where: { status: { in: ['pending', 'running'] } } });
    if (active.some((j) => (j.payload as { kind?: string } | null)?.kind === 'sync_clauses')) return { ok: true };
    await tx.jobQueue.create({
      data: { companyId, jobType: 'evaluate', payload: { kind: 'sync_clauses' }, status: 'pending' }
    });
    return { ok: true };
  });
}

/** True when a re-parse is queued/running for this document. */
export async function isReparseActive(solDocId: bigint, companyId: bigint): Promise<boolean> {
  const jobs = await activeEvaluatePayloads(companyId);
  return jobs.some((j) => jobPayloadMatches(j.payload, 'reparse', 'solDocId', solDocId));
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
      include: {
        review: {
          include: {
            documents: true,
            solicitation: { select: { dueDate: true, title: true, solNumber: true } },
            reviewPersonas: { include: { persona: true } }
          }
        }
      }
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
    // Active company personas (the fallback lens when the review selected none).
    const activePersonas = await tx.persona.findMany({
      where: { companyId, isActive: true },
      select: { displayName: true, systemPrompt: true },
      orderBy: { sortOrder: 'asc' }
    });
    // Preserve user-driven status/owner-name across a pass re-run (matched by ref + text).
    const priorFindings = await tx.finding.findMany({
      where: { passId, companyId },
      select: { requirementRef: true, text: true, status: true, ownerName: true }
    });
    return { pass, company, solDocs, requirements, activePersonas, priorFindings };
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
  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(loaded.company, platform),
    'review_pass',
    loaded.company,
    platform,
    await getCapabilityOverrides()
  );
  if (!apiKey) {
    await failPass(passId, companyId, `No API key configured for provider "${provider}".`);
    return { ok: false, error: 'No API key.' };
  }

  // Reviewer personas shape the pass: the review's selected personas (active only), else all
  // active company personas. Their free-text systemPrompt is the user's knob to steer results.
  const selectedPersonas = loaded.pass.review.reviewPersonas
    .map((rp) => rp.persona)
    .filter((p) => p.isActive)
    .map((p) => ({ displayName: p.displayName, systemPrompt: p.systemPrompt }));
  const effectivePersonas = selectedPersonas.length > 0 ? selectedPersonas : loaded.activePersonas;
  const personaGuidance = renderPersonaGuidance(effectivePersonas, {
    title: loaded.pass.review.solicitation.title,
    solNumber: loaded.pass.review.solicitation.solNumber
  });

  const { system, user } = buildPassPrompt(passType, solText, proposalText, requirementsRef, personaGuidance);

  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, PASS_MAX_TOKENS);
  } catch (e) {
    await logUsage({ capability: 'review_pass', provider, model, companyId, ok: false });
    await failPass(passId, companyId, e instanceof Error ? e.message.slice(0, 480) : 'AI request failed.');
    return { ok: false, error: 'AI request failed.' };
  }
  await logUsage({ capability: 'review_pass', provider, model, companyId, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut });

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
 * Fold the AI review's findings into the compliance matrix — no new LLM call. Sources findings
 * from the completed Compliance & Format pass (color-team mode) or the completed DirectReview
 * (Direct AI mode). Matches each finding to a requirement by its reference vs the requirement's
 * citation, writes an "AI:" notes block (idempotent), and nudges the status of matched
 * requirements that are still unassessed. Returns how many requirements changed.
 */
export async function syncMatrixFromPasses(
  solicitationId: bigint,
  companyId: bigint
): Promise<{ ok: boolean; synced: number; error?: string }> {
  const loaded = await withTenant(companyId, async (tx) => {
    const sol = await tx.solicitation.findFirst({
      where: { id: solicitationId, companyId },
      select: { mode: true }
    });
    if (!sol) return null;

    // Direct AI: the single unified review's flat findings. Color team: the latest completed
    // Compliance & Format pass. Both are Finding rows with the same shape.
    let findings: { severity: 'critical' | 'high' | 'medium' | 'low'; text: string; requirementRef: string; recommendedAction: string }[] | null =
      null;
    if (sol.mode === 'direct_ai') {
      const dr = await tx.directReview.findFirst({
        where: { solicitationId, companyId, status: 'complete' },
        include: { findings: { orderBy: { sortOrder: 'asc' } } }
      });
      findings = dr ? dr.findings : null;
    } else {
      const pass = await tx.reviewPass.findFirst({
        where: { companyId, passType: 'compliance_format', status: 'complete', review: { solicitationId } },
        orderBy: { completedAt: 'desc' },
        include: { findings: { orderBy: { sortOrder: 'asc' } } }
      });
      findings = pass ? pass.findings : null;
    }

    if (!findings) return { mode: sol.mode, findings: null, requirements: [] };
    const requirements = await tx.requirement.findMany({
      where: { solicitationId, companyId, removedAt: null }
    });
    return { mode: sol.mode, findings, requirements };
  });
  if (!loaded || !loaded.findings) {
    const error =
      loaded?.mode === 'direct_ai'
        ? 'No completed AI review yet — run the AI review first.'
        : 'No completed Compliance & Format pass yet — run an AI review first.';
    return { ok: false, synced: 0, error };
  }

  // Group findings by the requirement they reference (fuzzy: normalized containment).
  type Fnd = { severity: 'critical' | 'high' | 'medium' | 'low'; text: string; recommendedAction: string };
  type Req = (typeof loaded.requirements)[number];
  const sevRank: Record<Fnd['severity'], number> = { critical: 3, high: 2, medium: 1, low: 0 };
  const groups = new Map<string, Fnd[]>();
  const reqById = new Map<string, Req>(loaded.requirements.map((r) => [r.id.toString(), r] as const));

  for (const f of loaded.findings) {
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

  // Defensive: this sweep is the FIRST thing every worker tick does. If any single update here
  // threw, it would abort the whole tick (no jobs drained). Isolate each step in try/catch so a
  // transient DB blip on one row can never stop the reaper OR the drain — an orphaned job left
  // `running` is exactly what pins the workspace poll (shred/compliance/reconcile jobs have no
  // entity to reset; failing the JobQueue row is what releases `isComplianceCheckActive` /
  // `isShredActive`, so the reap MUST run to completion every tick).
  let staleJobs: { id: bigint; attempts: number; maxAttempts: number; payload: unknown }[] = [];
  try {
    staleJobs = await prismaAdmin.jobQueue.findMany({
      where: { status: 'running', startedAt: { lt: staleBefore } },
      select: { id: true, attempts: true, maxAttempts: true, payload: true }
    });
  } catch {
    return; // can't read the queue this tick — let the drain proceed; next tick retries.
  }

  for (const j of staleJobs) {
    try {
      if (j.attempts < j.maxAttempts) {
        // Retry: prior completed work (passes, already-graded rows, saved requirements) is
        // preserved, so the retry resumes with a full budget. Its `running` row is reset below.
        await prismaAdmin.jobQueue.update({
          where: { id: j.id },
          data: { status: 'pending', availableAt: new Date() }
        });
      } else {
        // Out of attempts — give up and surface the failure instead of spinning forever. For a
        // shred/compliance/reconcile job this `failed` status alone stops the workspace poll.
        await prismaAdmin.jobQueue.update({
          where: { id: j.id },
          data: { status: 'failed', finishedAt: new Date(), error: 'Worker timed out before the job finished.' }
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
    } catch {
      // One row's cleanup failed — keep reaping the rest; next tick retries this one.
      continue;
    }
  }

  // Any remaining `running` pass whose job we requeued (or whose job is already gone) is
  // reset to `queued` so it re-runs and the UI shows a live status instead of a frozen bar.
  try {
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
  } catch {
    /* best-effort progress reset — safe to skip this tick */
  }
}

/**
 * Grade a chunk of a solicitation's pass/fail compliance requirements within this tick's
 * budget. Returns true when the job is finished — either every compliance requirement is
 * graded, or a whole tick graded nothing new (a stall; stop rather than loop forever). The
 * next tick resumes the remainder (runComplianceCheck grades only not-yet-assessed rows).
 */
async function runComplianceJob(solicitationId: bigint, companyId: bigint, deadlineMs: number): Promise<boolean> {
  const countNotAssessed = () =>
    withTenant(companyId, (tx) =>
      tx.requirement.count({
        where: { solicitationId, companyId, removedAt: null, disposition: 'compliance', complianceStatus: 'not_assessed' }
      })
    );
  // Gate termination on ACTUAL net progress (not-assessed rows that left the pool this tick),
  // not on `res.checked`. A row the sweep "checks" but writes back as not_assessed (any AI
  // determination that doesn't resolve to a terminal status) counts toward `checked` while
  // never leaving the ungraded pool — so `res.checked === 0` never trips and the job requeues
  // every cron tick forever (frozen progress bar + endless UI poll + recurring AI spend).
  // Comparing before/after guarantees the job stops: each tick either shrinks the pool or ends.
  const before = await countNotAssessed();
  await runComplianceCheck(solicitationId, companyId, deadlineMs);
  const after = await countNotAssessed();
  return after === 0 || after >= before;
}

/**
 * Drain pending review-pass jobs until the deadline. Claims one job at a time across all
 * tenants (prismaAdmin), runs its passes under the job's company tenant, and either
 * completes the job or requeues it (deadline hit mid-run) for the next tick. Called by the
 * cron route and by the immediate post-enqueue trigger.
 */
/**
 * Re-parse one solicitation document through the Modal parser (async, worker-only). Loads the
 * stored file, runs parseAndPersist (which atomically supersedes the prior parse row and inserts
 * a new one), then enqueues a shred so the improved structured input can regenerate the matrix.
 * The shred no-ops into a non-empty matrix (regeneration = clear first), so on a populated matrix
 * the re-parse refreshes the parse history but does not clobber existing requirements.
 */
async function runReparse(solDocId: bigint, companyId: bigint): Promise<void> {
  const doc = await withTenant(companyId, (tx) =>
    tx.solDocument.findFirst({
      where: { id: solDocId, companyId },
      select: { id: true, storedFilename: true, solicitationId: true, docType: true }
    })
  );
  if (!doc) return; // deleted between enqueue and run — nothing to do.

  await parseAndPersist({
    storedFilename: doc.storedFilename,
    solDocId: doc.id,
    companyId,
    createdBy: null // system-initiated re-parse (no interactive actor on the worker)
  });

  // Only an RFP feeds the compliance-matrix shred; a proposal/amendment re-parse just refreshes
  // its parse history.
  if (doc.docType === 'rfp') {
    await enqueueShred(doc.solicitationId, companyId);
  }
}

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
    const payload = (pending.payload ?? {}) as { kind?: string; reviewId?: string; passId?: string; solicitationId?: string; amendmentId?: string; directReviewId?: string; solDocId?: string };

    try {
      let done = true;
      // Tag every LLM call this job makes with a stable run id so the usage ledger can attribute
      // cost per run. AsyncLocalStorage carries it down to logUsage() without threading a param
      // through each engine.
      await withRunContext(`job:${pending.id}`, async () => {
      if (payload.kind === 'direct_review' && payload.directReviewId) {
        // Single unified LLM call — always finishes within one tick (no time-boxing needed).
        await runDirectReview(BigInt(payload.directReviewId), companyId);
      } else if (payload.kind === 'single_pass' && payload.passId) {
        await runPass(BigInt(payload.passId), companyId, deadlineMs);
      } else if (payload.kind === 'compliance_check' && payload.solicitationId) {
        done = await runComplianceJob(BigInt(payload.solicitationId), companyId, deadlineMs);
      } else if (payload.kind === 'shred' && payload.solicitationId) {
        // Shred is resumable: each tick runs bounded AI calls (no single call approaches the
        // 240s provider timeout) and reports `exhausted`. Requeue while there's more of the RFP
        // to mine so a dense solicitation finishes across ticks; only mark the job done once the
        // shred reports it's fully mined. Surface a hard failure (e.g. AI/API error) via throw so
        // it routes through the retry/fail path instead of silently leaving an empty matrix.
        const shredRes = await runFSEA(
          BigInt(payload.solicitationId),
          companyId,
          deadlineMs,
          pending.id,
        );
        if (!shredRes.ok) throw new Error(shredRes.error ?? 'FSEA pipeline failed.');
        done = true; // FSEA is single-pass; always done after one run
      } else if (payload.kind === 'reconcile' && payload.amendmentId) {
        await reconcileAmendment(BigInt(payload.amendmentId), companyId);
      } else if (payload.kind === 'reparse' && payload.solDocId) {
        // Structural re-parse (Modal) — one-shot; enqueues its own follow-on shred.
        await runReparse(BigInt(payload.solDocId), companyId);
      } else if (payload.kind === 'sync_clauses') {
        // Global clause-library sync — Modal clones the GSA repos + parses DITA; we upsert into the
        // shared library (prismaAdmin). One-shot; throw surfaces a hard failure through the retry path.
        const sync = await fetchClauseSync();
        if ('error' in sync) throw new Error(`Clause sync failed: ${sync.error}`);
        await upsertClauses(sync.clauses);
      } else if (payload.reviewId) {
        ({ done } = await runReviewPasses(BigInt(payload.reviewId), companyId, deadlineMs));
      }
      });

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
