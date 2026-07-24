// Shred input loader. Turns a solicitation into the structured input the pipeline consumes:
// the parser's requirement candidates (each already carrying a derived, verifiable citation and
// source span) plus the Section M region text used for factor extraction.
//
// This is deterministic — no LLM. It reuses the Modal parser output we already store; it never
// re-parses. A document with no current parse row yields no candidates (it cannot feed a
// candidate-grounded shred) and is reported, not silently dropped.

import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { asParseResult, joinParagraphs, type ModalCandidate, type ParseResult, type Sentence } from '@/utils/dara/parse-result';
import { cleanSourceText, deriveCitation, indexSections, candidatePage } from '@/utils/dara/shred/citation';

const SHRED_ELIGIBLE = new Set(['rfp_base', 'pws_sow']);

// Section M is the evaluation methodology. Detect its sections by numbering (M…) or heading language.
const SECTION_M_RE = /\b(section\s*m\b|evaluation\s+factors?|evaluation\s+criteria|basis\s+for\s+award|award\s+will\s+be\s+made|best\s+value|subfactors?)\b/i;
const SECTION_M_TAIL_CHARS = 45_000; // fallback: Section M almost always lives in the last portion

export interface ShredCandidate {
  candidateId: string;
  docId: string;              // bigint as string (safe to carry through JSON to the model)
  docRole: string | null;     // originating document's role (pws_sow | rfp_base | …) — a source hint for the classifier
  text: string;               // cleaned verbatim sentence — the requirement text (grounded by construction)
  modalClass: string;         // MANDATORY | PROHIBITION | PERMISSION | PREDICTIVE | AMBIGUOUS
  sectionId: string | null;
  citation: string;
  citationSynthesized: boolean;
  page: number | null;
  spanStart: number | null;
  spanEnd: number | null;
}

export interface ShredInput {
  solicitationId: bigint;
  companyId: bigint;
  docCount: number;
  candidates: ShredCandidate[];
  /** Concatenated text of all eligible docs — the grounding haystack source. */
  allText: string;
  /** Extracted Section M region text (may be '' if none detected). */
  sectionMText: string;
  /** Per-doc modal-candidate totals the parser found, for count reconciliation. */
  parserCandidateTotal: number;
  error?: string;
}

function sentencesById(result: ParseResult): Map<string, Sentence> {
  const m = new Map<string, Sentence>();
  for (const s of result.sentences ?? []) if (s?.sentence_id) m.set(s.sentence_id, s);
  return m;
}

/** Collect the Section M region text from a parse result: matching sections' paragraphs, else the tail. */
function extractSectionM(result: ParseResult, docText: string): string {
  const mSectionIds = new Set(
    (result.sections ?? [])
      .filter(s => {
        const num = (s.source_numbering ?? '').trim();
        const numIsM = /^m\b|^m[.\-]/i.test(num);
        return numIsM || SECTION_M_RE.test(s.heading_text ?? '');
      })
      .map(s => s.section_id)
  );
  if (mSectionIds.size > 0) {
    const text = (result.paragraphs ?? [])
      .filter(p => p.section_id && mSectionIds.has(p.section_id))
      .map(p => p.text)
      .filter(t => typeof t === 'string' && t.trim() !== '')
      .join('\n\n');
    if (text.trim().length > 0) return cleanSourceText(text);
  }
  // Fallback: the tail of the document, where Section M usually sits.
  return cleanSourceText(docText.slice(-SECTION_M_TAIL_CHARS));
}

export async function loadShredInput(solicitationId: bigint, companyId: bigint): Promise<ShredInput> {
  const empty: ShredInput = {
    solicitationId, companyId, docCount: 0, candidates: [],
    allText: '', sectionMText: '', parserCandidateTotal: 0
  };

  const loaded = await withTenant(companyId, async (tx) =>
    tx.solicitation.findFirst({ where: { id: solicitationId, companyId }, include: { solDocs: true } })
  );
  if (!loaded) return { ...empty, error: 'Solicitation not found.' };

  const docs = (loaded.solDocs ?? []).filter(
    d => d.docType === 'rfp' && d.extractionStatus === 'complete'
      && (!d.documentRole || SHRED_ELIGIBLE.has(d.documentRole))
  );
  if (docs.length === 0) {
    return { ...empty, error: 'No eligible solicitation documents (need an rfp_base or pws_sow with completed extraction).' };
  }

  const candidates: ShredCandidate[] = [];
  const textParts: string[] = [];
  const sectionMParts: string[] = [];
  const noParse: string[] = [];
  let parserCandidateTotal = 0;

  for (const doc of docs) {
    const parseRows = await withTenant(companyId, async (tx) =>
      tx.daraParseResult.findMany({
        where: { solDocId: doc.id, supersededAt: null },
        orderBy: { id: 'desc' },
        take: 1
      })
    );
    const result = parseRows.length > 0 ? asParseResult(parseRows[0].result) : null;

    // Grounding source text (paragraph reconstruction, else decrypted flat text).
    let docText = result ? joinParagraphs(result) : '';
    if (!docText.trim()) docText = decryptField(doc.extractedText) ?? '';
    if (docText.trim()) textParts.push(docText);

    if (!result) { noParse.push(doc.originalFilename); continue; }

    sectionMParts.push(extractSectionM(result, docText));

    const rawCandidates: ModalCandidate[] = result.deduplicated_candidates ?? result.modal_candidates ?? [];
    parserCandidateTotal += rawCandidates.length;
    const sents = sentencesById(result);
    const sectionsIdx = indexSections(result);

    for (const c of rawCandidates) {
      const text = cleanSourceText(c.source_text ?? '');
      if (text.length < 12) continue; // too short to be a real, groundable obligation
      const page = candidatePage(c, result);
      const cite = deriveCitation(c, sectionsIdx, page);
      const sent = sents.get(c.sentence_id);
      candidates.push({
        candidateId: c.candidate_id,
        docId: doc.id.toString(),
        docRole: doc.documentRole ?? null,
        text,
        modalClass: c.modal_class,
        sectionId: c.section_id ?? null,
        citation: cite.citation,
        citationSynthesized: cite.synthesized,
        page,
        spanStart: sent?.char_start ?? null,
        spanEnd: sent?.char_end ?? null
      });
    }
  }

  const allText = textParts.join('\n\n');
  const sectionMText = sectionMParts.join('\n\n').trim();

  if (candidates.length === 0) {
    const why = noParse.length > 0
      ? `No parsed requirement candidates. Documents need a current parse (re-parse: ${noParse.join(', ')}).`
      : 'The parser found no requirement candidates in the eligible documents.';
    return { ...empty, docCount: docs.length, allText, sectionMText, error: why };
  }

  return {
    solicitationId, companyId, docCount: docs.length,
    candidates, allText, sectionMText, parserCandidateTotal
  };
}
