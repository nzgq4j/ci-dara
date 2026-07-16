// FSEA Orchestrator — Federal Solicitation Evaluation Architecture pipeline entry point.
//
// Replaces shredRequirements(). Sequences all 10 passes, writes progress labels to the
// job queue row after each pass, validates output at each stage, and persists results.
//
// Error handling strategy:
//   - Passes 2 and 3 are hard gates: without candidates and without an evaluation model
//     the entire pipeline is meaningless. Failure here aborts with a clear user-facing error.
//   - Passes 4 and 5 are soft-retryable: if JSON parse fails, one retry with a shorter
//     context is attempted before aborting.
//   - Passes 6-9 are graceful-degradable: failure saves what exists and flags the gap.
//     The matrix is still written; the missing pass is noted in the executive summary.
//   - Pass 10 is hard: without the matrix there is nothing to save. On failure, partial
//     data from passes 2-9 is saved directly so the run is not a total loss.
//   - Every pass timeout (deadline exceeded) saves current state and marks the job done
//     rather than failing — the UI shows partial output with a resume option.

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
import { writeFseaResults, writeFseaPartial } from './persist/write-results';

const MAX_TOKENS = 32000;
const MAX_DOC_CHARS = 500_000;
// Chunk size for large documents fed to Passes 2 and 4.
// 80k chars ≈ 60k tokens — comfortably within Haiku's 200k context with room for system prompt and output.
const CHUNK_SIZE = 80_000;
// Overlap between chunks so requirements spanning chunk boundaries are not missed.
const CHUNK_OVERLAP = 5_000;
// Context budget per pass — trim prior pass outputs to this many chars when building user message.
const MAX_PRIOR_CONTEXT_CHARS = 80_000;

// ── Progress helper ────────────────────────────────────────────────────────────

async function setProgress(jobId: bigint | undefined, label: string, progress: number): Promise<void> {
  if (!jobId) return;
  try {
    await prismaAdmin.jobQueue.update({
      where: { id: jobId },
      data: { progressLabel: label, progress }
    });
  } catch { /* non-fatal — progress label is cosmetic */ }
}

// ── JSON parse helper with retry ───────────────────────────────────────────────

function parsePassOutput<T>(raw: string, passName: string): { data: T; error: null } | { data: null; error: string } {
  // Strip markdown fences the model occasionally adds despite instructions
  const clean = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Attempt 1: direct parse
  try {
    return { data: JSON.parse(clean) as T, error: null };
  } catch (e1) {
    // Attempt 2: extract the outermost JSON object or array
    const objMatch = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) {
      try {
        return { data: JSON.parse(objMatch[1]) as T, error: null };
      } catch { /* fall through */ }
    }
    const msg = e1 instanceof Error ? e1.message : 'JSON parse error';
    console.error(`[fsea] ${passName} parse failed: ${msg}`);
    console.error(`[fsea] ${passName} raw (first 800 chars): ${raw.slice(0, 800)}`);
    return { data: null, error: `${passName} produced invalid JSON: ${msg}` };
  }
}

// Validate minimum shape requirements for each pass output.
// Returns a string describing the violation, or null if valid.
function validatePassOutput(data: unknown, passName: string): string | null {
  if (!data || typeof data !== 'object') return `${passName} output is not an object`;
  const obj = data as Record<string, unknown>;

  switch (passName) {
    case 'Pass 2':
      if (!Array.isArray(obj.candidates)) return 'Pass 2: candidates array missing';
      if ((obj.candidates as unknown[]).length === 0) return 'Pass 2: no candidates extracted — document may be unreadable or contain no requirements';
      return null;
    case 'Pass 3': {
      if (!Array.isArray(obj.factors)) {
        // Attempt common schema mismatch recovery before failing
        const alt = obj.evaluation_factors ?? obj.evaluationFactors ?? obj.factor_list ?? obj.factorList;
        if (Array.isArray(alt) && alt.length > 0) {
          (obj as Record<string, unknown>).factors = alt;
          console.warn('[fsea] Pass 3: recovered factors from alternate field name');
          return null; // valid after recovery
        }
        return 'Pass 3: factors array missing — check that the solicitation contains Section M / evaluation criteria language and that the model received it within the context window';
      }
      if ((obj.factors as unknown[]).length === 0) return 'Pass 3: factors array is empty — no evaluation factors found in the solicitation';
      return null;
    }
    case 'Pass 4':
      if (!Array.isArray(obj.criteria)) return 'Pass 4: criteria array missing';
      if (!Array.isArray(obj.factors)) return 'Pass 4: factors array missing';
      return null;
    case 'Pass 5':
      if (!Array.isArray(obj.classified)) return 'Pass 5: classified array missing';
      return null;
    case 'Pass 10':
      if (!Array.isArray(obj.sectionA)) return 'Pass 10: sectionA array missing';
      if ((obj.sectionA as unknown[]).length === 0) return 'Pass 10: evaluation matrix is empty — no actionable requirements were produced';
      return null;
    default:
      return null; // passes 6-9 are graceful-degradable
  }
}

// ── LLM pass runner ────────────────────────────────────────────────────────────

interface LlmPassOptions {
  system: string;
  user: string;
  provider: string;
  model: string;
  apiKey: string;
  companyId: bigint;
  passName: string;
  retryOnParseFailure?: boolean;
}

async function runLlmPass<T>(
  opts: LlmPassOptions
): Promise<{ data: T; error: null } | { data: null; error: string }> {
  const { system, user, provider, model, apiKey, companyId, passName, retryOnParseFailure = false } = opts;

  const attempt = async (userContent: string): Promise<string | null> => {
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
      const msg = e instanceof Error ? e.message : 'unknown error';
      console.error(`[fsea] ${passName} LLM call failed: ${msg}`);
      return null;
    }
  };

  // First attempt with full context
  const raw = await attempt(user);
  if (!raw) return { data: null, error: `${passName}: AI call failed. Check provider API key and quota.` };

  const parsed = parsePassOutput<T>(raw, passName);
  if (parsed.data !== null) {
    const valid = validatePassOutput(parsed.data, passName);
    if (valid) return { data: null, error: valid };
    return { data: parsed.data, error: null };
  }

  // Retry with a clarifying prefix when parse fails and retry is enabled
  if (retryOnParseFailure) {
    console.warn(`[fsea] ${passName} retrying after parse failure`);
    const isP3 = passName === 'Pass 3';
    const retryPrefix = isP3
      ? `CRITICAL: Your previous response was missing the required "factors" array. You MUST return a JSON object with a "factors" array containing at least one evaluation factor. Look for language like "will be evaluated", "evaluation factor", "basis for award", "Section M", "adjectival rating", "Outstanding/Good/Acceptable/Marginal/Unacceptable" in the solicitation text. Return ONLY valid JSON — no prose, no markdown. Begin with { and end with }.\n\n`
      : `IMPORTANT: Your previous response could not be parsed as JSON. Return ONLY a valid JSON object — no prose, no markdown code fences, no explanation. Begin your response with { and end with }.\n\n`;
    const retryUser = retryPrefix + user.slice(0, MAX_PRIOR_CONTEXT_CHARS);
    const retryRaw = await attempt(retryUser);
    if (!retryRaw) return { data: null, error: `${passName}: retry AI call also failed.` };
    const retryParsed = parsePassOutput<T>(retryRaw, `${passName} (retry)`);
    if (retryParsed.data !== null) {
      const valid = validatePassOutput(retryParsed.data, passName);
      if (valid) return { data: null, error: valid };
      return { data: retryParsed.data, error: null };
    }
    return { data: null, error: `${passName}: produced invalid JSON on both attempts. ${parsed.error}` };
  }

  return { data: null, error: parsed.error ?? `${passName}: unknown parse error` };
}

// ── Chunk helper ──────────────────────────────────────────────────────────────

// Split a document into overlapping chunks for large-document passes.
// Splits at paragraph boundaries (double newline) to avoid cutting mid-sentence.
function chunkDocument(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n\n', end);
      if (boundary > start + chunkSize / 2) end = boundary + 2;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  console.log(`[fsea] chunkDocument: ${text.length} chars → ${chunks.length} chunks`);
  return chunks;
}

// ── Pass 1 — Document assembly (deterministic, no LLM) ────────────────────────

async function runPass1(
  solId: bigint,
  companyId: bigint
): Promise<{ structure: P1DocumentStructure; error: null } | { structure: null; error: string }> {
  const loaded = await withTenant(companyId, async (tx) => {
    return tx.solicitation.findFirst({
      where: { id: solId, companyId },
      include: { solDocs: true }
    });
  });

  if (!loaded) return { structure: null, error: 'Solicitation not found.' };

  const SHRED_ELIGIBLE = new Set(['rfp_base', 'pws_sow']);
  const allDocs = loaded.solDocs.filter(d => d.docType === 'rfp' && d.extractionStatus === 'complete');
  const eligibleDocs = allDocs.filter(d => !d.documentRole || SHRED_ELIGIBLE.has(d.documentRole ?? ''));
  const skipped = allDocs.filter(d => d.documentRole && !SHRED_ELIGIBLE.has(d.documentRole ?? ''));

  if (eligibleDocs.length === 0) {
    const hint = allDocs.length > 0
      ? `${allDocs.length} document(s) are uploaded but none have eligible roles (rfp_base or pws_sow). Assign document roles on the Documents tab.`
      : 'No extracted documents found. Upload the solicitation and wait for extraction to complete.';
    return { structure: null, error: hint };
  }

  const rfpBaseTexts: string[] = [];
  const pwsSowTexts: string[] = [];
  const packageInventory: P1DocumentStructure['packageInventory'] = [];
  const warnings: string[] = [];

  for (const doc of eligibleDocs) {
    const parseRows = await withTenant(companyId, async (tx) =>
      tx.daraParseResult.findMany({
        where: { solDocId: doc.id, supersededAt: null },
        orderBy: { id: 'desc' },
        take: 1
      })
    );

    let text = '';
    if (parseRows.length > 0) {
      const pr = asParseResult(parseRows[0].result);
      if (pr) text = joinParagraphs(pr);
    }
    if (!text.trim()) {
      text = decryptField(doc.extractedText) ?? '';
    }

    if (!text.trim()) {
      warnings.push(`${doc.originalFilename}: text extraction is empty — skipping this document`);
      continue;
    }

    const tagged = `=== DOCUMENT: ${doc.originalFilename} [${doc.documentRole ?? 'unclassified'}] ===\n\n${text}`;
    if (doc.documentRole === 'rfp_base') {
      rfpBaseTexts.push(tagged);
    } else {
      pwsSowTexts.push(tagged);
    }

    packageInventory.push({
      name: doc.originalFilename,
      role: (doc.documentRole as P1DocumentStructure['packageInventory'][0]['role']) ?? 'other',
      present: true
    });
  }

  for (const doc of skipped) {
    packageInventory.push({ name: doc.originalFilename, role: 'other', present: false });
  }

  if (rfpBaseTexts.length === 0 && pwsSowTexts.length === 0) {
    return { structure: null, error: `All eligible documents have empty text. ${warnings.join('; ')}` };
  }

  if (warnings.length > 0) {
    console.warn('[fsea] Pass 1 warnings:', warnings.join('; '));
  }

  // rfp_base first, then pws_sow — ensures eval methodology is never pushed past the truncation point
  const rfpBaseText = rfpBaseTexts.join('\n\n').slice(0, MAX_DOC_CHARS);
  const documentText = [...rfpBaseTexts, ...pwsSowTexts].join('\n\n').slice(0, MAX_DOC_CHARS);

  if (documentText.length === MAX_DOC_CHARS) {
    console.warn('[fsea] Pass 1: documentText truncated to MAX_DOC_CHARS');
  }

  // Pre-compute chunks for chunked pass execution on large documents
  const chunks = chunkDocument(documentText);

  return {
    structure: {
      packageInventory,
      sections: [],
      criticalParagraphs: [],
      cdrlItems: [],
      documentText,
      rfpBaseText,
      chunks
    },
    error: null
  };
}

// ── Trim prior context to fit within budget ────────────────────────────────────

function trimContext(obj: unknown, maxChars = MAX_PRIOR_CONTEXT_CHARS): string {
  const s = JSON.stringify(obj, null, 2);
  if (s.length <= maxChars) return s;
  console.warn(`[fsea] Trimming prior context from ${s.length} to ${maxChars} chars`);
  return s.slice(0, maxChars) + '\n... [truncated to fit context limit]';
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

export async function runFSEA(
  solicitationId: bigint,
  companyId: bigint,
  deadlineMs: number,
  jobId?: bigint
): Promise<FSEAResult> {
  const passResults: FSEAResult['passResults'] = {};
  const errors: Record<string, string> = {};

  // Guard: populated matrix requires explicit clear before re-run
  const existing = await withTenant(companyId, async (tx) =>
    tx.requirement.count({ where: { solicitationId, companyId, removedAt: null } })
  );
  if (existing > 0) {
    return {
      ok: false,
      error: 'Matrix already populated. Clear existing requirements before re-running the pipeline.'
    };
  }

  // Resolve AI provider
  const platform = await getPlatformAI().catch(() => undefined);
  const company = await withTenant(companyId, async (tx) =>
    tx.company.findFirst({ where: { id: companyId } })
  );
  if (!company) return { ok: false, error: 'Company not found.' };

  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(company, platform),
    'shred',
    company,
    platform,
    await getCapabilityOverrides()
  );
  if (!apiKey) return { ok: false, error: `No API key configured for provider "${provider}". Add an API key in Settings.` };

  // ── Pass 1 — Document assembly ───────────────────────────────────────────────
  await setProgress(jobId, 'Pass 1 — Assembling document package…', 5);
  const p1Result = await runPass1(solicitationId, companyId);
  if (p1Result.error) return { ok: false, error: p1Result.error };
  const p1 = p1Result.structure!;
  passResults.p1 = true;
  const docText = p1.documentText;

  // ── Pass 2 — Requirement candidate detection (HARD GATE) ─────────────────────
  // Run all chunks concurrently — candidates within each chunk are independent.
  // Serial execution was the bottleneck: 7 chunks × ~45s per Haiku call = 5+ minutes for Pass 2 alone.
  await setProgress(jobId, `Pass 2 — Scanning ${p1.chunks.length > 1 ? `${p1.chunks.length} chunks` : 'document'} for requirements…`, 12);
  const chunks = p1.chunks;
  const chunkResults = await Promise.all(
    chunks.map((chunk, ci) => {
      const chunkLabel = chunks.length > 1 ? ` (chunk ${ci + 1}/${chunks.length})` : '';
      return runLlmPass<P2Output>({
        system: PASS_2_SYSTEM,
        user: `SOLICITATION PACKAGE${chunkLabel}:\n\n${chunk}`,
        provider, model, apiKey, companyId,
        passName: `Pass 2${chunkLabel}`,
        retryOnParseFailure: true
      });
    })
  );

  const allCandidates: P2Output['candidates'] = [];
  let chunkFailCount = 0;
  for (let ci = 0; ci < chunkResults.length; ci++) {
    const r = chunkResults[ci];
    if (r.data) {
      allCandidates.push(...(r.data.candidates ?? []));
    } else {
      chunkFailCount++;
      console.warn(`[fsea] Pass 2 chunk ${ci + 1} failed: ${r.error}`);
    }
  }

  // Hard abort only if every chunk failed or this was a single-chunk document
  if (allCandidates.length === 0) {
    return { ok: false, error: `Pass 2 failed: no requirement candidates found${chunks.length > 1 ? ` across all ${chunks.length} chunks` : ''}. The pipeline cannot continue without a requirement candidate list.` };
  }
  if (chunkFailCount > 0) {
    console.warn(`[fsea] Pass 2: ${chunkFailCount}/${chunks.length} chunks failed — continuing with partial candidate list`);
  }

  // Deduplicate by reqId to remove candidates from the 5k-char overlap zones
  const seenIds = new Set<string>();
  const dedupedCandidates = allCandidates.filter(c => {
    if (seenIds.has(c.reqId)) return false;
    seenIds.add(c.reqId);
    return true;
  });
  const criticalCount = dedupedCandidates.filter(c => c.isCritical).length;
  const p2: P2Output = {
    candidates: dedupedCandidates,
    summary: { total: dedupedCandidates.length, critical: criticalCount, nonCritical: dedupedCandidates.length - criticalCount, compliance: 0 }
  };
  passResults.p2 = true;
  await setProgress(jobId, `Pass 2 — Found ${dedupedCandidates.length} requirement candidates across ${chunks.length} chunk(s)…`, 18);
  console.log(`[fsea] Pass 2: ${p2.candidates.length} candidates (${criticalCount} critical) from ${chunks.length} chunk(s), ${chunkFailCount} chunk(s) failed`);

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, error: 'Pipeline paused after Pass 2 — deadline exceeded' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 2. Re-run to continue from Pass 3.' };
  }

  // ── Pass 3 — Evaluation factor discovery (HARD GATE) ─────────────────────────
  // Section M (evaluation factors) is almost always in the second half of the base RFP.
  // Sending the entire rfpBaseText at ~64k tokens pushes Haiku to its output limit and
  // produces a truncated response that fails the factors array validation.
  //
  // Strategy: try the tail 40k chars first (most likely to contain Section M), then
  // on failure try a full-document scan with the complete rfpBaseText.
  await setProgress(jobId, 'Pass 3 — Locating Section M evaluation criteria…', 20);

  // Tail window: last 40k chars of rfpBaseText where Section M typically lives
  const P3_WINDOW = 40_000;
  const rfpTail = p1.rfpBaseText.length > P3_WINDOW
    ? p1.rfpBaseText.slice(-P3_WINDOW)
    : p1.rfpBaseText;
  const tailNote = p1.rfpBaseText.length > P3_WINDOW
    ? `\n[Note: showing final ${P3_WINDOW} characters of the base RFP — Section M typically appears in this range]`
    : '';

  const p3TailResult = await runLlmPass<P3Output>({
    system: PASS_3_SYSTEM,
    user: `SOLICITATION PACKAGE (base RFP — Section M region):${tailNote}\n\n${rfpTail}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 3 (tail)',
    retryOnParseFailure: true
  });

  // If the tail window found factors, use it — otherwise fall back to full rfpBaseText
  let p3Result = p3TailResult;
  if (p3TailResult.error) {
    console.warn(`[fsea] Pass 3 tail window failed — retrying with full rfpBaseText: ${p3TailResult.error}`);
    await setProgress(jobId, 'Pass 3 — Scanning full RFP for evaluation methodology…', 22);
    p3Result = await runLlmPass<P3Output>({
      system: PASS_3_SYSTEM,
      user: `SOLICITATION PACKAGE (base RFP):\n\n${p1.rfpBaseText}`,
      provider, model, apiKey, companyId,
      passName: 'Pass 3 (full)',
      retryOnParseFailure: true
    });
  }

  if (p3Result.error) {
    return { ok: false, error: `Pass 3 failed: ${p3Result.error}. Without an evaluation model, requirement classification cannot proceed.` };
  }
  const p3 = p3Result.data!;
  passResults.p3 = true;
  const p3Window = p3TailResult.error ? 'full RFP' : 'Section M region';
  await setProgress(jobId, `Pass 3 — Found ${(p3.factors ?? []).length} evaluation factor(s) [${p3Window}]…`, 26);
  console.log(`[fsea] Pass 3: strategy=${p3.evaluationStrategy}, factors=${(p3.factors ?? []).length}, signals=${(p3.strengthSignals ?? []).length}`);

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, p3, error: 'Pipeline paused after Pass 3 — deadline exceeded' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 3. Re-run to continue.' };
  }

  // ── Pass 4 — Evaluation ontology (RETRYABLE) ──────────────────────────────────
  await setProgress(jobId, 'Pass 4 — Building evaluation ontology…', 28);
  // Pass 4 uses rfpBaseText + compressed prior outputs — the full PWS is already
  // represented in the P2 candidate list, so we don't need to resend it raw.
  const p4Result = await runLlmPass<P4Output>({
    system: PASS_4_SYSTEM,
    user: `SOLICITATION PACKAGE (base RFP):\n\n${p1.rfpBaseText}\n\n` +
      `PASS 2 — CANDIDATES:\n${trimContext(p2)}\n\n` +
      `PASS 3 — EVALUATION FACTORS:\n${trimContext(p3)}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 4',
    retryOnParseFailure: true
  });
  if (p4Result.error) {
    errors.p4 = p4Result.error;
    console.error('[fsea] Pass 4 failed — continuing with degraded ontology:', p4Result.error);
    // Construct a minimal fallback ontology from Pass 3 output so the pipeline can continue
  }
  const p4: P4Output = p4Result.data ?? buildFallbackOntology(p3);
  passResults.p4 = !p4Result.error;
  await setProgress(jobId, `Pass 4 — Built ontology: ${(p4.factors ?? []).length} factors, ${(p4.criteria ?? []).length} criteria${p4Result.error ? ' (degraded)' : ''}…`, 34);
  console.log(`[fsea] Pass 4: criteria=${(p4.criteria ?? []).length}, surface=${(p4.evaluationSurface ?? []).length}, SO=${(p4.strengthOpportunities ?? []).length}`);

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, p3, p4, error: 'Pipeline paused after Pass 4' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 4. Re-run to continue.' };
  }

  // ── Pass 5 — Requirement classification (RETRYABLE) ───────────────────────────
  await setProgress(jobId, 'Pass 5 — Classifying requirements…', 38);
  const p5Result = await runLlmPass<P5Output>({
    system: PASS_5_SYSTEM,
    user: `EVALUATION ONTOLOGY:\n${trimContext(p4)}\n\n` +
      `REQUIREMENT CANDIDATES:\n${trimContext(p2.candidates)}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 5',
    retryOnParseFailure: true
  });
  if (p5Result.error) {
    return { ok: false, error: `Pass 5 failed: ${p5Result.error}. Cannot build the matrix without classified requirements.` };
  }
  const p5 = p5Result.data!;
  passResults.p5 = true;
  const matrixReqs = p5.classified.filter(r => r.disposition === 'MATRIX');
  await setProgress(jobId, `Pass 5 — Classified ${p5.classified?.length ?? 0} requirements: ${matrixReqs.length} for matrix…`, 43);
  console.log(`[fsea] Pass 5: matrix=${matrixReqs.length}, discard=${p5.summary?.discarded ?? 0}, clusters=${(p5.clusters ?? []).length}`);

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, p3, p4, p5, error: 'Pipeline paused after Pass 5' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 5. Re-run to continue.' };
  }

  // ── Pass 6 — Proposal actionability (GRACEFUL DEGRADE) ───────────────────────
  await setProgress(jobId, 'Pass 6 — Determining page budget and actionability…', 46);
  const p6Result = await runLlmPass<P6Output>({
    system: PASS_6_SYSTEM,
    user: `EVALUATION ONTOLOGY:\n${trimContext(p4)}\n\n` +
      `MATRIX REQUIREMENTS:\n${trimContext(matrixReqs)}\n\n` +
      `CLUSTERS:\n${trimContext(p5.clusters)}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 6'
  });
  if (p6Result.error) {
    errors.p6 = p6Result.error;
    console.warn('[fsea] Pass 6 degraded — page budget will be absent:', p6Result.error);
  }
  const p6: P6Output = p6Result.data ?? buildFallbackP6(matrixReqs);
  passResults.p6 = !p6Result.error;

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, p3, p4, p5, p6, error: 'Pipeline paused after Pass 6' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 6. Re-run to continue.' };
  }

  // ── Pass 7 — L-to-M mapping (GRACEFUL DEGRADE) ────────────────────────────────
  await setProgress(jobId, 'Pass 7 — Mapping Section L to evaluation criteria…', 54);
  const p7Result = await runLlmPass<P7Output>({
    system: PASS_7_SYSTEM,
    user: `SOLICITATION (first 40000 chars):\n${docText.slice(0, 40000)}\n\n` +
      `EVALUATION ONTOLOGY:\n${trimContext(p4)}\n\n` +
      `MATRIX REQUIREMENTS:\n${trimContext(matrixReqs)}\n\n` +
      `ACTIONABILITY:\n${trimContext(p6.actionabilityDeterminations)}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 7'
  });
  if (p7Result.error) {
    errors.p7 = p7Result.error;
    console.warn('[fsea] Pass 7 degraded — L-to-M wiring will be absent:', p7Result.error);
  }
  const p7: P7Output = p7Result.data ?? buildFallbackP7();
  passResults.p7 = !p7Result.error;
  console.log(`[fsea] Pass 7: maps=${(p7.paragraphMaps ?? []).length}, cross-wires=${(p7.crossParagraphWires ?? []).length}`);

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, p3, p4, p5, p6, p7, error: 'Pipeline paused after Pass 7' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 7. Re-run to continue.' };
  }

  // ── Pass 8 — Strength opportunity detection (GRACEFUL DEGRADE) ───────────────
  await setProgress(jobId, 'Pass 8 — Detecting strength opportunities…', 62);
  const p8Result = await runLlmPass<P8Output>({
    system: PASS_8_SYSTEM,
    user: `EVALUATION ONTOLOGY:\n${trimContext(p4)}\n\n` +
      `L-TO-M MAPPING:\n${trimContext(p7)}\n\n` +
      `STRENGTH DEFINITION:\n${trimContext(p4.constructs)}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 8'
  });
  if (p8Result.error) {
    errors.p8 = p8Result.error;
    console.warn('[fsea] Pass 8 degraded — strength register will be absent:', p8Result.error);
  }
  const p8: P8Output = p8Result.data ?? { strengthOpportunities: [], summary: { total: 0, byParagraph: {}, top5: [] }, criticalGapAdvisory: '' };
  passResults.p8 = !p8Result.error;
  await setProgress(jobId, `Pass 8 — Identified ${(p8.strengthOpportunities ?? []).length} strength opportunities${p8Result.error ? ' (degraded)' : ''}…`, 67);
  console.log(`[fsea] Pass 8: strengths=${(p8.strengthOpportunities ?? []).length}`);

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, p3, p4, p5, p6, p7, p8, error: 'Pipeline paused after Pass 8' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 8. Re-run to continue.' };
  }

  // ── Pass 9 — Cross-reference resolution (GRACEFUL DEGRADE) ───────────────────
  await setProgress(jobId, 'Pass 9 — Resolving cross-references and citations…', 70);
  const p9Result = await runLlmPass<P9Output>({
    system: PASS_9_SYSTEM,
    user: `PASS 5 CLUSTERS:\n${trimContext(p5.clusters)}\n\n` +
      `PASS 6 CLUSTER CONSOLIDATION:\n${trimContext(p6.clusterConsolidation)}\n\n` +
      `PASS 7 CROSS-PARAGRAPH WIRES:\n${trimContext(p7.crossParagraphWires)}\n\n` +
      `PASS 8 STRENGTH OPPORTUNITIES:\n${trimContext(p8.strengthOpportunities.slice(0, 15))}\n\n` +
      `SOLICITATION (first 30000 chars):\n${docText.slice(0, 30000)}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 9'
  });
  if (p9Result.error) {
    errors.p9 = p9Result.error;
    console.warn('[fsea] Pass 9 degraded — cross-reference graph will be absent:', p9Result.error);
  }
  const p9: P9Output = p9Result.data ?? { internalCrossRefs: [], crossRefDependencyMap: '', regulatoryCitations: [], cdrlLinkages: [], solicitationAnchors: [], integrityStatus: 'Pass 9 did not complete', actionsRequired: [] };
  passResults.p9 = !p9Result.error;

  if (Date.now() > deadlineMs) {
    await writeFseaPartial({ solicitationId, companyId, p2, p3, p4, p5, p6, p7, p8, p9, error: 'Pipeline paused after Pass 9' });
    return { ok: false, error: 'Worker deadline exceeded after Pass 9. Re-run to continue.' };
  }

  // ── Pass 10 — Matrix and products generation (HARD GATE) ──────────────────────
  await setProgress(jobId, 'Pass 10 — Generating evaluation matrix and writing plan…', 80);
  const p10Result = await runLlmPass<P10Output>({
    system: PASS_10_SYSTEM,
    user: `PASS 2 — CANDIDATES:\n${trimContext(p2)}\n\n` +
      `PASS 3 — EVALUATION FACTORS:\n${trimContext(p3)}\n\n` +
      `PASS 4 — ONTOLOGY:\n${trimContext(p4)}\n\n` +
      `PASS 5 — CLASSIFIED:\n${trimContext(p5)}\n\n` +
      `PASS 6 — ACTIONABILITY:\n${trimContext(p6)}\n\n` +
      `PASS 7 — L-TO-M MAPPING:\n${trimContext(p7)}\n\n` +
      `PASS 8 — STRENGTHS:\n${trimContext(p8)}\n\n` +
      `PASS 9 — CROSS-REFERENCES:\n${trimContext(p9)}`,
    provider, model, apiKey, companyId,
    passName: 'Pass 10',
    retryOnParseFailure: true
  });
  if (p10Result.error) {
    // Save partial data so the run is not a total loss
    await writeFseaPartial({ solicitationId, companyId, p2, p3, p4, p5, p6, p7, p8, p9, error: `Pass 10 failed: ${p10Result.error}` });
    return { ok: false, error: `Pass 10 failed: ${p10Result.error}. Partial data from Passes 2-9 has been saved.` };
  }
  const p10 = p10Result.data!;
  passResults.p10 = true;

  // Inject any pass errors into the executive summary so the UI can surface them
  if (Object.keys(errors).length > 0) {
    p10.executiveSummary.criticalActions = [
      ...Object.entries(errors).map(([pass, err]) => `${pass} degraded: ${err}`),
      ...(p10.executiveSummary.criticalActions ?? [])
    ];
  }

  console.log(`[fsea] Pass 10: matrix=${(p10.sectionA ?? []).length}, SO=${(p10.sectionB ?? []).length}, WR=${(p10.sectionC ?? []).length}, AC=${(p10.sectionD ?? []).length}`);

  // ── Persist ────────────────────────────────────────────────────────────────────
  await setProgress(jobId, `Pass 10 complete — saving ${(p10.sectionA ?? []).length} requirements, ${(p10.sectionB ?? []).length} strength opportunities, ${(p10.sectionD ?? []).length} checklist items…`, 92);

  try {
    await writeFseaResults({ solicitationId, companyId, p2, p3, p4, p5, p6, p7, p8, p9, p10 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'database write failed';
    console.error('[fsea] writeFseaResults failed:', msg);
    return { ok: false, error: `Pipeline completed but save failed: ${msg}. Re-run to retry.` };
  }

  const degradedPasses = Object.keys(errors);
  const label = degradedPasses.length > 0
    ? `Pipeline complete (${degradedPasses.join(', ')} degraded) — ${p10.sectionA.length} requirements`
    : `Pipeline complete — ${p10.sectionA.length} requirements, ${p10.sectionB.length} strength opportunities`;

  await setProgress(jobId, label, 100);

  return {
    ok: true,
    matrixCount: p10.sectionA.length,
    strengthCount: p10.sectionB.length,
    adminCount: p10.sectionD.length,
    passResults
  };
}

// ── Fallback constructors for graceful degradation ─────────────────────────────

function buildFallbackOntology(p3: P3Output): P4Output {
  return {
    evaluationStrategy: {
      type: p3.evaluationStrategy,
      dominantFactor: p3.factors[0]?.name ?? 'Technical',
      priceRole: 'Secondary',
      interchangeIntent: p3.interchangeIntent ?? '',
      awardQuantity: '1',
      setAside: null
    },
    factors: p3.factors.map((f, i) => ({ id: `F${i + 1}`, name: f.name, orderOfImportance: f.orderOfImportance, ratingMethod: f.ratingMethod })),
    criteria: [],
    evaluationSurface: [],
    constructs: p3.constructDefinitions ?? [],
    strengthOpportunities: p3.strengthSignals.map((s, i) => ({
      id: `SO-0${i + 1}`,
      signal: s.term,
      source: s.location,
      targetParagraphs: [],
      type: 'general'
    })),
    weaknessRisks: [],
    adminCompliance: [],
    deliverables: [],
    relationships: []
  };
}

function buildFallbackP6(matrixReqs: { reqId: string; sectionId: string }[]): P6Output {
  return {
    actionabilityDeterminations: matrixReqs.map(r => ({
      reqId: r.reqId,
      paragraphId: r.sectionId,
      responseRequired: true,
      strengthensRating: false,
      strengthLevel: null,
      risksWeakness: false,
      pageSignal: 'Medium',
      notes: ''
    })),
    pageBudget: [],
    strengthTargetList: [],
    clusterConsolidation: [],
    guardRails: []
  };
}

function buildFallbackP7(): P7Output {
  return {
    mappingArchitecture: '',
    paragraphMaps: [],
    crossParagraphWires: [],
    narrativePriorityStack: [],
    wiringIntegrityStatus: 'Pass 7 did not complete'
  };
}
