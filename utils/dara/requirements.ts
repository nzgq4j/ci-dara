// Compliance-matrix engine: shred a solicitation's documents into a structured
// list of Requirement rows via the configured AI provider. Mirrors the evaluator's
// burst pattern — the slow LLM call runs OUTSIDE any tenant transaction.

import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildShredPrompt, parseShred } from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';

// The shred of a full RFP can return a long requirements list; give the JSON generous
// headroom (8000 truncated mid-array on real solicitations → unparseable). parseShred
// also salvages complete items from a truncated array as a backstop.
const SHRED_MAX_TOKENS = 16000;

export interface ShredSummary {
  ok: boolean;
  count: number;
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
export async function shredRequirements(
  solicitationId: bigint,
  companyId: bigint
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

  // LLM call OUTSIDE any transaction — the slow network hop.
  const { system, user } = buildShredPrompt(solText);
  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, SHRED_MAX_TOKENS);
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : 'AI request failed.' };
  }

  const shredded = parseShred(ai.text);
  if (shredded.length === 0) {
    return { ok: false, count: 0, error: 'The AI returned no parseable requirements.' };
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
    return { ok: true, count: 0 };
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
        isScored: r.isScored,
        farReference: r.farReference,
        citation: r.citation,
        weight: r.weight,
        sortOrder: loaded.nextOrder + i
      }))
    })
  );

  return { ok: true, count: fresh.length };
}
