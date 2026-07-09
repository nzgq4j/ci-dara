// utils/dara/spans.ts
//
// Deterministic span utilities for span-anchored requirement extraction.
//
// PURE functions only — NO Prisma, NO providers, NO network, NO Date.now()/Math.random().
// These are the structural defense against the two defects the redesign kills — hallucinated
// requirements and duplicate rows — so correctness here is load-bearing. A silent bug shows up
// as a compliance matrix quietly MISSING requirements, which is strictly worse than the
// duplicate rows we are replacing: duplicates are visible, missing rows are not.
//
// Everything that carries a requirement's identity is expressed as RAW character offsets into
// the decrypted source document. verifySpan is the only place normalization happens, and it
// deliberately returns RAW offsets so that deriveCitation / clauseReference / computeResidual /
// (Prompt 4) decomposition all slice raw text. Do not "simplify" any function to hand back a
// normalized offset — that corrupts every downstream slice.

export interface Span {
  start: number; // inclusive raw char index
  end: number;   // exclusive raw char index
}

// A span the extractor may have seen only partially — cut off at a window edge. stitchFragments
// reassembles truncated fragments deterministically by raw offset.
export interface TruncatableSpan extends Span {
  truncated: boolean;
}

export interface Window {
  index: number;
  start: number;
  end: number;
}

export interface Enumerator {
  marker: string;
  index: number; // raw index of the marker's first char
}

// PROMPT-1 ALIGN: these two unions are declared locally so spans.ts stays pure and buildable
// before Prompt 1's migration exists. When Prompt 1 is revised, reconcile these EXACTLY with
// the schema's `composition` enum and the decomposition-source/path naming, or flag a mismatch
// — do not let two spellings drift. 'unclassified' is a real state: a pure classifier must not
// manufacture certainty from a soft signal (see classifyComposition).
export type Composition = 'atomic' | 'compound' | 'unclassified';
export type DecompositionPath = 'enumeration' | 'tiling' | 'none';

export interface CompositionResult {
  composition: Composition;
  enumeratorCount: number;
  obligationCount: number | null;
  path: DecompositionPath;
}

export interface NormalizeResult {
  text: string;
  // Offset map, normalized index -> RAW index. Contract (TESTED in spans.test.ts):
  //   - map.length === text.length + 1
  //   - for normalized char i produced from raw range [a,b), map[i] === a (first raw index)
  //   - sentinel map[text.length] === raw.length, so an end offset is always resolvable
  //   - 1->N expansion (ligature): every normalized char maps to the SAME raw index; the next
  //     char maps to raw+1
  //   - N->1 contraction (whitespace run): the single space maps to the FIRST raw ws index
  // The map is built DURING normalization (one pass, pushed alongside each emitted char), never
  // derived after the fact — every rule changes string length, so a post-hoc computation would
  // be subtly wrong on any document containing ligatures.
  map: number[];
}

// ── windowing ────────────────────────────────────────────────────────────────

// Provisional. Values are a starting point, NOT a measured optimum — Prompt 3 must report
// actual wall-clock, window count, and token delta on the first real shred and tune these.
// A window ~= WINDOW/4 input tokens; OVERLAP must exceed the longest single obligation we want
// to keep whole across a boundary (mergeSpans collapses the duplicate the overlap creates).
export const SPAN_WINDOW_CHARS = 12_000;
export const SPAN_OVERLAP_CHARS = 1_500;

/**
 * Tile [0, n) into overlapping windows. Correct for ANY n (0, sub-window, exact, many-window).
 * count = n <= WINDOW ? 1 : ceil((n - OVERLAP) / STRIDE); the last window always ends at n, so
 * every char is covered by at least one window (asserted in the tests).
 */
export function windowize(
  n: number,
  window = SPAN_WINDOW_CHARS,
  overlap = SPAN_OVERLAP_CHARS
): Window[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  if (!(overlap >= 0 && overlap < window)) {
    throw new Error(`windowize: require 0 <= overlap < window (got overlap=${overlap}, window=${window}).`);
  }
  if (n <= window) return [{ index: 0, start: 0, end: n }];
  const stride = window - overlap;
  const count = Math.ceil((n - overlap) / stride);
  const out: Window[] = [];
  for (let k = 0; k < count; k++) {
    const start = k * stride;
    out.push({ index: k, start, end: Math.min(start + window, n) });
  }
  return out;
}

// ── normalization + the hallucination gate ───────────────────────────────────

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
  'ﬅ': 'st', 'ﬆ': 'st'
};
const PUNCT: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", // curly single quotes
  '“': '"', '”': '"', '„': '"',                 // curly double quotes
  '–': '-', '—': '-', '−': '-'                  // en / em dash, minus sign
};

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' ';
}
function isLetter(c: string): boolean {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

/**
 * Normalize `raw` for verbatim matching and build the normalized->raw offset map.
 *
 * The problem this exists for: unpdf(mergePages:true) emits soft hyphens, mid-word line breaks
 * ("pro-\nvide"), ligatures, NBSP, whitespace runs, and curly quotes/dashes, while a model asked
 * to quote "verbatim" returns a cleaned version. An exact indexOf on the raw text therefore MISSES
 * the model's quote and the span is dropped (a missing requirement). Normalizing BOTH sides to a
 * common form fixes that; the map lets verifySpan hand back RAW offsets so nothing downstream is
 * corrupted.
 *
 * Rules, in order:
 *   1. soft hyphen (U+00AD)               -> dropped
 *   2. intra-word ASCII hyphen            -> dropped (with any whitespace up to the next letter)
 *   3. whitespace run (incl. \n, NBSP)    -> single space (mapped to the first ws index)
 *   4. ligature (1 char)                  -> 2-3 ascii chars (all mapped to the same raw index)
 *   5. curly quote / en-em dash           -> ascii equivalent
 *   6. everything else                    -> passthrough
 *
 * Rule 2 is SYMMETRIC by construction — applied identically to the raw text and to the model's
 * quote — so "cost-effective", "cost-\neffective", and "costeffective" all normalize to
 * "costeffective" and match. It sidesteps the genuinely-ambiguous line-break hyphen ("pro-vide"
 * is never a word; "cost-effective" always is; nothing in the char stream distinguishes them)
 * rather than trying to resolve it, and it makes normalization idempotent under line position.
 * It CANNOT cause a false mismatch. Its only effect is that a meaning-bearing hyphen is ignored
 * FOR MATCHING (e.g. "co-operate" == "cooperate"); the RAW slice returned by verifySpan still
 * contains the real hyphen, so the stored description is faithful. A hyphen NOT between two
 * letters (a range like "52-week", a spaced dash "a - b") is kept.
 *
 * Rule 4 is likewise symmetric: LIGATURES only ever EXPANDS toward ASCII and the model already
 * emits ASCII, so raw "oﬃce" and model "office" both key to "office". There is no reverse
 * (ascii -> ligature) transform, so the mapping can never be one-directional.
 */
export function normalize(raw: string): NormalizeResult {
  const out: string[] = [];
  const map: number[] = [];
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const ch = raw[i];

    // (1) soft hyphen — a discretionary break hint, never real text.
    if (ch === '­') { i++; continue; }

    // (2) intra-word ASCII hyphen — drop it and any whitespace up to the next letter, but only
    // when the char immediately before it is a letter (so a spaced/bulleted dash is preserved).
    if (ch === '-') {
      const prevIsLetter = out.length > 0 && isLetter(out[out.length - 1]);
      if (prevIsLetter) {
        let j = i + 1;
        while (j < n && isWs(raw[j])) j++;
        if (j < n && isLetter(raw[j])) { i = j; continue; } // join: skip hyphen + whitespace
      }
      out.push('-'); map.push(i); i++; continue;
    }

    // (3) whitespace run -> one space, mapped to the FIRST raw whitespace index.
    if (isWs(ch)) {
      const first = i;
      while (i < n && isWs(raw[i])) i++;
      out.push(' '); map.push(first);
      continue;
    }

    // (4) ligature -> ascii; every produced char maps to the same raw index.
    const lig = LIGATURES[ch];
    if (lig) { for (const c of lig) { out.push(c); map.push(i); } i++; continue; }

    // (5) curly quotes / dashes -> ascii.
    const rep = PUNCT[ch];
    if (rep) { out.push(rep); map.push(i); i++; continue; }

    // (6) passthrough.
    out.push(ch); map.push(i); i++;
  }
  map.push(n); // sentinel — end offset of the final normalized char resolves to raw length
  return { text: out.join(''), map };
}

/**
 * Anchor a model's `quoted` text to a RAW character range in `rawText`. Returns RAW offsets
 * (never normalized) or null when the quote cannot be verbatim-located after normalization.
 *
 * A null is the hallucination signal: either the model fabricated text that isn't in the source,
 * or it paraphrased beyond what normalization tolerates. The Prompt-3 caller treats null as a
 * failed/rejected span (visible), NEVER a silent drop. Pass a WINDOW-scoped rawText to keep the
 * match local; against a whole document verifySpan anchors to the FIRST occurrence of the quote.
 */
export function verifySpan(rawText: string, quoted: string): Span | null {
  const { text: nRaw, map } = normalize(rawText);
  const q = normalize(quoted).text.trim(); // the quote needs no map of its own
  if (q.length === 0) return null;
  const j = nRaw.indexOf(q);
  if (j < 0) return null;
  return { start: map[j], end: map[j + q.length] }; // map[j+L] is sentinel-safe (L <= nRaw.length)
}

// ── span-set dedup (collapses the near-duplicates that window OVERLAP creates) ─

/**
 * Merge near-duplicate spans by FUZZY overlap. Two spans collapse when their overlap divided by
 * the shorter span's length is >= `minOverlapRatio`. This is what removes the boundary straddler
 * that appears in two adjacent windows (A=[4400,4700], B=[4450,4720] -> one span); the partial
 * unique index only catches EXACT (start,end) dups, so this must run before createMany.
 *
 * Merged geometry is the union [min start, max end]; the merged record keeps the metadata of the
 * LONGER raw span (ties -> the earlier-starting one, since we only replace on a strict increase).
 * Comparison is against the growing union, so a chain of overlapping spans merges transitively.
 * Intended for overlap-dedup, not general clustering.
 */
export function mergeSpans<T extends Span>(spans: T[], minOverlapRatio = 0.6): T[] {
  if (spans.length <= 1) return spans.slice();
  const sorted = spans.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const result: T[] = [];
  let cur = sorted[0];
  let curStart = cur.start;
  let curEnd = cur.end;
  for (let k = 1; k < sorted.length; k++) {
    const s = sorted[k];
    const overlap = Math.min(curEnd, s.end) - Math.max(curStart, s.start);
    const minLen = Math.min(curEnd - curStart, s.end - s.start);
    if (minLen > 0 && overlap / minLen >= minOverlapRatio) {
      if (s.end - s.start > cur.end - cur.start) cur = s; // keep the longer span's metadata
      curStart = Math.min(curStart, s.start);
      curEnd = Math.max(curEnd, s.end);
    } else {
      result.push({ ...cur, start: curStart, end: curEnd });
      cur = s; curStart = s.start; curEnd = s.end;
    }
  }
  result.push({ ...cur, start: curStart, end: curEnd });
  return result;
}

// ── fragment stitching (reassemble obligations split across window edges) ─────

/**
 * Reassemble obligations that a window edge cut into fragments. Fixed-size windows cannot contain
 * an obligation longer than OVERLAP, so a long requirement straddling a boundary is seen only in
 * pieces by BOTH neighboring windows. The extractor reports each visible fragment with
 * truncated:true; this reassembles them by raw offset — pure arithmetic, no model judgment about
 * where an obligation ends (P-5 applied to the boundary problem).
 *
 * Operate on ONE document's spans (the caller groups by document; offsets from different documents
 * are not comparable). Rules:
 *   - A complete span (truncated:false) passes through untouched.
 *   - A truncated fragment that OVERLAPS a complete span is dropped — the complete span already
 *     covers it (mergeSpans would drop it on the length rule anyway; dropping here is cheaper).
 *   - Truncated fragments whose raw ranges ABUT or OVERLAP are chained into one span
 *     [chain.start, chain.end], marked complete (truncated:false). Chaining is transitive.
 *   - A truncated fragment that stitches with nothing and overlaps nothing SURVIVES, still
 *     truncated:true — a diagnostic that the document has a requirement longer than the window.
 *     The (impure) caller logs it.
 * Merged geometry keeps the metadata of the LONGEST fragment in the chain (ties -> earliest),
 * matching mergeSpans.
 */
export function stitchFragments<T extends TruncatableSpan>(spans: T[]): T[] {
  const complete = spans.filter((s) => !s.truncated);
  const frags = spans
    .filter((s) => s.truncated)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;
  // Drop truncated fragments already covered by a complete span.
  const surviving = frags.filter((t) => !complete.some((c) => overlaps(t, c)));

  const stitched: T[] = [];
  let i = 0;
  while (i < surviving.length) {
    let meta = surviving[i];        // metadata of the longest fragment in the chain
    const start = surviving[i].start;
    let end = surviving[i].end;
    let joined = false;
    let j = i + 1;
    while (j < surviving.length && surviving[j].start <= end) { // abut or overlap (half-open)
      const nxt = surviving[j];
      if (nxt.end - nxt.start > meta.end - meta.start) meta = nxt;
      end = Math.max(end, nxt.end);
      joined = true;
      j++;
    }
    // A joined chain is treated as complete; a lonely fragment survives still-truncated.
    const out = { ...meta, start, end, truncated: joined ? false : true } as T;
    // Reconcile citationHint across the chain: the EARLIEST window with a non-empty hint wins
    // (surviving is start-sorted, so surviving[i] is earliest). This is the ONE domain field
    // stitchFragments merges — geometry otherwise keeps the longest fragment's metadata. No-op for
    // span types that don't carry a citationHint (e.g. the tests).
    if ('citationHint' in (out as object)) {
      let hint = '';
      for (let k = i; k < j; k++) {
        const h = (surviving[k] as { citationHint?: string }).citationHint;
        if (h) { hint = h; break; }
      }
      (out as { citationHint?: string }).citationHint = hint;
    }
    stitched.push(out);
    i = j;
  }

  return [...complete, ...stitched];
}

// ── composition / decomposition helpers ──────────────────────────────────────

// Heuristic sub-item markers: (a) (b), (1) (12), (iv), a. b., 1) 2). This is a COUNTER feeding a
// threshold, NOT a parser — it over-counts on abbreviations ("e.g.", "U.S.") and that is
// tolerated because classifyComposition only cares whether the count crosses a threshold, and
// Prompt 4 does the real decomposition with a model. Indices are raw offsets.
const ENUMERATOR_RE = /(?:^|\s)(\([a-z0-9]{1,3}\)|[a-z0-9]{1,2}[.)])(?=\s)/gim;

export function findEnumerators(text: string): Enumerator[] {
  const out: Enumerator[] = [];
  const re = new RegExp(ENUMERATOR_RE.source, 'gim');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const marker = m[1];
    out.push({ marker, index: m.index + m[0].indexOf(marker) });
    if (re.lastIndex === m.index) re.lastIndex++; // guard against a zero-width stall
  }
  return out;
}

// A compound requirement is a decomposition candidate when it has enough enumerated leaves to
// walk deterministically (document-enumeration, zero-token), or carries multiple obligations the
// model must tile. Below both bars, or with no obligation signal at all, it is not confidently
// either — see classifyComposition.
export const ENUM_DECOMPOSE_THRESHOLD = 3;

/**
 * Classify a requirement's internal structure. THREE states, because a pure classifier must not
 * fabricate certainty:
 *   - 'compound'     — deterministic: >= ENUM_DECOMPOSE_THRESHOLD walkable enumerated leaves.
 *   - 'atomic'       — a single obligation (obligationCount <= 1) with too few enumerators.
 *   - 'unclassified' — no signal (obligationCount == null), or the ambiguous band of a few
 *                      obligations (>= 2) with too few enumerators to walk. Defer to Prompt 4's
 *                      model tiling or the user rather than guess.
 * `path` is the suggested resolution route for a downstream/model step: 'enumeration' (walk the
 * leaves), 'tiling' (let the model split the obligations), or 'none'.
 * `text` is retained in the signature for future structural heuristics; unused today.
 */
export function classifyComposition(
  text: string,
  enumerators: Enumerator[],
  obligationCount: number | null
): CompositionResult {
  const enumeratorCount = enumerators.length;
  let composition: Composition;
  let path: DecompositionPath;
  if (enumeratorCount >= ENUM_DECOMPOSE_THRESHOLD) {
    composition = 'compound'; path = 'enumeration';
  } else if (obligationCount == null) {
    composition = 'unclassified'; path = 'none';
  } else if (obligationCount <= 1) {
    composition = 'atomic'; path = 'none';
  } else {
    composition = 'unclassified'; path = 'tiling'; // >= 2 obligations, < 3 enumerators
  }
  return { composition, enumeratorCount, obligationCount, path };
}

// ── citation + clause collapse (both slice RAW text) ──────────────────────────

const CITATION_RE =
  /Section\s+[A-M](?:\.[0-9]+)*|(?:PWS|SOW|SOO)\s+[0-9]+(?:\.[0-9]+)*|\b[0-9]{2,3}\.[0-9]{3}(?:-[0-9]{1,4})?\b|\b[LM]\.[0-9]+(?:\.[0-9]+)*/g;
const CITATION_LOOKBACK = 2000;

/**
 * Derive a "Section L.4.2" / "PWS 3.1" / clause-number citation by scanning RAW text backward
 * from the span for the nearest heading. Returns null when none is found — so the caller can fall
 * through a precedence chain (model hint, then an offset fact) instead of writing an empty string.
 * Slices RAW text — which is exactly why verifySpan returns raw offsets.
 */
export function deriveCitation(rawText: string, span: Span): string | null {
  const from = Math.max(0, span.start - CITATION_LOOKBACK);
  const before = rawText.slice(from, span.start);
  const re = new RegExp(CITATION_RE.source, 'g');
  let last = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) last = m[0];
  const trimmed = last.trim();
  return trimmed === '' ? null : trimmed;
}

// FAR/DFARS clause number, e.g. 52.212-5, 252.204-7012. The NUMBER format is legally mandated
// (FAR 52.104 / DFARS 252.104), so detecting it with a regex is genuinely arithmetic and stable.
const CLAUSE_NUM_RE = /\b(\d{2,3}\.\d{3}(?:-\d{1,4})?)\b/;

// Collapse gate for a BARE clause citation (below). A deterministic length threshold — see the
// decision in clauseReference's doc comment.
const BARE_CLAUSE_MAX_CHARS = 400;

/**
 * Collapse a BARE clause citation ("FAR 52.222-41, Service Contract Labor Standards (AUG 2018)"
 * with no substantive obligation text of its own) onto its clause number, so a FAR 52.212-5-style
 * checkbox list becomes one row per clause number instead of one row per line. Returns the clause
 * key to collapse on, or null to keep the row as a distinct requirement.
 *
 * DECISION (§D): the collapse gate is a DETERMINISTIC length threshold, chosen over asking the
 * model. This threshold is a language judgment, not arithmetic. It violates P-5. It is accepted
 * because the rule it implements removes more rows than any other, and instability in that rule
 * reintroduces the duplication defect the whole design exists to prevent. A model deciding per
 * run whether "FAR 52.222-41, Service Contract Labor Standards (AUG 2018)" carries substantive
 * obligation language — whether via a boolean OR an obligation COUNT — would make clause collapse
 * nondeterministic: the same clause would collapse on one run and split on the next. A
 * stable-but-imperfect rule beats an unstable one here. Requires calibration against real
 * extraction output; the threshold is PROVISIONAL.
 */
export function clauseReference(rawText: string): string | null {
  const m = rawText.match(CLAUSE_NUM_RE);
  if (!m) return null;
  if (rawText.trim().length > BARE_CLAUSE_MAX_CHARS) return null; // carries substantive text
  return m[1];
}

// ── residual ──────────────────────────────────────────────────────────────────

/**
 * The LEADING residual: the parent region before its first child.
 *
 * Returns null when the first child starts at (or before) the parent start — there is no leading
 * residual. TRAILING text after the LAST child is intentionally NOT a second residual: the last
 * child tile absorbs it (that absorption is realized in Prompt 4's tiling reconstruction; noted
 * here so it isn't lost). Accepted with reason: a sentence trailing a lettered list is a
 * continuation/closing clause of the last item or of the parent obligation, and splitting a third
 * fragment there would shatter one obligation into pieces the matrix can't reason about. This
 * behavior was previously undocumented and unintentional; it is now documented and intentional.
 */
export function computeResidual(parent: Span, children: Span[]): Span | null {
  if (children.length === 0) return null;
  let firstStart = Infinity;
  for (const c of children) if (c.start < firstStart) firstStart = c.start;
  if (firstStart <= parent.start) return null;
  return { start: parent.start, end: firstStart };
}
