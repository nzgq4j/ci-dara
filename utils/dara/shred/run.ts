// runShred — the whole pipeline, one synchronous run, discrete structured calls IN SEQUENCE.
//
//   load (deterministic) → Step A factors (1 call) → Step B classify (N chunk calls, one at a
//   time) → data-QC (ground / dedupe / classify / link / sanity) → persist once → return trace.
//
// No cron, no job queue, no parallel calls, no multi-tick. Every call is awaited and validated
// before the next. Requirement text comes from the parser's candidates (grounded by construction);
// the model only classifies and links. A run returns a trace so it is always visible what ran and
// why anything was flagged or failed.

import type { Prisma } from '@prisma/client';
import { withTenant } from '@/utils/prisma';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { resolveCompanyAI, completeStructured } from '@/utils/dara/providers';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';
import { logUsage } from '@/utils/dara/usage';
import { loadShredInput, type ShredCandidate } from '@/utils/dara/shred/input';
import { buildHaystack, isGrounded, isParserHandle } from '@/utils/dara/shred/citation';
import {
  FACTORS_TOOL, CLASSIFY_TOOL,
  type FactorsOutput, type ClassifyOutput, type CandidateClassification, type ExtractedFactor
} from '@/utils/dara/shred/schemas';
import { FACTORS_SYSTEM, CLASSIFY_SYSTEM } from '@/utils/dara/shred/prompts';
import { persistMatrix } from '@/utils/dara/shred/persist';

const CHUNK = 50;              // candidates per Step B call (processed strictly one chunk at a time)
const STEP_A_MAX_TOKENS = 6000;
const STEP_B_MAX_TOKENS = 8000;
const now = () => Date.now();

// Estimate for the trace only; the authoritative cost is logged to dara_ai_usage_log.
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet': { in: 3, out: 15 },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 }
};
function estCost(model: string, tin: number, tout: number): number {
  const key = Object.keys(PRICE).find(k => model.startsWith(k)) ?? 'claude-haiku-4-5';
  const p = PRICE[key];
  return (tin / 1e6) * p.in + (tout / 1e6) * p.out;
}

export interface ShredTraceStep {
  step: string; model: string; tokenIn: number; tokenOut: number; ms: number; note: string; ok: boolean;
}
export interface ShredResult {
  ok: boolean;
  error?: string;
  counts: { candidates: number; factors: number; requirements: number; flagged: number; linkedInstructions: number; instructions: number };
  trace: { steps: ShredTraceStep[]; totalMs: number; estCostUsd: number };
}

export async function runShred(solicitationId: bigint, companyId: bigint): Promise<ShredResult> {
  const t0 = now();
  const steps: ShredTraceStep[] = [];
  const emptyCounts = { candidates: 0, factors: 0, requirements: 0, flagged: 0, linkedInstructions: 0, instructions: 0 };
  const fail = (error: string): ShredResult => ({
    ok: false, error, counts: emptyCounts,
    trace: { steps, totalMs: now() - t0, estCostUsd: steps.reduce((a, s) => a + estCost(s.model, s.tokenIn, s.tokenOut), 0) }
  });

  // 1) Load input — deterministic, no LLM.
  const input = await loadShredInput(solicitationId, companyId);
  if (input.error) return fail(input.error);
  steps.push({ step: 'load', model: '-', tokenIn: 0, tokenOut: 0, ms: now() - t0, note: `${input.candidates.length} candidates, ${input.docCount} doc(s)`, ok: true });

  // 2) Resolve the shred model/key.
  const platform = await getPlatformAI().catch(() => undefined);
  const company = await withTenant(companyId, async (tx) => tx.company.findFirst({ where: { id: companyId } }));
  if (!company) return fail('Company not found.');
  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(company, platform), 'shred', company, platform, await getCapabilityOverrides()
  );
  if (!apiKey) return fail(`No API key configured for the shred model (provider "${provider}").`);

  const haystack = buildHaystack(input.allText);
  let sortOrder = 0;

  // 3) STEP A — Section M factors (one structured call).
  let factors: ExtractedFactor[] = [];
  {
    const s = now();
    try {
      const r = await completeStructured<FactorsOutput>({
        provider, model, apiKey,
        system: FACTORS_SYSTEM,
        user: `SECTION M (evaluation methodology):\n\n${input.sectionMText || '(no Section M text detected)'}`,
        toolName: FACTORS_TOOL.name, toolDescription: FACTORS_TOOL.description,
        inputSchema: FACTORS_TOOL.inputSchema as unknown as Record<string, unknown>,
        maxTokens: STEP_A_MAX_TOKENS, temperature: 0
      });
      await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: r.tokenIn, tokenOut: r.tokenOut, ok: true });
      factors = (r.data?.factors ?? []).filter(f => (f?.name ?? '').trim() && !isParserHandle(f.name));
      steps.push({ step: 'factors', model, tokenIn: r.tokenIn, tokenOut: r.tokenOut, ms: now() - s, note: `${factors.length} factors`, ok: true });
    } catch (e) {
      await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
      const msg = e instanceof Error ? e.message : 'Step A failed';
      steps.push({ step: 'factors', model, tokenIn: 0, tokenOut: 0, ms: now() - s, note: msg, ok: false });
      return fail(`Factor extraction (Step A) failed: ${msg}`);
    }
  }
  const factorNames = factors.map(f => f.name.trim());
  const factorNameSet = new Set(factorNames.map(n => n.toLowerCase()));
  const smHay = buildHaystack(input.sectionMText);

  const factorRows: Prisma.RequirementCreateManyInput[] = factors.map(f => {
    const grounded = isGrounded(f.description, smHay) || isGrounded(f.name, smHay);
    return {
      companyId, solicitationId,
      name: f.name.slice(0, 300),
      description: ((f.description ?? '').slice(0, 4000)) || null,
      source: 'evaluation_factor', disposition: 'scored', isScored: true,
      // Only surface the model's citation when the factor itself is grounded in Section M; an
      // ungrounded factor's citation is unverifiable, so blank it rather than show a figure a
      // reviewer might trust. Parser-handle leakage is also rejected.
      citation: (grounded && !isParserHandle(f.citation) ? (f.citation ?? '') : '').slice(0, 200),
      farReference: '', complianceStatus: 'not_assessed',
      reviewStatus: grounded ? 'approved' : 'flagged',
      governingFactors: [], sortOrder: sortOrder++
    };
  });

  // 4) STEP B — classify candidates in SEQUENTIAL chunks (one call at a time).
  const classifications = new Map<string, CandidateClassification>();
  const chunks: ShredCandidate[][] = [];
  for (let i = 0; i < input.candidates.length; i += CHUNK) chunks.push(input.candidates.slice(i, i + CHUNK));

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const s = now();
    const user =
      `SECTION M FACTORS (governingFactors must come only from these names):\n` +
      (factorNames.length ? factorNames.map(n => `- ${n}`).join('\n') : '(none)') +
      `\n\nCANDIDATES (classify each by candidateId):\n` +
      chunk.map(c => `[${c.candidateId}] (${c.modalClass}; ${c.citation}) ${c.text}`).join('\n');
    try {
      const r = await completeStructured<ClassifyOutput>({
        provider, model, apiKey,
        system: CLASSIFY_SYSTEM, user,
        toolName: CLASSIFY_TOOL.name, toolDescription: CLASSIFY_TOOL.description,
        inputSchema: CLASSIFY_TOOL.inputSchema as unknown as Record<string, unknown>,
        maxTokens: STEP_B_MAX_TOKENS, temperature: 0
      });
      await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: r.tokenIn, tokenOut: r.tokenOut, ok: true });
      for (const cl of r.data?.classifications ?? []) if (cl?.candidateId) classifications.set(cl.candidateId, cl);
      steps.push({ step: `classify ${ci + 1}/${chunks.length}`, model, tokenIn: r.tokenIn, tokenOut: r.tokenOut, ms: now() - s, note: `${chunk.length} candidates`, ok: true });
    } catch (e) {
      await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
      const msg = e instanceof Error ? e.message : 'chunk failed';
      steps.push({ step: `classify ${ci + 1}/${chunks.length}`, model, tokenIn: 0, tokenOut: 0, ms: now() - s, note: msg, ok: false });
      return fail(`Classification (Step B, chunk ${ci + 1}/${chunks.length}) failed: ${msg}`);
    }
  }

  // 5) Data-QC → build requirement rows (ground / dedupe / classify / link).
  const reqRows: Prisma.RequirementCreateManyInput[] = [];
  const seen = new Set<string>();
  let flagged = 0, linkedInstr = 0, instrTotal = 0;
  for (const c of input.candidates) {
    const cl = classifications.get(c.candidateId);
    if (!cl || !cl.isRequirement) continue;

    const key = (c.spanStart != null && c.spanEnd != null)
      ? `${c.docId}:${c.spanStart}:${c.spanEnd}`
      : `${c.citation}::${c.text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const grounded = isGrounded(c.text, haystack);                // parser-verbatim → should hold
    const links = (cl.governingFactors ?? [])
      .map(n => (n ?? '').trim())
      .filter(n => factorNameSet.has(n.toLowerCase()));            // reject any invented factor name
    const rawName = (cl.name ?? '').trim();
    const name = (!rawName || isParserHandle(rawName)) ? c.text.slice(0, 120) : rawName.slice(0, 300);
    const flag = !grounded || cl.confidence === 'low';
    if (flag) flagged++;
    if (cl.source === 'instruction' || cl.source === 'sow_pws') { instrTotal++; if (links.length) linkedInstr++; }

    reqRows.push({
      companyId, solicitationId,
      name,
      description: c.text.slice(0, 8000),
      source: cl.source, disposition: cl.disposition, isScored: cl.disposition === 'scored',
      citation: c.citation.slice(0, 200), citationSynthesized: c.citationSynthesized,
      farReference: '', complianceStatus: 'not_assessed',
      reviewStatus: flag ? 'flagged' : 'approved',
      governingFactors: links,
      documentId: BigInt(c.docId),
      spanStart: c.spanStart ?? undefined,
      spanEnd: c.spanEnd ?? undefined,
      sortOrder: sortOrder++
    });
  }

  // 6) Sanity gate — candidates present but NOTHING to persist (no requirements AND no factors) is
  //    an explicit failure, not a silent empty matrix. If factors were extracted we still persist
  //    them even when 0 candidates classified as requirements, so paid-for Section M work is never
  //    thrown away; the trace + flagged counts make the low requirement count visible.
  if (input.candidates.length > 0 && reqRows.length === 0 && factorRows.length === 0) {
    return fail(`Sanity check failed: ${input.candidates.length} candidates but 0 classified as requirements and 0 factors extracted. Not persisting an empty matrix.`);
  }

  // 7) Persist once (clear + write) and store the run trace on the solicitation for transparency.
  const persistS = now();
  const traceNote = JSON.stringify({
    shredTrace: {
      generatedAt: new Date().toISOString(),
      totalMs: now() - t0,
      steps,
      counts: {
        candidates: input.candidates.length, factors: factorRows.length, requirements: reqRows.length,
        flagged, linkedInstructions: linkedInstr, instructions: instrTotal
      }
    }
  });
  try {
    const persisted = await persistMatrix(companyId, solicitationId, [...factorRows, ...reqRows], traceNote);
    steps.push({ step: 'persist', model: '-', tokenIn: 0, tokenOut: 0, ms: now() - persistS, note: `cleared ${persisted.cleared}, wrote ${persisted.inserted}`, ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'persist failed';
    steps.push({ step: 'persist', model: '-', tokenIn: 0, tokenOut: 0, ms: now() - persistS, note: msg, ok: false });
    return fail(`Persist failed: ${msg}`);
  }

  return {
    ok: true,
    counts: {
      candidates: input.candidates.length, factors: factorRows.length, requirements: reqRows.length,
      flagged, linkedInstructions: linkedInstr, instructions: instrTotal
    },
    trace: { steps, totalMs: now() - t0, estCostUsd: steps.reduce((a, s) => a + estCost(s.model, s.tokenIn, s.tokenOut), 0) }
  };
}
