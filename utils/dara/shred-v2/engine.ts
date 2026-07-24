// Shred v2 engine — the ordered passes run as DISCRETE calls, each streaming a step into the
// transparency run-log (dara_shred_runs) as it executes, so the page can watch it live. It produces
// the same grounded compliance matrix as v1 (load → Section M factors → classify+link in sequential
// chunks → data-QC → persist once), but observable. Runs synchronously to completion; the run-log
// breadcrumbs (written in short side transactions) are what the UI polls while this request is open.
//
// This is the sequenced replacement for the (proven-impossible) single "all AI call". The richer
// canonical ontology (citations / evaluation-criteria / mappings tables) layers on in a later phase;
// here the passes populate the existing matrix so v2 is immediately useful with full transparency.

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
import { startRun, beginStep, endStep, finishRun } from '@/utils/dara/shred-v2/run-log';

const CHUNK = 150;
const STEP_A_MAX_TOKENS = 6000;
const STEP_B_MAX_TOKENS = 20000;

export interface ShredV2Result {
  ok: boolean;
  error?: string;
  runId: string;
  counts: { candidates: number; factors: number; requirements: number; flagged: number; linkedInstructions: number; instructions: number };
}

export async function runShredV2(solicitationId: bigint, companyId: bigint): Promise<ShredV2Result> {
  const emptyCounts = { candidates: 0, factors: 0, requirements: 0, flagged: 0, linkedInstructions: 0, instructions: 0 };
  const runId = await startRun(companyId, solicitationId);
  const rid = runId; // bigint
  const t = () => Date.now();

  const bail = async (label: string, error: string): Promise<ShredV2Result> => {
    await endStep(companyId, rid, label, 'failed', { detail: error });
    await finishRun(companyId, rid, 'failed', emptyCounts, error);
    return { ok: false, error, runId: rid.toString(), counts: emptyCounts };
  };

  try {
    // 1) Load — deterministic, no AI.
    let s = t();
    await beginStep(companyId, rid, 'Load corpus', 'Reading the parsed requirement candidates');
    const input = await loadShredInput(solicitationId, companyId);
    if (input.error) return await bail('Load corpus', input.error);
    await endStep(companyId, rid, 'Load corpus', 'done', {
      count: input.candidates.length, ms: t() - s,
      detail: `${input.candidates.length} candidates across ${input.docCount} document(s)`
    });

    // 2) Resolve model/key.
    const platform = await getPlatformAI().catch(() => undefined);
    const company = await withTenant(companyId, (tx) => tx.company.findFirst({ where: { id: companyId } }));
    if (!company) return await bail('Load corpus', 'Company not found.');
    const { provider, model, apiKey } = applyCapabilityOverride(
      resolveCompanyAI(company, platform), 'shred', company, platform, await getCapabilityOverrides()
    );
    if (!apiKey) return await bail('Load corpus', `No API key configured (provider "${provider}").`);

    const haystack = buildHaystack(input.allText);
    const smHay = buildHaystack(input.sectionMText);
    let sortOrder = 0;

    // 3) STEP A — Section M evaluation factors (one call).
    s = t();
    await beginStep(companyId, rid, 'Extract Section M factors', 'Reading the evaluation methodology');
    let factors: ExtractedFactor[] = [];
    try {
      const r = await completeStructured<FactorsOutput>({
        provider, model, apiKey, system: FACTORS_SYSTEM,
        user: `SECTION M (evaluation methodology):\n\n${input.sectionMText || '(no Section M text detected)'}`,
        toolName: FACTORS_TOOL.name, toolDescription: FACTORS_TOOL.description,
        inputSchema: FACTORS_TOOL.inputSchema as unknown as Record<string, unknown>,
        maxTokens: STEP_A_MAX_TOKENS, temperature: 0
      });
      await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: r.tokenIn, tokenOut: r.tokenOut, ok: true });
      factors = (r.data?.factors ?? []).filter((f) => (f?.name ?? '').trim() && !isParserHandle(f.name));
    } catch (e) {
      await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
      return await bail('Extract Section M factors', `Factor extraction failed: ${e instanceof Error ? e.message : 'error'}`);
    }
    const factorNames = factors.map((f) => f.name.trim());
    const factorNameSet = new Set(factorNames.map((n) => n.toLowerCase()));
    await endStep(companyId, rid, 'Extract Section M factors', 'done', { count: factors.length, ms: t() - s, detail: factorNames.slice(0, 6).join(' · ') || 'none found' });

    const factorRows: Prisma.RequirementCreateManyInput[] = factors.map((f) => {
      const grounded = isGrounded(f.description, smHay) || isGrounded(f.name, smHay);
      return {
        companyId, solicitationId, name: f.name.slice(0, 300),
        description: ((f.description ?? '').slice(0, 4000)) || null,
        source: 'evaluation_factor', disposition: 'scored', isScored: true,
        citation: (grounded && !isParserHandle(f.citation) ? (f.citation ?? '') : '').slice(0, 200),
        farReference: '', complianceStatus: 'not_assessed',
        reviewStatus: grounded ? 'approved' : 'flagged', governingFactors: [], sortOrder: sortOrder++
      };
    });

    // 4) STEP B — classify candidates in SEQUENTIAL chunks (one call at a time).
    const classifications = new Map<string, CandidateClassification>();
    const chunks: ShredCandidate[][] = [];
    for (let i = 0; i < input.candidates.length; i += CHUNK) chunks.push(input.candidates.slice(i, i + CHUNK));

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const label = `Classify & link ${ci + 1}/${chunks.length}`;
      s = t();
      await beginStep(companyId, rid, label, `${chunk.length} candidates`);
      const user =
        `SECTION M FACTORS (governingFactors must come only from these names):\n` +
        (factorNames.length ? factorNames.map((n) => `- ${n}`).join('\n') : '(none)') +
        `\n\nCANDIDATES (classify each by candidateId):\n` +
        chunk.map((c) => `[${c.candidateId}] (${c.modalClass}; ${c.citation}) ${c.text}`).join('\n');
      try {
        const r = await completeStructured<ClassifyOutput>({
          provider, model, apiKey, system: CLASSIFY_SYSTEM, user,
          toolName: CLASSIFY_TOOL.name, toolDescription: CLASSIFY_TOOL.description,
          inputSchema: CLASSIFY_TOOL.inputSchema as unknown as Record<string, unknown>,
          maxTokens: STEP_B_MAX_TOKENS, temperature: 0
        });
        await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: r.tokenIn, tokenOut: r.tokenOut, ok: true });
        for (const cl of r.data?.classifications ?? []) if (cl?.candidateId) classifications.set(cl.candidateId, cl);
        await endStep(companyId, rid, label, 'done', { count: chunk.length, ms: t() - s });
      } catch (e) {
        await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
        return await bail(label, `Classification chunk ${ci + 1}/${chunks.length} failed: ${e instanceof Error ? e.message : 'error'}`);
      }
    }

    // 5) Data-QC → build requirement rows.
    s = t();
    await beginStep(companyId, rid, 'Quality control', 'Grounding, dedupe, link, sanity');
    const reqRows: Prisma.RequirementCreateManyInput[] = [];
    const seen = new Set<string>();
    let flagged = 0, linkedInstr = 0, instrTotal = 0;
    for (const c of input.candidates) {
      const cl = classifications.get(c.candidateId);
      if (!cl || !cl.isRequirement) continue;
      const key = (c.spanStart != null && c.spanEnd != null) ? `${c.docId}:${c.spanStart}:${c.spanEnd}` : `${c.citation}::${c.text.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const grounded = isGrounded(c.text, haystack);
      const links = (cl.governingFactors ?? []).map((n) => (n ?? '').trim()).filter((n) => factorNameSet.has(n.toLowerCase()));
      const name = c.text.slice(0, 160);
      const flag = !grounded;
      if (flag) flagged++;
      if ((cl.source === 'instruction' || cl.source === 'sow_pws') && cl.disposition !== 'administrative') { instrTotal++; if (links.length) linkedInstr++; }
      reqRows.push({
        companyId, solicitationId, name, description: c.text.slice(0, 8000),
        source: cl.source, disposition: cl.disposition, isScored: cl.disposition === 'scored',
        citation: c.citation.slice(0, 200), citationSynthesized: c.citationSynthesized,
        farReference: '', complianceStatus: 'not_assessed', reviewStatus: flag ? 'flagged' : 'approved',
        governingFactors: links, documentId: BigInt(c.docId),
        spanStart: c.spanStart ?? undefined, spanEnd: c.spanEnd ?? undefined, sortOrder: sortOrder++
      });
    }
    if (input.candidates.length > 0 && reqRows.length === 0 && factorRows.length === 0) {
      return await bail('Quality control', `${input.candidates.length} candidates but nothing classified as a requirement or factor.`);
    }
    await endStep(companyId, rid, 'Quality control', 'done', {
      count: reqRows.length, ms: t() - s,
      detail: `${reqRows.length} requirements, ${factorRows.length} factors, ${flagged} flagged`
    });

    // 6) Persist once (clear + write).
    s = t();
    await beginStep(companyId, rid, 'Write matrix', 'Clearing and writing the compliance matrix');
    try {
      const persisted = await persistMatrix(companyId, solicitationId, [...factorRows, ...reqRows]);
      await endStep(companyId, rid, 'Write matrix', 'done', { count: persisted.inserted, ms: t() - s, detail: `cleared ${persisted.cleared}, wrote ${persisted.inserted}` });
    } catch (e) {
      return await bail('Write matrix', `Persist failed: ${e instanceof Error ? e.message : 'error'}`);
    }

    const counts = {
      candidates: input.candidates.length, factors: factorRows.length, requirements: reqRows.length,
      flagged, linkedInstructions: linkedInstr, instructions: instrTotal
    };
    await finishRun(companyId, rid, 'complete', counts);
    return { ok: true, runId: rid.toString(), counts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Shred v2 failed.';
    await finishRun(companyId, rid, 'failed', emptyCounts, msg).catch(() => {});
    return { ok: false, error: msg, runId: rid.toString(), counts: emptyCounts };
  }
}
