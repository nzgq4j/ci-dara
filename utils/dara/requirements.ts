// Compliance-matrix engine: shred a solicitation's documents into a structured
// list of Requirement rows via the configured AI provider. Mirrors the evaluator's
// burst pattern — the slow LLM call runs OUTSIDE any tenant transaction.

import { withTenant, prismaAdmin } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildShredPrompt, buildShredGapPrompt, parseShred } from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { logUsage } from '@/utils/dara/usage';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';

// Write a progress label to the owning JobQueue row so the UI
// can show which phase the shred is in. Fire-and-forget —
// a failed label write must never abort the shred itself.
async function setShredLabel(jobId: bigint | undefined, label: string): Promise<void> {
  if (!jobId) return;
  try {
    await prismaAdmin.jobQueue.update({
      where: { id: jobId },
      data: { progressLabel: label },
    });
  } catch {
    // Non-fatal — the shred continues even if the label write fails.
  }
}

// Output cap per shred call. Generation time scales with OUTPUT tokens, and a single call
// must finish inside the provider's 240s hard timeout (utils/dara/providers.ts). A 16000-token
// generation on a requirement-dense RFP ran past 240s → the call was aborted, threw, and wrote
// ZERO requirements (the "matrix never builds, page polls forever" bug). 8000 tokens generates
// well under the ceiling; parseShred salvages any mid-array truncation, and the shred is now
// resumable (below) so a dense RFP is fully mined across worker ticks instead of one mega-call.
const SHRED_MAX_TOKENS = 8000;

// Absolute backstop on total requirements per solicitation. A model that keeps restating
// already-captured requirements on gap passes must not loop the resumable shred toward a huge
// matrix. This cap and the churn guard below are the two automatic brakes on that runaway
// (see the sol-22 incident: a weak model amassed 746 near-duplicate rows vs. the ~125 norm).
const MAX_REQUIREMENTS = 500;

// Gap-pass churn guard. A pass that returns many items but almost all are already captured
// (few survive dedup) means the model is restating the matrix, not finding new obligations —
// the runaway signature. When a pass returns at least GAP_CHURN_MIN_RETURNED items and fewer
// than GAP_CHURN_NEW_FRACTION of them are genuinely new, treat the RFP as mined and stop the
// auto-loop. Genuinely-new items from that pass are still kept; a dense RFP with more to find
// can be topped up via "Generate more".
const GAP_CHURN_MIN_RETURNED = 12;
const GAP_CHURN_NEW_FRACTION = 0.2;

// Normalize text for duplicate detection (case- and whitespace-insensitive).
function normText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
// Description signature for near-duplicate detection: the FULL normalized requirement text.
// The shred quotes/paraphrases the RFP, so a restatement of an already-captured requirement
// under a reworded NAME still carries the same description and is caught here. Using the full
// string (never a prefix) guarantees two genuinely-distinct requirements can't collide — a
// false merge would silently drop a real requirement, which we never want. Skips very short
// descriptions (< 40 chars) so generic one-liners fall back to name-only dedup.
function descSig(d: string | null | undefined): string {
  const n = normText(d ?? '');
  return n.length >= 40 ? n : '';
}

export interface ShredSummary {
  ok: boolean;
  count: number;
  // True when there is nothing left to mine (a gap pass came up dry, or the cap was hit). The
  // worker requeues the shred job while this is false so a dense RFP finishes across ticks.
  exhausted?: boolean;
  error?: string;
}

interface DocFile {
  originalFilename: string;
  extractedText: string | null;
  extractionStatus: string;
}

// Decrypt + concatenate the completed solicitation documents (CUI at rest, DARA-009).
function concatDocs(files: DocFile[]): string {
  return files
    .filter((f) => f.extractionStatus === 'complete')
    .map((f) => ({ name: f.originalFilename, text: decryptField(f.extractedText) }))
    .filter((d) => d.text.trim() !== '')
    .map((d) => `=== ${d.name} ===\n\n${d.text}`)
    .join('\n\n');
}

/**
 * Shred a solicitation into requirements, appending them to the compliance matrix.
 * New rows are ordered after any existing requirements. Returns how many were added.
 */
// Headroom needed to safely run one more coverage pass (LLM call + write) before the tick's
// deadline. Keeps shred from starting work it can't finish inside the function budget.
const COVERAGE_BUDGET_MS = 130_000;

export async function shredRequirements(
  solicitationId: bigint,
  companyId: bigint,
  deadlineMs = Infinity,
  jobId?: bigint,          // ← new optional param
): Promise<ShredSummary> {
  // Burst A: load the solicitation docs, company AI config, and current ordering.
  const loaded = await withTenant(companyId, async (tx) => {
    const solicitation = await tx.solicitation.findFirst({
      where: { id: solicitationId, companyId },
      include: { solDocs: true }
    });
    if (!solicitation) return null;
    const company = await tx.company.findUnique({ where: { id: companyId } });
    const agg = await tx.requirement.aggregate({
      where: { solicitationId, companyId },
      _max: { sortOrder: true }
    });
    // Existing requirement names + description signatures — so a re-run (and every gap pass)
    // doesn't duplicate what's already there, including a restatement under a reworded name.
    const existing = await tx.requirement.findMany({
      where: { solicitationId, companyId },
      select: { name: true, description: true }
    });
    return {
      solicitation,
      company,
      nextOrder: (agg._max.sortOrder ?? -1) + 1,
      existingNames: new Set(existing.map((e) => normText(e.name))),
      existingDescs: new Set(existing.map((e) => descSig(e.description)).filter((k) => k !== ''))
    };
  });

  if (!loaded?.solicitation) return { ok: false, count: 0, error: 'Solicitation not found.' };
  if (!loaded.company) return { ok: false, count: 0, error: 'Company not found.' };

  // Shred only the RFP itself — not our proposal draft or amendment files.
  const rfpDocs = loaded.solicitation.solDocs.filter((d) => d.docType === 'rfp');
  const solText = concatDocs(rfpDocs);
  if (solText.trim() === '') {
    return {
      ok: false,
      count: 0,
      error: 'No extracted RFP text. Upload the solicitation (RFP) documents on the Documents tab and wait for extraction.'
    };
  }

  const platform =
    loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(loaded.company, platform),
    'shred',
    loaded.company,
    platform,
    await getCapabilityOverrides()
  );
  if (!apiKey) return { ok: false, count: 0, error: `No API key configured for provider "${provider}".` };

  // Safety cap: never keep mining past a sane matrix size (a model that hallucinates endless
  // "new" requirements on gap passes must not loop the resumable shred forever).
  if (loaded.existingNames.size >= MAX_REQUIREMENTS) {
    return { ok: true, count: 0, exhausted: true };
  }

  const norm = normText;
  const seenNames = new Set<string>(Array.from(loaded.existingNames));
  const seenDescs = new Set<string>(Array.from(loaded.existingDescs));
  const shredded: ReturnType<typeof parseShred> = [];
  // A requirement is a duplicate if its name OR its description signature is already captured.
  // The description check catches restatements the model returns under a slightly reworded name
  // (the runaway that ballooned sol 22). markSeen records both keys as each item is accepted.
  const isDup = (r: { name: string; description: string }): boolean => {
    const nk = norm(r.name);
    if (!nk || seenNames.has(nk)) return true;
    const dk = descSig(r.description);
    return dk !== '' && seenDescs.has(dk);
  };
  const markSeen = (r: { name: string; description: string }): void => {
    seenNames.add(norm(r.name));
    const dk = descSig(r.description);
    if (dk) seenDescs.add(dk);
  };
  // A shred RESUMES across worker ticks: the first tick (no existing requirements) runs the
  // full extraction; later ticks skip it and only run gap passes to find what's still missing.
  // Each AI call is bounded (SHRED_MAX_TOKENS) so none approaches the 240s provider timeout.
  const resuming = loaded.existingNames.size > 0;
  // exhausted = nothing left to mine. Flipped true when a gap pass comes up dry or the cap is
  // hit; stays false when we stop only because this tick ran out of budget (→ resume next tick).
  let exhausted = false;

  if (!resuming) {
    // First tick: full extraction. LLM call OUTSIDE any transaction — the slow network hop.
    const { system, user } = buildShredPrompt(solText);
    await setShredLabel(jobId, 'Reading the solicitation — initial extraction pass…');
    let ai;
    try {
      ai = await complete(provider, system, user, model, apiKey, SHRED_MAX_TOKENS);
    } catch (e) {
      await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
      return { ok: false, count: 0, error: e instanceof Error ? e.message : 'AI request failed.' };
    }
    await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut });
    const first = parseShred(ai.text);
    if (first.length === 0) {
      return { ok: false, count: 0, error: 'The AI returned no parseable requirements.' };
    }
    for (const r of first) {
      if (isDup(r)) continue;
      markSeen(r);
      shredded.push(r);
    }
    await setShredLabel(jobId, `Initial pass complete — ${shredded.length} requirements found. Running coverage check…`);
  }

  // Coverage passes: hunt for requirements not yet captured. Bounded per tick (≤2 rounds) and
  // time-boxed; the job resumes next tick if there's more to find. A round that comes up dry
  // means the RFP is fully mined (exhausted); a round stopped by the budget is not.
  for (let round = 0; round < 2; round++) {
    if (seenNames.size >= MAX_REQUIREMENTS) {
      exhausted = true;
      break;
    }
    // Not enough budget to finish another coverage call before the function is killed — stop
    // and leave the job to resume next tick with a full budget (nothing is orphaned; what we
    // have is saved below).
    await setShredLabel(jobId, `Coverage pass ${round + 1} — checking for missed requirements…`);
    if (deadlineMs - Date.now() < COVERAGE_BUDGET_MS) break;
    const gap = buildShredGapPrompt(solText, Array.from(seenNames));
    let gapAi;
    try {
      gapAi = await complete(provider, gap.system, gap.user, model, apiKey, SHRED_MAX_TOKENS);
    } catch {
      await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
      // A failed gap call this tick isn't proof the RFP is exhausted — let it resume.
      break;
    }
    await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: gapAi.tokenIn, tokenOut: gapAi.tokenOut });
    const parsed = parseShred(gapAi.text);
    const returned = parsed.length;
    const more = parsed.filter((r) => {
      if (isDup(r)) return false;
      markSeen(r);
      return true;
    });
    if (more.length === 0) {
      // A dry gap pass means nothing new remains — the shred is complete.
      exhausted = true;
      break;
    }
    more.forEach((r) => shredded.push(r));
    // Churn guard: a high-volume pass that is mostly duplicates means the model is restating the
    // matrix, not finding new obligations. Keep the few genuinely-new items (pushed above) but
    // stop the auto-loop — a dense RFP with more to mine can be topped up via "Generate more".
    if (returned >= GAP_CHURN_MIN_RETURNED && more.length < returned * GAP_CHURN_NEW_FRACTION) {
      exhausted = true;
      break;
    }
    await setShredLabel(jobId, `Coverage pass ${round + 1} complete — ${seenNames.size} requirements found. Checking for more…`);
  }

  // Dedupe: skip anything whose name already exists (so re-running does not duplicate),
  // and dedupe within this batch too.
  const seen = new Set(loaded.existingNames);
  const fresh = shredded.filter((r) => {
    const key = r.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) {
    return { ok: true, count: 0, exhausted };
  }

  await setShredLabel(jobId, `Writing ${fresh.length} new requirements to the matrix…`);
  // Burst B: persist the new requirement rows.
  await withTenant(companyId, (tx) =>
    tx.requirement.createMany({
      data: fresh.map((r, i) => ({
        companyId,
        solicitationId,
        name: r.name,
        description: r.description || null,
        source: r.source,
        disposition: r.disposition,
        isScored: r.isScored,
        // Administrative items are not written up in the proposal, so there is nothing to
        // grade — mark them N/A up front and let the compliance sweep skip them.
        complianceStatus: r.disposition === 'administrative' ? ('not_applicable' as const) : ('not_assessed' as const),
        farReference: r.farReference,
        citation: r.citation,
        weight: r.weight,
        sortOrder: loaded.nextOrder + i
      }))
    })
  );

  return { ok: true, count: fresh.length, exhausted };
}
