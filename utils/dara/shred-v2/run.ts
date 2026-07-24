// Shred v2 — SINGLE-CALL PROOF.
//
// Makes exactly ONE structured (tool-use) call that must emit the entire canonical solicitation
// knowledge base (schema.ts) for the whole solicitation, and records what happened — did it complete
// or did the output hit the token ceiling and truncate, how many objects came back, tokens, cost.
// It does NOT write to the compliance matrix; the result is stashed on the solicitation notes under
// `shredV2Proof` so it can be inspected. This is deliberately the "one literal AI call" so we can see
// the truncation point firsthand before committing to the sequenced/hybrid production build.

import { withTenant } from '@/utils/prisma';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { resolveCompanyAI, completeStructured } from '@/utils/dara/providers';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';
import { logUsage } from '@/utils/dara/usage';
import { loadShredInput } from '@/utils/dara/shred/input';
import { CANONICAL_TOOL } from '@/utils/dara/shred-v2/schema';
import { V2_SYSTEM } from '@/utils/dara/shred-v2/prompt';

const MAX_INPUT_CHARS = 240_000; // ~60k tokens of solicitation text — the whole corpus in one shot

export interface ShredV2ProofResult {
  ok: boolean;
  truncated: boolean;
  error?: string;
  counts: { documents: number; requirements: number; evaluationCriteria: number; mappings: number; citations: number };
  stopReason: string;
  tokenIn: number;
  tokenOut: number;
  jsonBytes: number;
  totalMs: number;
}

export async function runShredV2Proof(solicitationId: bigint, companyId: bigint): Promise<ShredV2ProofResult> {
  const t0 = Date.now();
  const empty = { documents: 0, requirements: 0, evaluationCriteria: 0, mappings: 0, citations: 0 };
  const fail = (error: string, truncated = false): ShredV2ProofResult => ({
    ok: false, truncated, error, counts: empty, stopReason: truncated ? 'max_tokens' : '-', tokenIn: 0, tokenOut: 0, jsonBytes: 0, totalMs: Date.now() - t0
  });

  const input = await loadShredInput(solicitationId, companyId);
  const corpus = (input.allText || '').trim();
  if (!corpus) return fail(input.error || 'No solicitation text to analyze.');

  const platform = await getPlatformAI().catch(() => undefined);
  const company = await withTenant(companyId, async (tx) => tx.company.findFirst({ where: { id: companyId } }));
  if (!company) return fail('Company not found.');
  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(company, platform), 'shred', company, platform, await getCapabilityOverrides()
  );
  if (!apiKey) return fail(`No API key configured for the shred model (provider "${provider}").`);

  const user =
    `SOLICITATION CORPUS (all extracted document text; ${input.docCount} document(s)):\n\n` +
    corpus.slice(0, MAX_INPUT_CHARS) +
    (corpus.length > MAX_INPUT_CHARS ? '\n\n[…corpus truncated for length…]' : '');

  let data: any;
  let tokenIn = 0, tokenOut = 0, stopReason = 'unknown';
  try {
    const r = await completeStructured<any>({
      provider, model, apiKey,
      system: V2_SYSTEM, user,
      toolName: CANONICAL_TOOL.name, toolDescription: CANONICAL_TOOL.description,
      inputSchema: CANONICAL_TOOL.inputSchema as unknown as Record<string, unknown>,
      maxTokens: 64000, temperature: 0
    });
    data = r.data; tokenIn = r.tokenIn; tokenOut = r.tokenOut; stopReason = r.stopReason;
    await logUsage({ capability: 'shred', provider, model, companyId, tokenIn, tokenOut, ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'v2 call failed';
    await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
    // completeStructured surfaces a hit token ceiling as a specific "hit max_tokens" error — that IS
    // the proof result, not an unexpected failure.
    const truncated = /max_tokens/i.test(msg);
    const res = fail(truncated ? `Single call truncated: ${msg}` : msg, truncated);
    await stashProof(solicitationId, companyId, res).catch(() => {});
    return res;
  }

  const counts = {
    documents: Array.isArray(data?.documents) ? data.documents.length : 0,
    requirements: Array.isArray(data?.requirements) ? data.requirements.length : 0,
    evaluationCriteria: Array.isArray(data?.evaluation_criteria) ? data.evaluation_criteria.length : 0,
    mappings: Array.isArray(data?.evaluation_mappings) ? data.evaluation_mappings.length : 0,
    citations: Array.isArray(data?.citations) ? data.citations.length : 0
  };
  const jsonBytes = Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8');
  const result: ShredV2ProofResult = {
    ok: true, truncated: stopReason === 'max_tokens', counts, stopReason, tokenIn, tokenOut, jsonBytes, totalMs: Date.now() - t0
  };
  await stashProof(solicitationId, companyId, result, data).catch(() => {});
  return result;
}

// Merge the proof summary (and, when it completed, the raw canonical JSON) into the solicitation
// notes under `shredV2Proof`, without disturbing the v1 shredTrace already stored there.
async function stashProof(solicitationId: bigint, companyId: bigint, summary: ShredV2ProofResult, data?: unknown): Promise<void> {
  await withTenant(companyId, async (tx) => {
    const sol = await tx.solicitation.findFirst({ where: { id: solicitationId, companyId }, select: { notes: true } });
    let notes: Record<string, unknown> = {};
    try { notes = sol?.notes ? JSON.parse(sol.notes) : {}; } catch { notes = {}; }
    notes.shredV2Proof = { generatedAt: new Date().toISOString(), summary, canonical: data ?? null };
    await tx.solicitation.update({ where: { id: solicitationId }, data: { notes: JSON.stringify(notes) } });
  });
}
