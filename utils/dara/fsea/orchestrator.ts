// FSEA Orchestrator — Federal Solicitation Evaluation Architecture pipeline entry point.
//
// Replaces shredRequirements(). Sequences all 10 passes, writes progress labels to the
// job queue row after each pass, validates output at each stage, and persists results.
//
// Each pass is a focused LLM call at temperature 0. The output of each pass is passed as
// context to the next. No pass attempts to do more than its defined scope.

import { withTenant, prismaAdmin } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { logUsage } from '@/utils/dara/usage';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';
import { asParseResult, joinParagraphs } from '@/utils/dara/parse-result';
import {
  PASS_2_SYSTEM, PASS_3_SYSTEM, PASS_4_SYSTEM, PASS_5_SYSTEM,
  PASS_6_SYSTEM, PASS_7_SYSTEM, PASS_8_SYSTEM, PASS_9_SYSTEM, PASS_10_SYSTEM
} from './prompts/index';
import type {
  FSEAResult, P1DocumentStructure, P2Output, P3Output, P4Output,
  P5Output, P6Output, P7Output, P8Output, P9Output, P10Output
} from './types';
import { writeFseaResults } from './persist/write-results';

const MAX_TOKENS = 32000;
const MAX_DOC_CHARS = 500_000;

// ── Progress helper ────────────────────────────────────────────────────────────

async function setProgress(jobId: bigint | undefined, label: string, progress: number): Promise<void> {
  if (!jobId) return;
  try {
    await prismaAdmin.jobQueue.update({
      where: { id: jobId },
      data: { progressLabel: label, progress }
    });
  } catch { /* non-fatal */ }
}

// ── JSON parse helper ──────────────────────────────────────────────────────────

function parsePassOutput<T>(raw: string, passName: string): T | null {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    return JSON.parse(clean) as T;
  } catch (e) {
    console.error(`[fsea] ${passName} JSON parse failed:`, e instanceof Error ? e.message : e);
    console.error(`[fsea] ${passName} raw output (first 500 chars):`, raw.slice(0, 500));
    return null;
  }
}

// ── Pass 1 — Document structure (deterministic, no LLM) ───────────────────────

async function runPass1(
  solId: bigint,
  companyId: bigint
): Promise<P1DocumentStructure | null> {
  const loaded = await withTenant(companyId, async (tx) => {
    const sol = await tx.solicitation.findFirst({
      where: { id: solId, companyId },
      include: { solDocs: true }
    });
    return sol;
  });

  if (!loaded) return null;

  const SHRED_ELIGIBLE = new Set(['rfp_base', 'pws_sow']);
  const eligibleDocs = loaded.solDocs.filter(
    (d) => d.docType === 'rfp' && d.extractionStatus === 'complete'
      && (!d.documentRole || SHRED_ELIGIBLE.has(d.documentRole ?? ''))
  );

  if (eligibleDocs.length === 0) return null;

  // Load parse results for structured text, fall back to extracted text
  const docTexts: string[] = [];
  const packageInventory: P1DocumentStructure['packageInventory'] = [];

  for (const doc of eligibleDocs) {
    const parseRows = await withTenant(companyId, async (tx) => {
      return tx.daraParseResult.findMany({
        where: { solDocId: doc.id, supersededAt: null },
        orderBy: { id: 'desc' },
        take: 1
      });
    });

    let text = '';
    if (parseRows.length > 0) {
      const pr = asParseResult(parseRows[0].result);
      if (pr) {
        text = joinParagraphs(pr);
      }
    }
    if (!text.trim()) {
      text = decryptField(doc.extractedText) ?? '';
    }

    if (text.trim()) {
      docTexts.push(`=== DOCUMENT: ${doc.originalFilename} [${doc.documentRole ?? 'unclassified'}] ===\n\n${text}`);
    }

    packageInventory.push({
      name: doc.originalFilename,
      role: (doc.documentRole as P1DocumentStructure['packageInventory'][0]['role']) ?? 'other',
      present: true
    });
  }

  let documentText = docTexts.join('\n\n');
  if (documentText.length > MAX_DOC_CHARS) {
    documentText = documentText.slice(0, MAX_DOC_CHARS) + '\n\n[Document truncated to context limit]';
  }

  return {
    packageInventory,
    sections: [],          // populated by the LLM passes — P1 just provides the text
    criticalParagraphs: [],
    cdrlItems: [],
    documentText
  };
}

// ── Generic LLM pass runner ────────────────────────────────────────────────────

async function runLlmPass(
  system: string,
  userContent: string,
  provider: string,
  model: string,
  apiKey: string,
  companyId: bigint,
  passName: string
): Promise<string | null> {
  try {
    const result = await complete(provider, system, userContent, model, apiKey, MAX_TOKENS);
    await logUsage({
      capability: 'shred',
      provider,
      model,
      companyId,
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut
    });
    return result.text;
  } catch (e) {
    await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
    console.error(`[fsea] ${passName} LLM call failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

export async function runFSEA(
  solicitationId: bigint,
  companyId: bigint,
  deadlineMs: number,
  jobId?: bigint
): Promise<FSEAResult> {

  // Guard: do not overwrite a populated matrix without explicit clear
  const existing = await withTenant(companyId, async (tx) => {
    return tx.requirement.count({ where: { solicitationId, companyId, removedAt: null } });
  });
  if (existing > 0) {
    return { ok: false, error: 'Matrix already populated. Clear existing requirements before re-running the pipeline.' };
  }

  // Resolve AI provider
  const platform = await (async () => {
    try { return await getPlatformAI(); } catch { return undefined; }
  })();

  const company = await withTenant(companyId, async (tx) => {
    return tx.company.findFirst({ where: { id: companyId } });
  });
  if (!company) return { ok: false, error: 'Company not found.' };

  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(company, platform),
    'shred',
    company,
    platform,
    await getCapabilityOverrides()
  );
  if (!apiKey) return { ok: false, error: `No API key configured for provider "${provider}".` };

  const passResults: FSEAResult['passResults'] = {};

  // ── Pass 1 — Document structure ──────────────────────────────────────────────
  await setProgress(jobId, 'Pass 1 — Assembling document package…', 5);
  const p1 = await runPass1(solicitationId, companyId);
  if (!p1 || !p1.documentText.trim()) {
    return { ok: false, error: 'No eligible documents found. Assign rfp_base or pws_sow roles and wait for extraction.' };
  }
  passResults.p1 = true;

  const docText = p1.documentText;

  // ── Pass 2 — Requirement candidate detection ──────────────────────────────────
  await setProgress(jobId, 'Pass 2 — Detecting requirement candidates…', 12);
  const p2Raw = await runLlmPass(
    PASS_2_SYSTEM,
    `SOLICITATION PACKAGE:\n\n${docText}`,
    provider, model, apiKey, companyId, 'Pass 2'
  );
  const p2 = p2Raw ? parsePassOutput<P2Output>(p2Raw, 'Pass 2') : null;
  if (!p2 || p2.candidates.length === 0) {
    return { ok: false, error: 'Pass 2 failed: no requirement candidates detected.' };
  }
  passResults.p2 = true;
  console.log(`[fsea] Pass 2 complete: ${p2.candidates.length} candidates (${p2.summary.critical} critical)`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 2.' };

  // ── Pass 3 — Evaluation factor discovery ──────────────────────────────────────
  await setProgress(jobId, 'Pass 3 — Parsing evaluation methodology…', 20);
  const p3Raw = await runLlmPass(
    PASS_3_SYSTEM,
    `SOLICITATION PACKAGE:\n\n${docText}`,
    provider, model, apiKey, companyId, 'Pass 3'
  );
  const p3 = p3Raw ? parsePassOutput<P3Output>(p3Raw, 'Pass 3') : null;
  if (!p3) {
    return { ok: false, error: 'Pass 3 failed: evaluation factor discovery returned no output.' };
  }
  passResults.p3 = true;
  console.log(`[fsea] Pass 3 complete: strategy=${p3.evaluationStrategy}, factors=${p3.factors.length}`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 3.' };

  // ── Pass 4 — Evaluation ontology ──────────────────────────────────────────────
  await setProgress(jobId, 'Pass 4 — Building evaluation ontology…', 28);
  const p4Raw = await runLlmPass(
    PASS_4_SYSTEM,
    `SOLICITATION PACKAGE:\n\n${docText}\n\n` +
    `PASS 2 CANDIDATE LIST:\n${JSON.stringify(p2, null, 2)}\n\n` +
    `PASS 3 EVALUATION FACTORS:\n${JSON.stringify(p3, null, 2)}`,
    provider, model, apiKey, companyId, 'Pass 4'
  );
  const p4 = p4Raw ? parsePassOutput<P4Output>(p4Raw, 'Pass 4') : null;
  if (!p4) {
    return { ok: false, error: 'Pass 4 failed: evaluation ontology construction returned no output.' };
  }
  passResults.p4 = true;
  console.log(`[fsea] Pass 4 complete: criteria=${p4.criteria.length}, surface=${p4.evaluationSurface.length}, SO=${p4.strengthOpportunities.length}`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 4.' };

  // ── Pass 5 — Requirement classification ───────────────────────────────────────
  await setProgress(jobId, 'Pass 5 — Classifying requirements…', 38);
  const p5Raw = await runLlmPass(
    PASS_5_SYSTEM,
    `EVALUATION ONTOLOGY:\n${JSON.stringify(p4, null, 2)}\n\n` +
    `REQUIREMENT CANDIDATES:\n${JSON.stringify(p2.candidates, null, 2)}`,
    provider, model, apiKey, companyId, 'Pass 5'
  );
  const p5 = p5Raw ? parsePassOutput<P5Output>(p5Raw, 'Pass 5') : null;
  if (!p5) {
    return { ok: false, error: 'Pass 5 failed: requirement classification returned no output.' };
  }
  passResults.p5 = true;
  const matrixCount = p5.classified.filter(r => r.disposition === 'MATRIX').length;
  console.log(`[fsea] Pass 5 complete: matrix=${matrixCount}, discard=${p5.summary.discarded}, clusters=${p5.clusters.length}`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 5.' };

  // ── Pass 6 — Proposal actionability ───────────────────────────────────────────
  await setProgress(jobId, 'Pass 6 — Determining proposal actionability and page budget…', 46);
  const matrixReqs = p5.classified.filter(r => r.disposition === 'MATRIX');
  const p6Raw = await runLlmPass(
    PASS_6_SYSTEM,
    `EVALUATION ONTOLOGY:\n${JSON.stringify(p4, null, 2)}\n\n` +
    `MATRIX REQUIREMENTS:\n${JSON.stringify(matrixReqs, null, 2)}\n\n` +
    `CLUSTERS:\n${JSON.stringify(p5.clusters, null, 2)}`,
    provider, model, apiKey, companyId, 'Pass 6'
  );
  const p6 = p6Raw ? parsePassOutput<P6Output>(p6Raw, 'Pass 6') : null;
  if (!p6) {
    return { ok: false, error: 'Pass 6 failed: actionability determination returned no output.' };
  }
  passResults.p6 = true;
  console.log(`[fsea] Pass 6 complete: budget paragraphs=${p6.pageBudget.length}, strength targets=${p6.strengthTargetList.length}`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 6.' };

  // ── Pass 7 — L-to-M mapping ────────────────────────────────────────────────────
  await setProgress(jobId, 'Pass 7 — Mapping Section L to Section M…', 54);
  const p7Raw = await runLlmPass(
    PASS_7_SYSTEM,
    `SOLICITATION PACKAGE:\n\n${docText}\n\n` +
    `EVALUATION ONTOLOGY:\n${JSON.stringify(p4, null, 2)}\n\n` +
    `CLASSIFIED MATRIX REQUIREMENTS:\n${JSON.stringify(matrixReqs, null, 2)}\n\n` +
    `ACTIONABILITY DETERMINATIONS:\n${JSON.stringify(p6.actionabilityDeterminations, null, 2)}`,
    provider, model, apiKey, companyId, 'Pass 7'
  );
  const p7 = p7Raw ? parsePassOutput<P7Output>(p7Raw, 'Pass 7') : null;
  if (!p7) {
    return { ok: false, error: 'Pass 7 failed: L-to-M mapping returned no output.' };
  }
  passResults.p7 = true;
  console.log(`[fsea] Pass 7 complete: paragraph maps=${p7.paragraphMaps.length}, cross-wires=${p7.crossParagraphWires.length}`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 7.' };

  // ── Pass 8 — Strength opportunity detection ────────────────────────────────────
  await setProgress(jobId, 'Pass 8 — Detecting strength opportunities…', 62);
  const p8Raw = await runLlmPass(
    PASS_8_SYSTEM,
    `EVALUATION ONTOLOGY:\n${JSON.stringify(p4, null, 2)}\n\n` +
    `L-TO-M MAPPING:\n${JSON.stringify(p7, null, 2)}\n\n` +
    `SOLICITATION STRENGTH DEFINITION:\n${JSON.stringify(p4.constructs, null, 2)}`,
    provider, model, apiKey, companyId, 'Pass 8'
  );
  const p8 = p8Raw ? parsePassOutput<P8Output>(p8Raw, 'Pass 8') : null;
  if (!p8) {
    return { ok: false, error: 'Pass 8 failed: strength detection returned no output.' };
  }
  passResults.p8 = true;
  console.log(`[fsea] Pass 8 complete: strengths=${p8.strengthOpportunities.length}`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 8.' };

  // ── Pass 9 — Cross-reference resolution ───────────────────────────────────────
  await setProgress(jobId, 'Pass 9 — Resolving cross-references and regulatory citations…', 70);
  const p9Raw = await runLlmPass(
    PASS_9_SYSTEM,
    `ALL PRIOR PASS OUTPUTS:\n\n` +
    `PASS 5 CLUSTERS:\n${JSON.stringify(p5.clusters, null, 2)}\n\n` +
    `PASS 6 CLUSTER CONSOLIDATION:\n${JSON.stringify(p6.clusterConsolidation, null, 2)}\n\n` +
    `PASS 7 CROSS-PARAGRAPH WIRES:\n${JSON.stringify(p7.crossParagraphWires, null, 2)}\n\n` +
    `PASS 8 STRENGTH OPPORTUNITIES (for citation verification):\n${JSON.stringify(p8.strengthOpportunities.slice(0, 10), null, 2)}\n\n` +
    `SOLICITATION TEXT (for anchor verification):\n${docText.slice(0, 50000)}`,
    provider, model, apiKey, companyId, 'Pass 9'
  );
  const p9 = p9Raw ? parsePassOutput<P9Output>(p9Raw, 'Pass 9') : null;
  if (!p9) {
    return { ok: false, error: 'Pass 9 failed: cross-reference resolution returned no output.' };
  }
  passResults.p9 = true;
  console.log(`[fsea] Pass 9 complete: xrefs=${p9.internalCrossRefs.length}, citations=${p9.regulatoryCitations.length}`);

  if (Date.now() > deadlineMs) return { ok: false, error: 'Pipeline deadline exceeded after Pass 9.' };

  // ── Pass 10 — Matrix and products generation ───────────────────────────────────
  await setProgress(jobId, 'Pass 10 — Generating evaluation matrix and writing plan…', 80);
  const p10Raw = await runLlmPass(
    PASS_10_SYSTEM,
    `COMPLETE FSEA PIPELINE OUTPUT:\n\n` +
    `PASS 2 — CANDIDATES:\n${JSON.stringify(p2, null, 2)}\n\n` +
    `PASS 3 — EVALUATION FACTORS:\n${JSON.stringify(p3, null, 2)}\n\n` +
    `PASS 4 — ONTOLOGY:\n${JSON.stringify(p4, null, 2)}\n\n` +
    `PASS 5 — CLASSIFIED:\n${JSON.stringify(p5, null, 2)}\n\n` +
    `PASS 6 — ACTIONABILITY:\n${JSON.stringify(p6, null, 2)}\n\n` +
    `PASS 7 — L-TO-M MAPPING:\n${JSON.stringify(p7, null, 2)}\n\n` +
    `PASS 8 — STRENGTHS:\n${JSON.stringify(p8, null, 2)}\n\n` +
    `PASS 9 — CROSS-REFERENCES:\n${JSON.stringify(p9, null, 2)}`,
    provider, model, apiKey, companyId, 'Pass 10'
  );
  const p10 = p10Raw ? parsePassOutput<P10Output>(p10Raw, 'Pass 10') : null;
  if (!p10) {
    return { ok: false, error: 'Pass 10 failed: matrix generation returned no output.' };
  }
  passResults.p10 = true;
  console.log(`[fsea] Pass 10 complete: matrix rows=${p10.sectionA.length}, SO=${p10.sectionB.length}, WR=${p10.sectionC.length}, AC=${p10.sectionD.length}`);

  // ── Persist all results ────────────────────────────────────────────────────────
  await setProgress(jobId, `Saving ${p10.sectionA.length} requirements and evaluation matrix…`, 90);

  await writeFseaResults({
    solicitationId,
    companyId,
    p2, p3, p4, p5, p6, p7, p8, p9, p10
  });

  await setProgress(jobId, `Pipeline complete — ${p10.sectionA.length} requirements, ${p10.sectionB.length} strength opportunities`, 100);

  return {
    ok: true,
    matrixCount: p10.sectionA.length,
    strengthCount: p10.sectionB.length,
    adminCount: p10.sectionD.length,
    passResults
  };
}
