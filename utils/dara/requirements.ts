// Compliance-matrix engine: shred a solicitation's documents into a structured
// list of Requirement rows via the configured AI provider. Mirrors the evaluator's
// burst pattern — the slow LLM call runs OUTSIDE any tenant transaction.

import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildShredPrompt, buildShredGapPrompt, parseShred } from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';

// Output cap per shred call. Generation time scales with OUTPUT tokens, and a single call
// must finish inside the provider's 240s hard timeout (utils/dara/providers.ts). A 16000-token
// generation on a requirement-dense RFP ran past 240s → the call was aborted, threw, and wrote
// ZERO requirements (the "matrix never builds, page polls forever" bug). 8000 tokens generates
// well under the ceiling; parseShred salvages any mid-array truncation, and the shred is now
// resumable (below) so a dense RFP is fully mined across worker ticks instead of one mega-call.
const SHRED_MAX_TOKENS = 8000;

// Safety ceiling on total requirements per solicitation, so a model that keeps hallucinating
// "new" requirements on gap passes can't loop the resumable shred forever.
const MAX_REQUIREMENTS = 800;

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
  deadlineMs = Infinity
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
    // Existing requirement names — so a re-run doesn't duplicate what's already there.
    const existing = await tx.requirement.findMany({
      where: { solicitationId, companyId },
      select: { name: true }
    });
    return {
      solicitation,
      company,
      nextOrder: (agg._max.sortOrder ?? -1) + 1,
      existingNames: new Set(existing.map((e) => e.name.trim().toLowerCase().replace(/\s+/g, ' ')))
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
  const { provider, model, apiKey } = resolveCompanyAI(loaded.company, platform);
  if (!apiKey) return { ok: false, count: 0, error: `No API key configured for provider "${provider}".` };

  // Safety cap: never keep mining past a sane matrix size (a model that hallucinates endless
  // "new" requirements on gap passes must not loop the resumable shred forever).
  if (loaded.existingNames.size >= MAX_REQUIREMENTS) {
    return { ok: true, count: 0, exhausted: true };
  }

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const seenNames = new Set<string>(Array.from(loaded.existingNames));
  const shredded: ReturnType<typeof parseShred> = [];
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
    let ai;
    try {
      ai = await complete(provider, system, user, model, apiKey, SHRED_MAX_TOKENS);
    } catch (e) {
      return { ok: false, count: 0, error: e instanceof Error ? e.message : 'AI request failed.' };
    }
    const first = parseShred(ai.text);
    if (first.length === 0) {
      return { ok: false, count: 0, error: 'The AI returned no parseable requirements.' };
    }
    for (const r of first) {
      const k = norm(r.name);
      if (!k || seenNames.has(k)) continue;
      seenNames.add(k);
      shredded.push(r);
    }
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
    if (deadlineMs - Date.now() < COVERAGE_BUDGET_MS) break;
    const gap = buildShredGapPrompt(solText, Array.from(seenNames));
    let gapAi;
    try {
      gapAi = await complete(provider, gap.system, gap.user, model, apiKey, SHRED_MAX_TOKENS);
    } catch {
      // A failed gap call this tick isn't proof the RFP is exhausted — let it resume.
      break;
    }
    const more = parseShred(gapAi.text).filter((r) => {
      const k = norm(r.name);
      if (!k || seenNames.has(k)) return false;
      seenNames.add(k);
      return true;
    });
    if (more.length === 0) {
      // A dry gap pass means nothing new remains — the shred is complete.
      exhausted = true;
      break;
    }
    more.forEach((r) => shredded.push(r));
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
