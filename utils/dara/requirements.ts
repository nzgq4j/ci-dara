// Compliance-matrix engine — WHOLE-DOCUMENT shred. The entire solicitation is sent to the model in
// one call (modern context windows hold it comfortably), which returns a clean, de-duplicated
// requirements list. This replaced the windowed span-anchored pipeline: letting the model see the
// whole document at once gives better granularity (one row per section, not per sentence), correct
// section citations, and cross-document de-duplication — without windowing, anchoring, or stitching.

import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildShredPrompt, parseShredRows } from '@/utils/dara/shred-prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { logUsage } from '@/utils/dara/usage';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';

// Output budget for the whole matrix in one generation. Anthropic caps far above this; a dense RFP
// of ~150 requirements is ~20k output tokens, well under.
const SHRED_MAX_TOKENS = 32000;

// Sanity cap on the concatenated solicitation (~125k tokens) so a pathological upload can't blow the
// context window. Typical solicitations are a fraction of this.
const MAX_INPUT_CHARS = 500_000;

// Absolute backstop on total requirements per solicitation.
const MAX_REQUIREMENTS = 500;

function normText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ShredSummary {
  ok: boolean;
  count: number;
  // Always true — the whole-document shred completes in a single call. Kept so the worker dispatch
  // (which reads `exhausted`) marks the job done in one tick.
  exhausted?: boolean;
  error?: string;
}

interface DocFile {
  originalFilename: string;
  extractedText: string | null;
  extractionStatus: string;
  docType: string;
}

/**
 * Shred a solicitation's RFP documents into a de-duplicated requirements list via one whole-document
 * AI call. `deadlineMs`/`jobId` are accepted for the worker's call signature; the shred is one-shot
 * (no resumption needed) and reports `exhausted: true`.
 */
export async function shredRequirements(
  solicitationId: bigint,
  companyId: bigint,
  _deadlineMs = Infinity,
  _jobId?: bigint
): Promise<ShredSummary> {
  // Burst A: load docs + company + current ordering + existing rows (for dedup on re-run).
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
    const existing = await tx.requirement.findMany({
      where: { solicitationId, companyId },
      select: { name: true, description: true }
    });
    return { solicitation, company, nextOrder: (agg._max.sortOrder ?? -1) + 1, existing };
  });

  if (!loaded?.solicitation) return { ok: false, count: 0, error: 'Solicitation not found.' };
  if (!loaded.company) return { ok: false, count: 0, error: 'Company not found.' };

  // Concatenate the RFP documents (structure preserved via the per-page line breaks from ingestion).
  let solText = (loaded.solicitation.solDocs as DocFile[])
    .filter((d) => d.docType === 'rfp' && d.extractionStatus === 'complete')
    .map((d) => `=== DOCUMENT: ${d.originalFilename} ===\n\n${decryptField(d.extractedText)}`)
    .filter((s) => s.trim() !== '')
    .join('\n\n');

  if (solText.trim() === '') {
    return {
      ok: false,
      count: 0,
      error: 'No extracted RFP text. Upload the solicitation (RFP) documents on the Documents tab and wait for extraction.'
    };
  }
  if (solText.length > MAX_INPUT_CHARS) solText = solText.slice(0, MAX_INPUT_CHARS) + '\n\n[Solicitation truncated to fit context limit]';

  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(loaded.company, platform),
    'shred',
    loaded.company,
    platform,
    await getCapabilityOverrides()
  );
  if (!apiKey) return { ok: false, count: 0, error: `No API key configured for provider "${provider}".` };

  if (loaded.existing.length >= MAX_REQUIREMENTS) return { ok: true, count: 0, exhausted: true };

  // One whole-document call — the slow network hop, OUTSIDE any transaction.
  const { system, user } = buildShredPrompt(solText);
  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, SHRED_MAX_TOKENS);
  } catch (e) {
    await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
    return { ok: false, count: 0, error: e instanceof Error ? e.message : 'AI request failed.' };
  }
  await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut });

  const parsed = parseShredRows(ai.text);
  if (parsed.length === 0) return { ok: false, count: 0, error: 'The AI returned no parseable requirements.' };

  // De-dup against existing rows (so a re-run doesn't duplicate) and within this batch, by the
  // normalized requirement text. The model already de-dups; this is the backstop.
  const seen = new Set(loaded.existing.map((e) => normText(e.description ?? e.name)));
  const fresh = parsed.filter((r) => {
    const key = normText(r.text || r.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return { ok: true, count: 0, exhausted: true };

  const toWrite = fresh.slice(0, Math.max(0, MAX_REQUIREMENTS - loaded.existing.length));

  // Burst B: persist the new requirement rows.
  await withTenant(companyId, (tx) =>
    tx.requirement.createMany({
      data: toWrite.map((r, i) => ({
        companyId,
        solicitationId,
        name: r.name,
        description: r.text || null,
        source: r.source,
        disposition: r.disposition,
        isScored: r.disposition === 'scored',
        complianceStatus:
          r.disposition === 'administrative' ? ('not_applicable' as const) : ('not_assessed' as const),
        farReference: r.farReference,
        citation: r.citation,
        citationSynthesized: r.citation === '', // false when the model gave the document's own label
        obligationCount: r.obligationCount,
        weight: r.weight,
        sortOrder: loaded.nextOrder + i
      }))
    })
  );

  return { ok: true, count: toWrite.length, exhausted: true };
}
