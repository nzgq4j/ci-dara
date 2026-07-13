// Modal `dara-parser` client + persistence.
//
// callModalParser() makes ONE synchronous HTTP call to the deployed Modal structural
// pre-processing service (pdfplumber / python-docx + spaCy) and returns the ParseResult, or
// null on ANY failure (missing config, network error, timeout, non-2xx). It never throws and
// never logs the shared secret — the caller (document upload / re-parse) must degrade to the
// existing flat unpdf/mammoth path when it gets null.
//
// saveParseResult() persists a ParseResult as a new immutable dara_parse_results row, atomically
// superseding any prior current row for the same document (a re-parse is add-not-mutate; full
// history is retained). parseAndPersist() ties the two together for the upload/worker call sites.

import { withTenant } from '@/utils/prisma';
import { createSignedDownloadUrl } from '@/utils/dara/documents';
import type { ParseResult } from '@/utils/dara/parse-result';

// 120s: generous headroom for a Modal cold start (5–15s) plus a typical solicitation parse
// (15–40s). On timeout callModalParser returns null and the shred falls back to flat text.
const MODAL_TIMEOUT_MS = 120_000;

interface ModalParseRequest {
  document_url: string; // short-lived signed Supabase Storage URL (Modal fetches it)
  document_id: string; // SolDocument id (echoed back in the ParseResult; not authoritative)
  doc_type: 'pdf' | 'docx';
  company_id: string;
}

/**
 * Call the Modal dara-parser endpoint synchronously. Returns null on any failure — the caller
 * MUST fall back to the flat unpdf/mammoth extraction. Never throws. Never logs the secret.
 */
export async function callModalParser(request: ModalParseRequest): Promise<ParseResult | null> {
  const url = process.env.MODAL_PARSER_URL;
  const secret = process.env.MODAL_PARSER_SECRET;

  if (!url || !secret) {
    console.warn('[modal-parser] MODAL_PARSER_URL or MODAL_PARSER_SECRET not set — skipping structural parse');
    return null;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Secret is used only as the bearer credential; it is never included in any log line.
        Authorization: `Bearer ${secret}`
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(MODAL_TIMEOUT_MS)
    });

    if (!response.ok) {
      console.warn(`[modal-parser] HTTP ${response.status} for doc ${request.document_id} — falling back`);
      return null;
    }

    return (await response.json()) as ParseResult;
  } catch (err) {
    // Includes AbortError (timeout) and network errors. Log the reason, never the secret.
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error';
    console.warn(`[modal-parser] request failed for doc ${request.document_id} (${reason}) — falling back`);
    return null;
  }
}

/**
 * Persist a ParseResult as a new current dara_parse_results row for `solDocId`, atomically
 * superseding any prior current row(s). Runs under withTenant (dara_app + RLS), which is itself
 * an interactive transaction, so the supersede + insert are all-or-nothing.
 */
export async function saveParseResult(
  result: ParseResult,
  solDocId: bigint,
  companyId: bigint,
  createdBy: string | null
): Promise<void> {
  await withTenant(companyId, async (tx) => {
    await tx.daraParseResult.updateMany({
      where: { solDocId, companyId, supersededAt: null },
      data: { supersededAt: new Date() }
    });
    await tx.daraParseResult.create({
      data: {
        companyId,
        solDocId,
        schemaVersion: result.schema_version ?? '1.0',
        parserVersion: result.parser_version ?? 'unknown',
        docType: result.doc_type === 'docx' ? 'docx' : 'pdf',
        pageCount: result.page_count ?? null,
        wordCount: result.word_count ?? null,
        processingTimeMs: result.processing_time_ms ?? null,
        qualityGatePassed: result.quality_gate_passed ?? false,
        qualityGateFailures: (result.quality_gate_failures ?? []) as unknown as object,
        result: result as unknown as object,
        modalCandidateCount: result.modal_candidate_count ?? null,
        tableCount: result.table_count ?? null,
        ibrFlagCount: result.ibr_flag_count ?? null,
        imagePageCount: result.image_page_count ?? null,
        createdBy
      }
    });
  });
}

/** pdf/docx are the only formats the Modal parser handles; other types return null. */
function docTypeFor(storedFilename: string): 'pdf' | 'docx' | null {
  const lower = storedFilename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return null;
}

/**
 * Best-effort structural parse of an already-stored document + persistence. Generates a fresh
 * short-lived signed URL, calls Modal, and (on success) saves the ParseResult. NEVER throws and
 * NEVER blocks the caller: any failure (unsupported type, missing config, Modal down, save error)
 * is swallowed with a warning so the upload/worker flow proceeds on the flat-text fallback.
 *
 * Returns the ParseResult on success (so a caller can surface a quality-gate warning), else null.
 */
export async function parseAndPersist(args: {
  storedFilename: string;
  solDocId: bigint;
  companyId: bigint;
  createdBy: string | null;
}): Promise<ParseResult | null> {
  const { storedFilename, solDocId, companyId, createdBy } = args;

  const docType = docTypeFor(storedFilename);
  if (!docType) return null; // txt/md and anything else: no structural parse, flat text only.

  try {
    // 60s expiry is ample for Modal to fetch; generated fresh per call and never stored.
    const signedUrl = await createSignedDownloadUrl(storedFilename, 60);
    if (!signedUrl) {
      console.warn(`[modal-parser] could not sign URL for doc ${solDocId} — skipping structural parse`);
      return null;
    }

    const result = await callModalParser({
      document_url: signedUrl,
      document_id: solDocId.toString(),
      doc_type: docType,
      company_id: companyId.toString()
    });
    if (!result) return null; // fallback: shred will use flat text.

    try {
      await saveParseResult(result, solDocId, companyId, createdBy);
    } catch (e) {
      // A save failure loses the parse row but must not fail the upload — the shred still has
      // the flat-text fallback. Log and continue.
      console.error(`[modal-parser] saveParseResult failed for doc ${solDocId}:`, e);
      return null;
    }

    if (!result.quality_gate_passed) {
      console.warn(
        `[modal-parser] quality gate failed for doc ${solDocId}:`,
        JSON.stringify(result.quality_gate_failures ?? [])
      );
    }
    return result;
  } catch (e) {
    console.error(`[modal-parser] parseAndPersist unexpected error for doc ${solDocId}:`, e);
    return null;
  }
}
