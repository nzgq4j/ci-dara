// Compliance-matrix engine — SPAN-ANCHORED extraction. A requirement's identity is a VERIFIED
// character range in a source document (documentId, spanStart, spanEnd), not an LLM-generated
// name. Duplication + hallucination are solved structurally: verifySpan rejects any quote that
// isn't verbatim in the source, and a partial unique index makes a re-extracted span a no-op.
//
// The shred windows each RFP document, extracts verbatim-quoted obligations per window (bounded
// parallelism), anchors each quote to a raw offset, ACCUMULATES verified spans in the JobQueue
// payload across worker ticks, and — only when the last window of the last document completes —
// stitches edge-split fragments, merges overlap-duplicates, and writes the matrix once.
// Window-index resumption (persisted in the payload) survives the 300s worker budget; failed
// windows are reported, not silently dropped.

import { Prisma } from '@prisma/client';
import { withTenant, prismaAdmin } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildExtractPrompt, parseExtract } from '@/utils/dara/extract-prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { logUsage } from '@/utils/dara/usage';
import { applyCapabilityOverride, getCapabilityOverrides } from '@/utils/dara/capability-model';
import type { RequirementSourceValue, RequirementDispositionValue } from '@/utils/dara/prompt';
import {
  windowize,
  verifySpan,
  stitchFragments,
  mergeSpans,
  deriveCitation,
  clauseReference,
  classifyComposition,
  findEnumerators,
  type Span
} from '@/utils/dara/spans';

// Output cap per WINDOW extraction call. A ~12k-char window yields at most a few dozen short
// verbatim quotes → well under this; parseExtract salvages a truncated array either way. Kept far
// below the 240s provider timeout by construction (small windows, small output).
const EXTRACT_MAX_TOKENS = 4000;

// Absolute backstop on total requirements per solicitation (unchanged from the old shred).
const MAX_REQUIREMENTS = 500;

// Bounded parallelism: windows per round.
const ROUND_SIZE = 4;
// Don't START a round unless this much budget remains — enough for a slow round plus the
// end-of-run merge/write. A pathological full-240s hang mid-round is NOT prevented here; it is
// recovered via reapOrphanedJobs → cursor resumption → skipDuplicates (re-extraction is a no-op),
// which is cheaper than starving throughput by reserving the whole 240s timeout every round.
const ROUND_RESERVE_MS = 130_000;

// Write a progress label to the owning JobQueue row (fire-and-forget; a failed label write must
// never abort the shred).
async function setShredLabel(jobId: bigint | undefined, label: string): Promise<void> {
  if (!jobId) return;
  try {
    await prismaAdmin.jobQueue.update({ where: { id: jobId }, data: { progressLabel: label } });
  } catch {
    /* non-fatal */
  }
}

export interface ShredSummary {
  ok: boolean;
  count: number;
  // True when every window of every document has been processed and the matrix has been written.
  // The worker requeues the shred while this is false so a dense RFP finishes across ticks.
  exhausted?: boolean;
  // Observability (populated on the final, writing tick). Global window indices whose LLM call
  // failed, and the number of source chars covered ONLY by failed windows (never analyzed).
  failedWindows?: number[];
  missedChars?: number;
  // Quotes the model returned that could not be verbatim-anchored (the hallucination gate firing).
  rejected?: number;
  error?: string;
}

// A verified span accumulated in the JobQueue payload. JSON-safe (documentId is a string; no
// bigint). Extends Span (+ truncated) so stitchFragments and mergeSpans operate on it directly.
interface AccumSpan extends Span {
  documentId: string;
  truncated: boolean;
  name: string;
  source: RequirementSourceValue;
  disposition: RequirementDispositionValue;
  isScored: boolean;
  obligationCount: number;
  weight: number;
}

// Resumption cursor persisted under payload.cursor across worker ticks.
interface ShredCursor {
  gIndex: number;       // next global window index to process
  spans: AccumSpan[];   // verified spans accumulated so far
  failed: number[];     // global window indices whose LLM call failed
  rejected: number;     // running count of hallucination-gate rejections
}

interface DocFile {
  id: bigint;
  extractedText: string | null;
  extractionStatus: string;
  docType: string;
}

// One flattened window across all documents (deterministic given the doc set + text).
interface FlatWindow {
  gIndex: number;
  documentId: bigint;
  docText: string;
  start: number;
  end: number;
}

/** Extract one window: build prompt → complete → log usage → parse → verbatim-anchor each quote
 *  to a document-absolute span. Returns ok:false only when the LLM call itself failed. */
async function extractWindow(
  w: FlatWindow,
  provider: string,
  model: string,
  apiKey: string,
  companyId: bigint
): Promise<{ ok: boolean; spans: AccumSpan[]; rejected: number }> {
  const windowText = w.docText.slice(w.start, w.end);
  const { system, user } = buildExtractPrompt(windowText);
  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, EXTRACT_MAX_TOKENS);
  } catch {
    await logUsage({ capability: 'shred', provider, model, companyId, ok: false });
    return { ok: false, spans: [], rejected: 0 };
  }
  await logUsage({ capability: 'shred', provider, model, companyId, tokenIn: ai.tokenIn, tokenOut: ai.tokenOut });

  const spans: AccumSpan[] = [];
  let rejected = 0;
  for (const it of parseExtract(ai.text)) {
    const anchor = verifySpan(windowText, it.quote); // window-scoped → local offsets
    if (!anchor) { rejected++; continue; }           // hallucination gate: not verbatim → drop
    spans.push({
      documentId: w.documentId.toString(),
      start: w.start + anchor.start, // → document-absolute
      end: w.start + anchor.end,
      truncated: it.truncated,
      name: it.name,
      source: it.source,
      disposition: it.disposition,
      isScored: it.isScored,
      obligationCount: it.obligationCount,
      weight: it.weight
    });
  }
  return { ok: true, spans, rejected };
}

// Chars covered ONLY by a failed window (never by a successful one), per document — an exact
// interval-difference over the (few) window ranges. Reports how much of the source went
// un-analyzed when some windows' LLM calls failed.
function computeMissedChars(flat: FlatWindow[], failed: number[]): number {
  if (failed.length === 0) return 0;
  const failedSet = new Set(failed);
  const byDoc = new Map<string, { bad: [number, number][]; ok: [number, number][] }>();
  for (const w of flat) {
    const key = w.documentId.toString();
    const g = byDoc.get(key) ?? { bad: [], ok: [] };
    (failedSet.has(w.gIndex) ? g.bad : g.ok).push([w.start, w.end]);
    byDoc.set(key, g);
  }
  let missed = 0;
  for (const { bad, ok } of Array.from(byDoc.values())) {
    const pts = Array.from(new Set([...bad, ...ok].flat())).sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = pts[i], hi = pts[i + 1];
      if (hi <= lo) continue;
      const covBad = bad.some(([a, b]) => a <= lo && b >= hi);
      const covOk = ok.some(([a, b]) => a <= lo && b >= hi);
      if (covBad && !covOk) missed += hi - lo;
    }
  }
  return missed;
}

/**
 * Shred a solicitation's RFP documents into span-anchored requirements. Resumable across worker
 * ticks via a cursor persisted in the JobQueue payload; writes the matrix ONCE when exhausted.
 */
export async function shredRequirements(
  solicitationId: bigint,
  companyId: bigint,
  deadlineMs = Infinity,
  jobId?: bigint
): Promise<ShredSummary> {
  // Burst A: load docs + AI config + current ordering/count.
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
    const existingCount = await tx.requirement.count({ where: { solicitationId, companyId } });
    return {
      solicitation,
      company,
      nextOrder: (agg._max.sortOrder ?? -1) + 1,
      existingCount
    };
  });

  if (!loaded?.solicitation) return { ok: false, count: 0, error: 'Solicitation not found.' };
  if (!loaded.company) return { ok: false, count: 0, error: 'Company not found.' };

  // Decrypt each RFP document independently — spans are per-document, so no concatenation.
  const docs: { id: bigint; text: string }[] = (loaded.solicitation.solDocs as DocFile[])
    .filter((d) => d.docType === 'rfp' && d.extractionStatus === 'complete')
    .map((d) => ({ id: d.id, text: decryptField(d.extractedText) }))
    .filter((d) => d.text.trim() !== '');

  if (docs.length === 0) {
    return {
      ok: false,
      count: 0,
      error: 'No extracted RFP text. Upload the solicitation (RFP) documents on the Documents tab and wait for extraction.'
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

  if (loaded.existingCount >= MAX_REQUIREMENTS) return { ok: true, count: 0, exhausted: true };

  // Flatten all windows across all documents into one deterministic, globally-indexed list. The
  // window geometry is stable across ticks (same doc set/text → same list), so a persisted
  // gIndex resumes exactly.
  const flat: FlatWindow[] = [];
  let g = 0;
  for (const d of docs) {
    for (const w of windowize(d.text.length)) {
      flat.push({ gIndex: g++, documentId: d.id, docText: d.text, start: w.start, end: w.end });
    }
  }

  // Read the resumption cursor from the payload (or start fresh). The cursor — NOT the row count —
  // is the source of truth: under merge-at-end no rows exist until the final tick, so inferring
  // "resuming" from existing rows would be wrong.
  const job = jobId
    ? await prismaAdmin.jobQueue.findUnique({ where: { id: jobId }, select: { payload: true } })
    : null;
  const basePayload = (job?.payload ?? {}) as Record<string, unknown>;
  const cursor: ShredCursor =
    (basePayload.cursor as ShredCursor | undefined) ?? { gIndex: 0, spans: [], failed: [], rejected: 0 };

  const persistCursor = async (): Promise<void> => {
    if (!jobId) return;
    try {
      await prismaAdmin.jobQueue.update({
        where: { id: jobId },
        // The cursor is JSON-serializable (numbers/strings/arrays only); Prisma's Json input type
        // needs an index signature our typed cursor doesn't declare, hence the cast.
        data: { payload: { ...basePayload, cursor } as unknown as Prisma.InputJsonObject }
      });
    } catch {
      // Non-fatal: a lost cursor write just re-does a round next tick; skipDuplicates makes the
      // re-extracted spans a no-op at write time.
    }
  };

  // Process windows in bounded-parallel rounds until exhausted or out of budget.
  while (cursor.gIndex < flat.length) {
    if (Date.now() > deadlineMs - ROUND_RESERVE_MS) break; // out of budget → resume next tick
    const round = flat.slice(cursor.gIndex, cursor.gIndex + ROUND_SIZE);
    await setShredLabel(
      jobId,
      `Extracting requirements — windows ${cursor.gIndex + 1}–${cursor.gIndex + round.length} of ${flat.length}…`
    );
    const results = await Promise.all(round.map((w) => extractWindow(w, provider, model, apiKey, companyId)));
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (!res.ok) { cursor.failed.push(round[i].gIndex); continue; }
      cursor.rejected += res.rejected;
      for (const s of res.spans) cursor.spans.push(s);
    }
    cursor.gIndex += round.length;
    await persistCursor(); // after each completed round, so a kill can't redo finished work
  }

  // Not done this tick — leave the cursor for the next worker tick (nothing written yet).
  if (cursor.gIndex < flat.length) {
    await setShredLabel(jobId, `Paused at window ${cursor.gIndex} of ${flat.length} — resuming next tick…`);
    return { ok: true, count: 0, exhausted: false };
  }

  // ── Exhausted: stitch edge-split fragments, merge overlap-duplicates, write ONCE. ──
  await setShredLabel(jobId, 'Extraction complete — reassembling and writing the matrix…');

  const docTextById = new Map(docs.map((d) => [d.id.toString(), d.text]));

  // Group by document (offsets from different documents aren't comparable).
  const byDoc = new Map<string, AccumSpan[]>();
  for (const s of cursor.spans) {
    const arr = byDoc.get(s.documentId) ?? [];
    arr.push(s);
    byDoc.set(s.documentId, arr);
  }

  let merged: AccumSpan[] = [];
  for (const arr of Array.from(byDoc.values())) {
    // stitchFragments first: reassemble obligations a window edge split across neighbors.
    const stitched = stitchFragments(arr);
    // A fragment that stitched with nothing and overlapped nothing survives still-truncated —
    // it means the document has a requirement longer than the window. Surface it, don't hide it.
    for (const s of stitched) {
      if (s.truncated) {
        console.warn(
          `[shred] un-stitched fragment (requirement longer than window?) sol=${solicitationId} doc=${s.documentId} [${s.start},${s.end}]`
        );
      }
    }
    // Then mergeSpans: collapse the near-duplicate COMPLETE spans window overlap creates.
    merged.push(...mergeSpans(stitched));
  }

  // Clause-collapse: a bare clause citation ("FAR 52.212-5 …") appearing more than once collapses
  // to a single row per clause number, so a checkbox list of incorporated clauses doesn't become
  // one row per line. Non-clause spans pass through untouched.
  const seenClause = new Set<string>();
  merged = merged.filter((s) => {
    const key = clauseReference(docTextById.get(s.documentId)!.slice(s.start, s.end));
    if (!key) return true;
    const dedup = `${s.documentId}:${key}`;
    if (seenClause.has(dedup)) return false;
    seenClause.add(dedup);
    return true;
  });

  // Order deterministically (document, then position) and respect the matrix cap.
  merged.sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : a.start - b.start));
  const room = Math.max(0, MAX_REQUIREMENTS - loaded.existingCount);
  const toWrite = merged.slice(0, room);

  const failedWindows = cursor.failed.slice().sort((a, b) => a - b);
  const missedChars = computeMissedChars(flat, cursor.failed);

  if (toWrite.length === 0) {
    return { ok: true, count: 0, exhausted: true, failedWindows, missedChars, rejected: cursor.rejected };
  }

  await withTenant(companyId, (tx) =>
    tx.requirement.createMany({
      // skipDuplicates → ON CONFLICT DO NOTHING against the partial unique index
      // (solicitation_id, document_id, span_start, span_end) WHERE span_start IS NOT NULL, so a
      // re-run / regenerate re-extracting identical spans is the intended no-op.
      skipDuplicates: true,
      data: toWrite.map((s, i) => {
        const docText = docTextById.get(s.documentId)!;
        const slice = docText.slice(s.start, s.end);
        const citation = deriveCitation(docText, { start: s.start, end: s.end });
        const composition = classifyComposition(slice, findEnumerators(slice), s.obligationCount);
        return {
          companyId,
          solicitationId,
          documentId: BigInt(s.documentId),
          spanStart: s.start,
          spanEnd: s.end,
          name: s.name,
          description: slice, // verbatim RAW slice (soft hyphens/artifacts and all — faithful)
          source: s.source,
          disposition: s.disposition,
          isScored: s.isScored,
          complianceStatus:
            s.disposition === 'administrative' ? ('not_applicable' as const) : ('not_assessed' as const),
          farReference: clauseReference(slice) ?? '',
          citation,
          citationSynthesized: citation === '', // deriveCitation found nothing → offset-only fact
          composition: composition.composition,
          obligationCount: s.obligationCount,
          enumeratorCount: composition.enumeratorCount,
          weight: s.weight,
          sortOrder: loaded.nextOrder + i
        };
      })
    })
  );

  return { ok: true, count: toWrite.length, exhausted: true, failedWindows, missedChars, rejected: cursor.rejected };
}
