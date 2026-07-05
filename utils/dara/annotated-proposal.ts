// Annotated proposal export — produces a .docx of the proposal/response draft with real Word
// review comments anchored inline where the AI review's findings apply.
//
// Anchoring is done AT EXPORT TIME with a single AI call: given the proposal text + the review
// findings, the model returns, per finding, the exact verbatim passage the comment attaches to
// (or nothing, when the finding is about something missing/general). We then place a genuine
// OOXML comment (docx lib: CommentRangeStart/End + CommentReference) around that passage.
// Findings with no anchorable passage are collected into a leading "General findings" section
// so every finding still surfaces as a comment. Nothing is persisted — this reads existing
// findings + the stored (decrypted) draft text and builds the document on demand.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  CommentRangeStart,
  CommentRangeEnd,
  CommentReference,
  HeadingLevel
} from 'docx';
import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';
import { userTeamIds, canViewSolicitation } from '@/utils/dara/sol-access';
import { severityRank } from '@/components/dara/reportBits';

const NAVY = '1B2A4A';
const MUTED = '64748B';
// Bound the text sent to the anchor call so a huge draft can't blow the token budget. Sonnet's
// 200k context easily covers a full proposal; anything past this falls back to General findings.
const MAX_ANCHOR_CHARS = 200_000;
const ANCHOR_MAX_TOKENS = 8_000;
// Ignore anchor quotes shorter than this (normalized) — too short to place reliably.
const MIN_ANCHOR_LEN = 10;

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW'
};

interface FindingLite {
  id: string;
  severity: string;
  text: string;
  recommendedAction: string;
  requirementRef: string;
}

type DocLite = { originalFilename: string; extractedText: string | null; extractionStatus: string };

function concatProposal(docs: DocLite[]): string {
  return docs
    .filter((d) => d.extractionStatus === 'complete')
    .map((d) => decryptField(d.extractedText))
    .filter((t) => t.trim() !== '')
    .join('\n\n');
}

function toLite(f: {
  id: bigint;
  severity: string;
  text: string;
  recommendedAction: string;
  requirementRef: string;
}): FindingLite {
  return {
    id: f.id.toString(),
    severity: f.severity,
    text: f.text,
    recommendedAction: f.recommendedAction,
    requirementRef: f.requirementRef
  };
}

interface Source {
  proposalText: string;
  findings: FindingLite[];
  solNumber: string;
  title: string;
  label: string; // review name / "Direct AI review"
  company: Parameters<typeof resolveCompanyAI>[0];
  companyId: bigint;
}

/**
 * Resolve the proposal text + findings to annotate, enforcing the same view access as the
 * report. `reviewId` selects a specific color-team review; without it we use the Direct AI
 * review (direct_ai sols) or the latest color-team review (color_team sols).
 */
async function loadSource(
  solId: bigint,
  reviewId: bigint | null,
  daraUser: { id: string; companyId: bigint; role: string }
): Promise<Source | null> {
  return withTenant(daraUser.companyId, async (tx) => {
    const sol = await tx.solicitation.findFirst({
      where: { id: solId, companyId: daraUser.companyId },
      include: { departments: { select: { teamId: true } } }
    });
    if (!sol) return null;
    const teamSet = new Set(await userTeamIds(tx, daraUser.id));
    if (!canViewSolicitation(daraUser.id, daraUser.role, sol.createdBy, sol.departments.map((d) => d.teamId), teamSet)) {
      return null;
    }
    const company = await tx.company.findUnique({ where: { id: daraUser.companyId } });
    if (!company) return null;

    let proposalText = '';
    let findings: FindingLite[] = [];
    let label = '';

    const useColorTeam = reviewId != null || sol.mode !== 'direct_ai';
    if (useColorTeam) {
      const review = reviewId
        ? await tx.review.findFirst({
            where: { id: reviewId, solicitationId: solId, companyId: daraUser.companyId },
            include: { documents: true, passes: { include: { findings: true } } }
          })
        : await tx.review.findFirst({
            where: { solicitationId: solId, companyId: daraUser.companyId },
            orderBy: { createdAt: 'desc' },
            include: { documents: true, passes: { include: { findings: true } } }
          });
      if (review) {
        proposalText = concatProposal(review.documents);
        findings = review.passes.flatMap((p) => p.findings.map(toLite));
        label = review.name;
      }
    } else {
      const directReview = await tx.directReview.findUnique({
        where: { solicitationId: solId },
        include: { findings: true }
      });
      const solDocs = await tx.solDocument.findMany({
        where: { solicitationId: solId, companyId: daraUser.companyId, docType: 'proposal' }
      });
      proposalText = concatProposal(solDocs);
      findings = (directReview?.findings ?? []).map(toLite);
      label = 'Direct AI review';
    }

    findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    return {
      proposalText,
      findings,
      solNumber: sol.solNumber,
      title: sol.title,
      label,
      company,
      companyId: daraUser.companyId
    };
  });
}

/** Ask the model for the exact verbatim anchor passage per finding. Returns finding.id → quote. */
async function anchorFindings(source: Source): Promise<Map<string, string>> {
  const anchors = new Map<string, string>();
  const proposal = source.proposalText.slice(0, MAX_ANCHOR_CHARS);
  const list = source.findings
    .map(
      (f, i) =>
        `#${i + 1} [${f.severity}] ${f.requirementRef ? `(ref: ${f.requirementRef}) ` : ''}${f.text}` +
        `${f.recommendedAction ? ` :: Fix: ${f.recommendedAction}` : ''}`
    )
    .join('\n')
    .slice(0, 20_000);

  const system =
    'You anchor proposal-review findings to the exact text they refer to. For each finding you ' +
    'return the SHORTEST exact verbatim substring copied character-for-character from the PROPOSAL ' +
    '(between 4 and 25 words, on a single line) that the reviewer comment should attach to. If the ' +
    'finding is about something MISSING/absent from the proposal, or is general and has no specific ' +
    'passage, return an empty string for its quote. Never invent or paraphrase — a quote must appear ' +
    'verbatim in the proposal or be empty. Respond ONLY with strict JSON: ' +
    '{"anchors":[{"n":1,"quote":"..."}, ...]} with one entry per finding number.';
  const user = `PROPOSAL:\n"""\n${proposal}\n"""\n\nFINDINGS (anchor each by its number):\n${list}`;

  const platform = source.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(source.company, platform);
  if (!apiKey) return anchors; // no key → export still works, just without inline anchors

  let text = '';
  try {
    const ai = await complete(provider, system, user, model, apiKey, ANCHOR_MAX_TOKENS);
    text = ai.text;
  } catch {
    return anchors; // AI failure → fall back to all-general (still a valid document)
  }

  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return anchors;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { anchors?: { n?: number; quote?: string }[] };
    for (const a of parsed.anchors ?? []) {
      const idx = Number(a?.n);
      const quote = String(a?.quote ?? '').trim();
      if (!quote || !Number.isInteger(idx) || idx < 1 || idx > source.findings.length) continue;
      anchors.set(source.findings[idx - 1].id, quote);
    }
  } catch {
    /* malformed JSON → no anchors */
  }
  return anchors;
}

// Normalize a string for anchor matching (lowercase, collapse ALL whitespace incl. NBSP/tabs to
// single spaces, fold smart quotes/dashes to ASCII) while recording, per normalized char, the
// index it came from in the ORIGINAL string — so a normalized match maps back to a real span we
// can wrap. Extracted PDF/Word text is full of NBSPs, double spaces, tabs and smart punctuation
// that an AI "verbatim" quote won't reproduce, which is why plain indexOf never matched.
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (ch === '’' || ch === '‘' || ch === 'ʼ') ch = "'";
    else if (ch === '“' || ch === '”') ch = '"';
    else if (ch === '–' || ch === '—' || ch === '−') ch = '-';
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      norm += ' ';
      map.push(i);
      prevSpace = true;
    } else {
      norm += ch.toLowerCase();
      map.push(i);
      prevSpace = false;
    }
  }
  return { norm, map };
}

function commentBody(f: FindingLite): Paragraph[] {
  const head = `${SEVERITY_LABEL[f.severity] ?? f.severity.toUpperCase()}${f.requirementRef ? ` · ${f.requirementRef}` : ''}`;
  const paras = [new Paragraph({ children: [new TextRun({ text: head, bold: true, size: 18, color: NAVY })] })];
  if (f.text) paras.push(new Paragraph({ children: [new TextRun({ text: f.text, size: 18 })] }));
  if (f.recommendedAction) {
    paras.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Recommended: ', bold: true, size: 18 }),
          new TextRun({ text: f.recommendedAction, size: 18 })
        ]
      })
    );
  }
  return paras;
}

/** Build the annotated .docx. Every finding becomes a real Word comment. Exported for testing. */
export function buildDocx(source: Source, anchors: Map<string, string>): Promise<Buffer> {
  // Assign a numeric comment id per finding (docx requires numeric ids). The Document `comments`
  // option takes plain option objects (not Comment instances).
  const now = new Date();
  const cid = new Map<string, number>();
  source.findings.forEach((f, i) => cid.set(f.id, i));
  const comments = source.findings.map((f) => ({
    id: cid.get(f.id)!,
    author: 'DARA',
    initials: 'DA',
    date: now,
    children: commentBody(f)
  }));

  // Precompute each finding's normalized anchor quote once (skip empties / too-short ones).
  const normQuote = new Map<string, string>();
  for (const f of source.findings) {
    const q = anchors.get(f.id);
    if (!q) continue;
    const nq = normalizeWithMap(q).norm.trim();
    if (nq.length >= MIN_ANCHOR_LEN) normQuote.set(f.id, nq);
  }

  // Proposal body split into lines. For each line we normalize (collapsing PDF whitespace/smart
  // punctuation) and match anchors against the normalized text, then map the hit back to the real
  // span via the index map so the comment wraps the actual characters.
  const lines = source.proposalText.split('\n');
  const anchored = new Set<string>();
  const body: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, '');
    if (line.trim() === '') {
      body.push(new Paragraph({ children: [] }));
      continue;
    }
    // Collect the anchors that fall inside this line, left-to-right, non-overlapping.
    const hits: { id: number; start: number; end: number }[] = [];
    if (normQuote.size > 0) {
      const { norm, map } = normalizeWithMap(line);
      for (const f of source.findings) {
        if (anchored.has(f.id)) continue;
        const nq = normQuote.get(f.id);
        if (!nq) continue;
        const at = norm.indexOf(nq);
        if (at < 0) continue;
        const start = map[at];
        const end = (map[at + nq.length - 1] ?? map[map.length - 1]) + 1;
        hits.push({ id: cid.get(f.id)!, start, end });
        anchored.add(f.id);
      }
    }
    if (hits.length === 0) {
      body.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })] }));
      continue;
    }
    hits.sort((a, b) => a.start - b.start);
    const children: (TextRun | CommentRangeStart | CommentRangeEnd | CommentReference)[] = [];
    let cursor = 0;
    for (const h of hits) {
      if (h.start < cursor) continue; // overlap guard — skip a nested/overlapping hit
      if (h.start > cursor) children.push(new TextRun({ text: line.slice(cursor, h.start), size: 20 }));
      children.push(new CommentRangeStart(h.id));
      children.push(new TextRun({ text: line.slice(h.start, h.end), size: 20 }));
      children.push(new CommentRangeEnd(h.id));
      children.push(new TextRun({ children: [new CommentReference(h.id)] }));
      cursor = h.end;
    }
    if (cursor < line.length) children.push(new TextRun({ text: line.slice(cursor), size: 20 }));
    body.push(new Paragraph({ children }));
  }

  // Header + any unanchored findings collected up top (each still a real comment).
  const n = source.findings.length;
  const unanchored = source.findings.filter((f) => !anchored.has(f.id));
  // Diagnostic (counts only, no content): distinguishes an AI/anchor miss from a matching miss.
  console.log(
    `[annotated] sol=${source.solNumber || source.title} findings=${n} aiQuotes=${anchors.size} usableQuotes=${normQuote.size} anchoredInline=${anchored.size}`
  );
  const header: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: `Annotated response — ${source.solNumber || source.title}`, bold: true, color: NAVY, size: 30 })]
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `${source.label} · ${n} finding${n === 1 ? '' : 's'} as comments · ${anchored.size} anchored inline · open the Review pane in Word to read them`,
          color: MUTED,
          size: 18
        })
      ]
    })
  ];

  if (unanchored.length > 0) {
    header.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 120, after: 60 },
        children: [new TextRun({ text: `General findings (${unanchored.length})`, bold: true, color: NAVY, size: 22 })]
      })
    );
    for (const f of unanchored) {
      const id = cid.get(f.id)!;
      const marker = `${SEVERITY_LABEL[f.severity] ?? f.severity} — ${f.text.slice(0, 90)}${f.text.length > 90 ? '…' : ''}`;
      header.push(
        new Paragraph({
          children: [
            new CommentRangeStart(id),
            new TextRun({ text: marker, size: 20 }),
            new CommentRangeEnd(id),
            new TextRun({ children: [new CommentReference(id)] })
          ]
        })
      );
    }
    header.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: 'Response draft', bold: true, color: NAVY, size: 22 })]
      })
    );
  }

  const doc = new Document({
    creator: 'DARA · Crucible Insight',
    title: `Annotated response — ${source.solNumber || source.title}`,
    comments: { children: comments },
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: {}, children: [...header, ...body] }]
  });
  return Packer.toBuffer(doc);
}

export interface AnnotatedResult {
  ok: boolean;
  buffer?: Buffer;
  filename?: string;
  error?: string;
  status?: number;
}

/**
 * Full pipeline: resolve the draft + findings, anchor them via one AI call, and build the
 * annotated .docx. Returns a friendly error (with an HTTP status) when there's nothing to
 * annotate or access is denied.
 */
export async function generateAnnotatedProposal(
  solId: bigint,
  reviewId: bigint | null,
  daraUser: { id: string; companyId: bigint; role: string }
): Promise<AnnotatedResult> {
  const source = await loadSource(solId, reviewId, daraUser);
  if (!source) return { ok: false, error: 'Not found.', status: 404 };
  if (!source.proposalText.trim()) {
    return { ok: false, error: 'No response draft to annotate — upload the proposal/response draft first.', status: 400 };
  }
  if (source.findings.length === 0) {
    return { ok: false, error: 'No review findings to annotate — run the review first.', status: 400 };
  }

  const anchors = await anchorFindings(source);
  const buffer = await buildDocx(source, anchors);
  const slug = (source.solNumber || 'response').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return { ok: true, buffer, filename: `${slug}_annotated_response.docx` };
}
