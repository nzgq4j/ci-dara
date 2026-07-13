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
import { parseHrlrNodes, buildSourceIndex, locateSpan } from '@/utils/dara/hrlr/parse';
import { resolveGraph } from '@/utils/dara/hrlr/resolve';
import type { RequirementNode } from '@/utils/dara/hrlr/types';
import { asParseResult, joinParagraphs, type ParseResult } from '@/utils/dara/parse-result';

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
 * HRLR-shred a solicitation's RFP documents into a requirement graph via one whole-document AI call.
 * `deadlineMs`/`jobId` are accepted for the worker's call signature; the shred is one-shot and
 * reports `exhausted: true`. Runs only into an EMPTY matrix — if the solicitation already has
 * (non-removed) requirements it no-ops, so user edits and prior graphs are never clobbered.
 */
export async function shredRequirements(
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
    (d) => d.docType === 'rfp' && d.extractionStatus === 'complete'
  );
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

  // Decrypt the RFP documents; keep them individually so provenance can be anchored to a specific
  // document, and concatenate (structure preserved) for the whole-document model call. Collect the
  // ParseResults actually used so the prompt can add a structural pre-analysis preamble.
  const structuredResults: ParseResult[] = [];
  const rfpDocs: { id: bigint; name: string; text: string }[] = rfpDocRows
    .map((d) => {
      const flat = decryptField(d.extractedText);
      const pr = parseByDoc.get(d.id.toString());
      const structured = pr ? joinParagraphs(pr) : '';
      if (pr && structured.trim() !== '') {
        structuredResults.push(pr);
        return { id: d.id, name: d.originalFilename, text: structured };
      }
      return { id: d.id, name: d.originalFilename, text: flat };
    })
    .filter((d) => d.text.trim() !== '');

  if (rfpDocs.length === 0) {
    return {
      ok: false,
      count: 0,
      error: 'No extracted RFP text. Upload the solicitation (RFP) documents on the Documents tab and wait for extraction.'
    };
  }

  let solText = rfpDocs.map((d) => `=== DOCUMENT: ${d.name} ===\n\n${d.text}`).join('\n\n');
  if (solText.length > MAX_INPUT_CHARS) {
    solText = solText.slice(0, MAX_INPUT_CHARS) + '\n\n[Solicitation truncated to fit context limit]';
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

  // One whole-document HRLR call — the slow network hop, OUTSIDE any transaction. When any RFP doc
  // came from the Modal parser, the prompt gains a structural pre-analysis preamble (hint only; the
  // output schema and HRLR rules are unchanged).
  const { system, user } = buildHrlrPrompt(
    solText,
    'solicitation',
    structuredResults.length ? structuredResults : undefined
  );
  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, SHRED_MAX_TOKENS);
  } catch (e) {
    await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
    return { ok: false, count: 0, error: e instanceof Error ? e.message : 'AI request failed.' };
  }
  await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut });

  // Parse (verifying provenance against the whole corpus) and resolve the graph (identities,
  // tree repair, satisfaction sanity, numbering-conflict detection).
  const nodes = parseHrlrNodes(ai.text, solText, loaded.solicitation.title ?? 'solicitation', 'solicitation');
  if (nodes.length === 0) return { ok: false, count: 0, error: 'The AI returned no parseable requirements.' };
  const graph = resolveGraph(nodes, 'solicitation', loaded.solicitation.title ?? 'solicitation', solText);

  const capped = graph.nodes.slice(0, MAX_REQUIREMENTS);

  // Anchor each node's verbatim text to a SPECIFIC source document (per-doc offsets), independent of
  // the concatenated corpus offsets used for the corpus-level verification.
  const docIndexes = rfpDocs.map((d) => ({ id: d.id, idx: buildSourceIndex(d.text) }));
  const anchorOf = (exactText: string): { documentId: bigint; start: number; end: number } | null => {
    for (const { id, idx } of docIndexes) {
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
    const anchor = anchorOf(n.exactText);
    const citation = (n.provenance.originalMarker || '').slice(0, 200);
    const far = citation.match(CLAUSE_NUM);
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
