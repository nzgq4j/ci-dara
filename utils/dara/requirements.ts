// Compliance-matrix engine — HRLR shred (Hierarchical Requirement Logic Resolution).
//
// The entire solicitation is sent to the model in ONE call, which returns a requirement GRAPH:
// typed nodes (STANDALONE / PARENT_WITH_CHILDREN / CHILD / PARENT_AND_CHILD / UNRESOLVED) with
// reconstructed parent/child links, Boolean/cardinality satisfaction rules, evaluation scope, and
// EXACT source provenance. Three identities are kept separate (HRLR doctrine): the document's own
// number is evidence (`citation` + hrlr.originalMarker), the row's BigInt id is the stable logical
// identity, and `hrlr.syntheticPath` is the derived display path. Provenance is verified verbatim
// against the source; a node whose text can't be found is FLAGGED, never silently dropped.
//
// This replaces the earlier flat whole-document list. The pure HRLR core lives in ./hrlr/* and is
// deliberately app-free so it can be developed/tested standalone; here we bind it to the DB.

import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { logUsage } from '@/utils/dara/usage';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';
import { buildHrlrPrompt } from '@/utils/dara/hrlr/prompt';
import { parseHrlrNodes, buildSourceIndex, locateSpan, stripFences } from '@/utils/dara/hrlr/parse';
import { resolveGraph } from '@/utils/dara/hrlr/resolve';
import type { RequirementNode } from '@/utils/dara/hrlr/types';
import { asParseResult, joinParagraphs, type ParseResult } from '@/utils/dara/parse-result';
import { buildCandidates } from '@/utils/dara/extraction/candidate-builder';
import { classifyCandidates } from '@/utils/dara/extraction/classify-prompt';
import { annotateConditionals } from '@/utils/dara/extraction/conditional-annotator';
import { verifyAgainstParseResult } from '@/utils/dara/extraction/verifier';
import { traverseIbr } from '@/utils/dara/extraction/ibr-traversal';
import { verifiedToExtracted, persistRequirements } from '@/utils/dara/extraction/persist';
import type { ExtractedRequirement } from '@/utils/dara/extraction/types';

// Output budget for the whole graph in one generation. Anthropic caps far above this; a dense RFP
// of ~150 requirement nodes is well under.
const SHRED_MAX_TOKENS = 32000;

// Sanity cap on the concatenated solicitation (~125k tokens) so a pathological upload can't blow the
// context window. Typical solicitations are a fraction of this.
const MAX_INPUT_CHARS = 500_000;

// Absolute backstop on total requirement nodes per solicitation.
const MAX_REQUIREMENTS = 800;

// Clause-number extractor for farReference (e.g. "252.204-7012" out of a citation).
const CLAUSE_NUM = /\b(\d{2,3}\.\d{3}(?:-\d{1,4})?)\b/;

// A citation that is actually a Modal parser handle leaking through the structured preamble
// (`cand-sent-para-p1-1`, `trigger-…`, `t1`/`table-…`). These are internal IDs, never a real document
// marker — reject them so they don't pollute the matrix `citation` column (see SESSION_HANDOFF §0 D5).
const PARSER_HANDLE = /^\[?(?:cand[-_]|trigger[-_]|table[-_]|t\d+$)/i;

// Normalize source text so PDF/DOCX typography artifacts don't cause false verbatim-verification misses
// (the residual ~99/278 verbatimVerified=false class): NFKC folds ligatures/compatibility forms, and we
// strip zero-width joiners/spaces, the soft hyphen, and the BOM. Deliberately conservative — it does NOT
// alter letters, case, spacing, or single characters (no single-uppercase-letter stripping, which would
// eat legitimate tokens like "Section A" / "Part B" / "Exhibit C").
const ZERO_WIDTH = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0xfeff]); // soft hyphen · ZWSP · ZWNJ · ZWJ · BOM
// Soft-hyphen line-break de-hyphenation, mirroring modal/app.py clean_extracted_text: rejoin
// "com<shy>\npliance" -> "compliance" so the source matches the LLM's joined output (a bare strip
// would leave the newline -> "com pliance" and still mismatch). The Modal structured path is already
// cleaned at source; this covers the flat unpdf/mammoth fallback path.
const SOFT_HYPHEN_BREAK = new RegExp(String.fromCharCode(0x00ad) + '[ \\t]*\\n?[ \\t]*', 'g');
function cleanSourceText(s: string): string {
  const rejoined = s.normalize('NFKC').replace(SOFT_HYPHEN_BREAK, '');
  let out = '';
  for (const ch of rejoined) if (!ZERO_WIDTH.has(ch.codePointAt(0)!)) out += ch;
  return out;
}

// Parse-QA review state for a freshly-shredded node. Only nodes the pipeline could not confidently
// read are `flagged` (need a human look); a verbatim-verified node with no flags, no fragment signal,
// and non-LOW confidence is `approved` — so a leftover `pending` row means the shred never classified
// it (pre-fix / manually-added), NOT that it was reviewed.
function deriveReviewStatus(n: RequirementNode): 'approved' | 'flagged' {
  if (!n.provenance.verbatimVerified) return 'flagged';
  if (n.flags && n.flags.length > 0) return 'flagged';
  if (n.fragmentStatus) return 'flagged';
  if (n.confidence === 'LOW') return 'flagged';
  return 'approved';
}

// The model emits `governing_factors` (Section M markers an L instruction / SOW task feeds) but the
// pure HRLR node type (utils/dara/hrlr/types.ts) does not carry it, so read it straight off the raw
// JSON, keyed by the node's `key`. Best-effort: on a truncated/salvaged response we simply get no
// links for this run (an optional enrichment, never a hard dependency).
function extractGoverningByKey(modelText: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    const data = JSON.parse(stripFences(modelText));
    const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.nodes) ? data.nodes : [];
    for (const n of arr) {
      const key = String(n?.key ?? '').trim();
      if (!key) continue;
      const gf = Array.isArray(n?.governing_factors)
        ? n.governing_factors.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12)
        : [];
      if (gf.length) out.set(key, Array.from(new Set(gf)));
    }
  } catch {
    /* truncated JSON → no governance links this run */
  }
  return out;
}

export interface ShredSummary {
  ok: boolean;
  count: number;
  // Always true — the HRLR shred completes in a single call. Kept so the worker dispatch
  // (which reads `exhausted`) marks the job done in one tick.
  exhausted?: boolean;
  error?: string;
  // Count of source markers present in the document that produced no extracted node (coverage-gap
  // detector). Surfaced so the caller/worker can see a dropped-requirement signal; 0 on a clean run.
  coverageGaps?: number;
}

interface DocRow {
  id: bigint;
  originalFilename: string;
  extractedText: string | null;
  extractionStatus: string;
  docType: string;
  documentRole: string | null;
}

// Document roles that feed the shred. Only rfp_base and pws_sow contain Section L/M instructions
// and PWS performance obligations. Section J attachments, templates, wage determinations, and other
// supporting material are reference-only and must never be shredded into the compliance matrix.
const SHRED_ELIGIBLE_ROLES = new Set(['rfp_base', 'pws_sow']);

/**
 * Whether a solDoc should be included in the shred.
 * - If the document has an assigned role, it must be rfp_base or pws_sow.
 * - If the document has NO role (legacy rows uploaded before the role feature), it is included as
 *   before so existing solicitations are not silently broken.
 */
function isShredEligible(doc: DocRow): boolean {
  if (!doc.documentRole) return true; // legacy: no role assigned, preserve prior behaviour
  return SHRED_ELIGIBLE_ROLES.has(doc.documentRole);
}

function shortName(n: RequirementNode): string {
  const src = (n.normalizedMeaning || n.exactText).replace(/\s+/g, ' ').trim();
  const words = src.split(' ').slice(0, 12).join(' ');
  return (words || n.key).slice(0, 300);
}

function compositionFor(state: RequirementNode['state']): 'atomic' | 'compound' | 'unclassified' {
  if (state === 'PARENT_WITH_CHILDREN' || state === 'PARENT_AND_CHILD') return 'compound';
  if (state === 'UNRESOLVED') return 'unclassified';
  return 'atomic';
}

/**
 * Shred a solicitation's RFP documents into the compliance matrix.
 *
 * Dispatch: when EVERY rfp document has a current `dara_parse_results` row, run the deterministic
 * three-pass pipeline (Pass 1 obligation extraction from the parse output → temperature=0 LLM classify
 * → Pass 2 conditional annotation → verbatim verification → Pass 3 IbR traversal against the clause
 * library). When no parse results exist, fall back to the legacy whole-document HRLR shred unchanged.
 * (Docs missing a parse row while others have one are skipped with a warning — re-parse them.)
 *
 * One-shot (`exhausted:true`). Runs only into an EMPTY matrix — no-ops if the solicitation already has
 * (non-removed) requirements, so user edits / prior graphs are never clobbered.
 */
export async function shredRequirements(
  solicitationId: bigint,
  companyId: bigint,
  deadlineMs = Infinity,
  jobId?: bigint
): Promise<ShredSummary> {
  const loaded = await withTenant(companyId, async (tx) => {
    const solicitation = await tx.solicitation.findFirst({
      where: { id: solicitationId, companyId },
      include: { solDocs: true }
    });
    if (!solicitation) return null;
    const company = await tx.company.findUnique({ where: { id: companyId } });
    const existingCount = await tx.requirement.count({ where: { solicitationId, companyId, removedAt: null } });
    return { solicitation, company, existingCount };
  });
  if (!loaded?.solicitation) return { ok: false, count: 0, error: 'Solicitation not found.' };
  if (!loaded.company) return { ok: false, count: 0, error: 'Company not found.' };
  // No-clobber guard: a populated matrix means a re-trigger; regeneration must clear first.
  if (loaded.existingCount > 0) return { ok: true, count: 0, exhausted: true };

  const rfpDocRows = (loaded.solicitation.solDocs as DocRow[]).filter(
    (d) => d.docType === 'rfp' && d.extractionStatus === 'complete' && isShredEligible(d)
  );
  const skippedRoles = (loaded.solicitation.solDocs as DocRow[])
    .filter((d) => d.docType === 'rfp' && d.extractionStatus === 'complete' && !isShredEligible(d))
    .map((d) => `${d.originalFilename} [${d.documentRole}]`);
  if (skippedRoles.length) {
    console.log(`[shred] skipping ${skippedRoles.length} ineligible document(s): ${skippedRoles.join(', ')}`);
  }
  if (rfpDocRows.length === 0) {
    return { ok: false, count: 0, error: 'No shred-eligible documents found. Upload the base RFP (role: Base RFP) or PWS/SOW (role: PWS / SOW) and wait for extraction. Section J attachments and supporting documents are not shredded.' };
  }

  // Load the current parse result for each rfp doc.
  const parseByDoc = new Map<string, ParseResult>();
  const rfpDocIds = rfpDocRows.map((d) => d.id);
  try {
    const parseRows = await withTenant(companyId, (tx) =>
      tx.daraParseResult.findMany({
        where: { solDocId: { in: rfpDocIds }, companyId, supersededAt: null },
        orderBy: { createdAt: 'desc' },
        select: { solDocId: true, result: true }
      })
    );
    for (const row of parseRows) {
      const key = row.solDocId.toString();
      if (parseByDoc.has(key)) continue;
      const pr = asParseResult(row.result);
      if (pr) parseByDoc.set(key, pr);
    }
  } catch (e) {
    console.warn('[shred] parse-result lookup failed; using legacy HRLR shred', e);
  }

  // No structured parse output anywhere → legacy path unchanged.
  if (parseByDoc.size === 0) return legacyHrlrShred(solicitationId, companyId, deadlineMs, jobId);

  // Resolve the AI config for the temperature=0 classify pass.
  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(loaded.company, platform),
    'shred',
    loaded.company,
    platform,
    await getCapabilityOverrides()
  );
  if (!apiKey) return { ok: false, count: 0, error: `No API key configured for provider "${provider}".` };

  const ctx = { provider, model, apiKey, companyId };
  const asOf = loaded.solicitation.createdAt ?? new Date();
  const allRows: ExtractedRequirement[] = [];
  const skipped: string[] = [];

  for (const doc of rfpDocRows) {
    const pr = parseByDoc.get(doc.id.toString());
    if (!pr) {
      skipped.push(doc.originalFilename);
      continue;
    }
    // Pass 1 → classify → Pass 2 → verify.
    const candidates = buildCandidates(pr);
    const classified = await classifyCandidates(candidates, ctx);
    const annotated = annotateConditionals(classified, pr);
    const verified = verifyAgainstParseResult(annotated, pr);
    const base = verified
      .filter((v) => v.classification.isRequirement)
      .map((v) => ({ ...verifiedToExtracted(v), documentId: doc.id }));
    // Pass 3 — IbR traversal against the clause library (deterministic).
    const ibr = (await traverseIbr(pr, asOf)).map((r) => ({ ...r, documentId: doc.id }));
    allRows.push(...base, ...ibr);
  }

  if (skipped.length) {
    console.warn(`[shred] ${skipped.length} rfp doc(s) skipped (no parse result; re-parse to include): ${skipped.join(', ')}`);
  }

  if (allRows.length === 0) return { ok: true, count: 0, exhausted: true };

  const { count } = await persistRequirements(allRows, solicitationId, companyId);
  return { ok: true, count, exhausted: true };
}

/**
 * LEGACY HRLR shred — one whole-document AI call that reconstructs a requirement graph. Retained as the
 * fallback for documents with NO structured `dara_parse_results` row (the multipass pipeline needs the
 * Modal parse output). Reached via `shredRequirements` below when no parse results exist.
 * `deadlineMs`/`jobId` are accepted for the worker's call signature; one-shot, reports `exhausted:true`.
 * Runs only into an EMPTY matrix — no-ops if the solicitation already has (non-removed) requirements.
 */
async function legacyHrlrShred(
  solicitationId: bigint,
  companyId: bigint,
  _deadlineMs = Infinity,
  _jobId?: bigint
): Promise<ShredSummary> {
  // Burst A: load docs + company + existing count + current ordering.
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
    const existingCount = await tx.requirement.count({
      where: { solicitationId, companyId, removedAt: null }
    });
    return { solicitation, company, nextOrder: (agg._max.sortOrder ?? -1) + 1, existingCount };
  });

  if (!loaded?.solicitation) return { ok: false, count: 0, error: 'Solicitation not found.' };
  if (!loaded.company) return { ok: false, count: 0, error: 'Company not found.' };

  // The HRLR shred rebuilds a whole graph; it must not merge into an existing one. If the matrix is
  // already populated, no-op (regeneration = clear the matrix first, a deliberate user action).
  if (loaded.existingCount > 0) return { ok: true, count: 0, exhausted: true };

  // Structured-input path (Modal parser): for each RFP doc, prefer the CURRENT (non-superseded)
  // ParseResult's reconstructed paragraph text — richer, table-aware input — over flat unpdf/mammoth
  // text. Documents uploaded before this feature (or where Modal was unavailable) have no parse row
  // and fall back to the flat extracted text, so the shred behaves EXACTLY as before for them. The
  // lookup is isolated in its own try/catch: if the parse table is unreadable for any reason, the
  // shred degrades to flat text rather than failing (fallback is guaranteed).
  const rfpDocRows = (loaded.solicitation.solDocs as DocRow[]).filter(
    (d) => d.docType === 'rfp' && d.extractionStatus === 'complete' && isShredEligible(d)
  );
  const legacySkippedRoles = (loaded.solicitation.solDocs as DocRow[])
    .filter((d) => d.docType === 'rfp' && d.extractionStatus === 'complete' && !isShredEligible(d))
    .map((d) => `${d.originalFilename} [${d.documentRole}]`);
  if (legacySkippedRoles.length) {
    console.log(`[shred/legacy] skipping ${legacySkippedRoles.length} ineligible document(s): ${legacySkippedRoles.join(', ')}`);
  }
  const parseByDoc = new Map<string, ParseResult>();
  const rfpDocIds = rfpDocRows.map((d) => d.id);
  if (rfpDocIds.length > 0) {
    try {
      const parseRows = await withTenant(companyId, (tx) =>
        tx.daraParseResult.findMany({
          where: { solDocId: { in: rfpDocIds }, companyId, supersededAt: null },
          orderBy: { createdAt: 'desc' },
          select: { solDocId: true, result: true }
        })
      );
      for (const row of parseRows) {
        const key = row.solDocId.toString();
        if (parseByDoc.has(key)) continue; // keep the newest (rows are createdAt desc)
        const pr = asParseResult(row.result);
        if (pr) parseByDoc.set(key, pr);
      }
    } catch (e) {
      console.warn('[shred] parse-result lookup failed; using flat text extraction', e);
    }
  }

  // Decrypt the RFP documents; keep them individually so each gets a role-aware prompt and
  // provenance can be anchored per-document. Collect ParseResults for each doc separately.
  const rfpDocs: { id: bigint; name: string; text: string; role: string | null; pr: ParseResult | undefined }[] = rfpDocRows
    .map((d) => {
      const flat = decryptField(d.extractedText);
      const pr = parseByDoc.get(d.id.toString());
      const structured = pr ? joinParagraphs(pr) : '';
      const text = pr && structured.trim() !== '' ? cleanSourceText(structured) : cleanSourceText(flat);
      return { id: d.id, name: d.originalFilename, text, role: d.documentRole, pr };
    })
    .filter((d) => d.text.trim() !== '');

  if (rfpDocs.length === 0) {
    return {
      ok: false,
      count: 0,
      error: 'No shred-eligible documents found. Upload the base RFP (role: Base RFP) or PWS/SOW (role: PWS / SOW) and wait for extraction. Section J attachments and supporting documents are not shredded.'
    };
  }

  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = applyCapabilityOverride(
    resolveCompanyAI(loaded.company, platform),
    'shred',
    loaded.company,
    platform,
    await getCapabilityOverrides()
  );
  if (!apiKey) return { ok: false, count: 0, error: `No API key configured for provider "${provider}".` };

  // Per-document HRLR calls — each document gets its role-aware prompt so rfp_base targets
  // Section L/M and pws_sow targets performance obligations. The corpus assembled per-doc for
  // span-anchoring uses the same text passed to the prompt.
  const allNodes: RequirementNode[] = [];
  const allGovByKey = new Map<string, string[]>();
  const docIndexes: { id: bigint; idx: ReturnType<typeof buildSourceIndex> }[] = [];

  for (const doc of rfpDocs) {
    let docText = doc.text;
    if (docText.length > MAX_INPUT_CHARS) {
      docText = docText.slice(0, MAX_INPUT_CHARS) + '\n\n[Document truncated to fit context limit]';
    }
    const structuredArr = doc.pr ? [doc.pr] : undefined;
    const { system, user } = buildHrlrPrompt(docText, 'solicitation', structuredArr, doc.role ?? undefined);
    let ai;
    try {
      ai = await complete(provider, system, user, model, apiKey, SHRED_MAX_TOKENS);
    } catch (e) {
      await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
      console.warn(`[shred/legacy] doc "${doc.name}" failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut });

    const docLabel = `${doc.name}${doc.role ? ` [${doc.role}]` : ''}`;
    const nodes = parseHrlrNodes(ai.text, docText, docLabel, 'solicitation');
    const graph = resolveGraph(nodes, 'solicitation', docLabel, docText);
    const govByKey = extractGoverningByKey(ai.text);
    for (const [k, v] of govByKey) allGovByKey.set(k, v);

    // Tag each node with its source document id so anchorOf below resolves correctly.
    for (const n of graph.nodes) (n as any)._sourceDocId = doc.id;

    allNodes.push(...graph.nodes);
    docIndexes.push({ id: doc.id, idx: buildSourceIndex(docText) });
  }

  if (allNodes.length === 0) return { ok: false, count: 0, error: 'The AI returned no parseable requirements.' };

  // Honour the per-solicitation cap across all documents combined.
  const capped = allNodes.slice(0, MAX_REQUIREMENTS);
  // govByKey is already merged above.
  const govByKey = allGovByKey;

  // Anchor each node's verbatim text to a SPECIFIC source document. The per-doc call tagged each node
  // with _sourceDocId; use that first, then fall back to a full scan across all doc indexes.
  const anchorOf = (
    exactText: string,
    preferDocId?: bigint
  ): { documentId: bigint; start: number; end: number } | null => {
    const ordered = preferDocId
      ? [docIndexes.find((d) => d.id === preferDocId), ...docIndexes.filter((d) => d.id !== preferDocId)].filter(Boolean) as typeof docIndexes
      : docIndexes;
    for (const { id, idx } of ordered) {
      const s = locateSpan(idx, exactText);
      if (s) return { documentId: id, start: s.start, end: s.end };
    }
    return null;
  };

  // Index nodes by their model key so we can resolve parent links to sort positions after insert.
  const nodeIndexByKey = new Map<string, number>();
  capped.forEach((n, i) => nodeIndexByKey.set(n.key, i));

  const base = loaded.nextOrder;
  const childCounter = new Map<string, number>(); // parentKey -> next childOrder

  // Build the insert rows (parentId is set in a second pass once ids exist).
  const rows = capped.map((n, i) => {
    const isParent = n.state === 'PARENT_WITH_CHILDREN' || n.state === 'PARENT_AND_CHILD';
    const anchor = anchorOf(n.exactText, (n as any)._sourceDocId as bigint | undefined);
    // Reject a Modal parser handle that leaked into source_marker (D5) — treat as no marker.
    const rawMarker = (n.provenance.originalMarker || '').trim();
    const citation = PARSER_HANDLE.test(rawMarker) ? '' : rawMarker.slice(0, 200);
    const far = citation.match(CLAUSE_NUM);
    // Governance links belong on L instructions / SOW tasks, not on the M factors themselves.
    const governingFactors = n.source === 'evaluation_factor' ? [] : (govByKey.get(n.key) ?? []);
    return {
      companyId,
      solicitationId,
      name: shortName(n),
      description: n.exactText || n.normalizedMeaning || null,
      source: n.source,
      isScored: n.disposition === 'scored',
      disposition: n.disposition,
      farReference: far ? far[1] : '',
      citation,
      citationSynthesized: citation === '',
      weight: 0,
      // Parse-QA review state — approved when verbatim-verified/clean, flagged when the pipeline is
      // unsure it read the node correctly.
      reviewStatus: deriveReviewStatus(n),
      // L→M linkage: Section M factor markers this instruction/task is evaluated under.
      governingFactors,
      // Containers/parents are a rollup, not a directly-graded unit — keep them OUT of the compliance
      // sweep (which grades disposition='compliance' + status='not_assessed'). Leaves grade normally.
      complianceStatus: isParent
        ? ('not_applicable' as const)
        : n.disposition === 'administrative'
          ? ('not_applicable' as const)
          : ('not_assessed' as const),
      // Structured HRLR columns.
      documentId: anchor?.documentId ?? null,
      spanStart: anchor?.start ?? null,
      spanEnd: anchor?.end ?? null,
      composition: compositionFor(n.state),
      obligationCount: null,
      enumeratorCount: n.childKeys.length || null,
      rollupMode: n.satisfaction.kind === 'NONE' ? null : n.satisfaction.kind.slice(0, 30),
      decompositionSource: 'hrlr',
      // The semantic bundle.
      hrlr: {
        logicalId: n.logicalId,
        key: n.key,
        state: n.state,
        syntheticPath: n.syntheticPath,
        normalizedMeaning: n.normalizedMeaning,
        sectionPath: n.provenance.sectionPath,
        originalMarker: n.provenance.originalMarker,
        page: n.provenance.page,
        mandatory: n.mandatory,
        satisfaction: n.satisfaction,
        evalScope: n.evalScope,
        applicability: n.applicability,
        confidence: n.confidence,
        confidenceRationale: n.confidenceRationale,
        verbatimVerified: n.provenance.verbatimVerified,
        flags: n.flags,
        // Same-marker fragment flags (undefined -> dropped from the JSON) so a reviewer can act later.
        fragmentStatus: n.fragmentStatus,
        fragmentReason: n.fragmentReason,
        fragmentMergeCandidate: n.fragmentMergeCandidate
      } as unknown as object,
      sortOrder: base + i
    };
  });

  // Burst B: insert the nodes, then wire parent links (parentId references generated ids, so it needs
  // a second pass — we correlate by sortOrder).
  const written = await withTenant(companyId, async (tx) => {
    await tx.requirement.createMany({ data: rows });
    const inserted = await tx.requirement.findMany({
      where: { solicitationId, companyId, sortOrder: { gte: base } },
      select: { id: true, sortOrder: true }
    });
    const idBySort = new Map(inserted.map((r) => [r.sortOrder, r.id] as const));

    for (let i = 0; i < capped.length; i++) {
      const n = capped[i];
      if (!n.parentKey) continue;
      const parentIdx = nodeIndexByKey.get(n.parentKey);
      if (parentIdx === undefined) continue;
      const childId = idBySort.get(base + i);
      const parentId = idBySort.get(base + parentIdx);
      if (!childId || !parentId) continue;
      const order = childCounter.get(n.parentKey) ?? 0;
      childCounter.set(n.parentKey, order + 1);
      await tx.requirement.update({
        where: { id: childId },
        data: { parentId, childOrder: order }
      });
    }
    return inserted.length;
  });

  return { ok: true, count: written, exhausted: true, coverageGaps: graph.coverageGaps.length };
}
