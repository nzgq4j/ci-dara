// STEP 1 — content-based document-role classifier. Reads a document's extracted TEXT and asks the
// LLM which solicitation-package role it is, so classification adapts to ANY document rather than
// being tuned to particular filenames. Runs server-side at upload (the text only exists after the
// bytes are received), on a small head-of-document sample. Fail-open: any error / low-confidence /
// unreadable text returns null and the caller simply leaves the role unset for the user to pick.
//
// Integrated with the platform AI stack exactly like the other engines: capability-model override
// ('document_classify'), platform/BYOK key resolution, and usage-ledger logging.

import { complete, resolveCompanyAI, type CompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { logUsage } from '@/utils/dara/usage';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';
import { DOCUMENT_ROLES, DOCUMENT_ROLE_VALUES } from '@/utils/dara/document-roles';

// Head-of-document sample. A solicitation document's type is almost always identifiable from its
// first pages (cover page, title block, section headers), so a bounded prefix keeps the classify
// call cheap + fast without shipping a whole RFP to the model.
const SAMPLE_CHARS = 6000;
// Below this the extracted text is too thin to classify meaningfully (scanned/image-only PDFs,
// near-empty files) — defer to the user rather than guess.
const MIN_CHARS = 40;

function buildPrompt(text: string, filename: string): { system: string; user: string } {
  const roleLines = DOCUMENT_ROLES.map(
    (r) => `- ${r.value}: ${r.label}${r.extracted ? '' : '  (supporting reference, not a requirements source)'}`
  ).join('\n');

  const system =
    'You classify one document from a U.S. government solicitation package into exactly one role. ' +
    'Decide from the DOCUMENT CONTENT (the excerpt), using the filename only as a weak tiebreaker. ' +
    'Judge by what the document actually is, not by keywords alone. If it is the core solicitation ' +
    'that contains the uniform contract sections / instructions / evaluation criteria, it is rfp_base. ' +
    'If the content does not clearly fit any role, choose other_supporting. ' +
    'Respond with ONLY the single role value in snake_case from the provided list — no explanation, ' +
    'no punctuation, no other words.';

  const user =
    `ROLES (value: description):\n${roleLines}\n\n` +
    `FILENAME: ${filename}\n\n` +
    `DOCUMENT EXCERPT (first ${SAMPLE_CHARS} characters):\n"""\n${text.slice(0, SAMPLE_CHARS)}\n"""\n\n` +
    'Answer with exactly one role value from the list above.';

  return { system, user };
}

/** Map raw model output to a known role value, or null if none is recognized. */
function normalizeRole(raw: string): string | null {
  const t = (raw || '').toLowerCase();
  // Prefer an exact whole-token match so e.g. "past_performance_template" is not shadowed by a
  // substring check. Longest values are checked first for the same reason.
  for (const v of [...DOCUMENT_ROLE_VALUES].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z_])${v}([^a-z_]|$)`).test(t)) return v;
  }
  return null;
}

/**
 * Classify a document's role from its extracted text. Returns a DocumentRole value or null
 * (fail-open: unreadable/low-confidence/no-key/AI-error → the caller leaves the role unset).
 * `company` is the tenant's Company row (provides AI-key mode + provider/model/keys).
 */
export async function classifyDocumentRole(opts: {
  text: string;
  filename: string;
  company: CompanyAI;
  companyId: bigint;
}): Promise<string | null> {
  const sample = (opts.text ?? '').trim();
  if (sample.length < MIN_CHARS) return null;

  let resolved;
  try {
    const platform = opts.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
    resolved = applyCapabilityOverride(
      resolveCompanyAI(opts.company, platform),
      'document_classify',
      opts.company,
      platform,
      await getCapabilityOverrides()
    );
  } catch {
    return null; // config resolution failed — leave unclassified
  }
  const { provider, model, apiKey } = resolved;
  if (!apiKey) return null;

  const { system, user } = buildPrompt(sample, opts.filename);
  let ai;
  try {
    // Tiny output (one token/word) + temperature 0 for a deterministic label.
    ai = await complete(provider, system, user, model, apiKey, 24, 0);
  } catch {
    await logUsage({ capability: 'document_classify', provider, model, companyId: opts.companyId, ok: false });
    return null;
  }
  await logUsage({
    capability: 'document_classify',
    provider,
    model,
    companyId: opts.companyId,
    tokenIn: ai.tokenIn,
    tokenOut: ai.tokenOut
  });
  return normalizeRole(ai.text);
}
