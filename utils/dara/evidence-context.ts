// Deterministic bounded-evidence selection for GenAI calls.
//
// The current DARA review paths repeatedly send the full proposal and solicitation to the
// provider. That is expensive, slow, and contrary to the evidence-first architecture. This
// module performs a deliberately conservative lexical retrieval pass before GenAI: it ranks
// overlapping text windows against the active requirement(s), then returns the highest-value
// windows within a fixed character budget.
//
// This is not the final semantic-retrieval layer. It is an immediately deployable bridge that
// reduces prompt size without adding another service or model dependency. The selector is kept
// deterministic so the same inputs and limits produce the same evidence package.

export interface EvidenceQuery {
  name: string;
  description?: string | null;
  farReference?: string | null;
}

export interface EvidenceSelectionOptions {
  /** Maximum characters returned, including evidence-window labels. */
  maxChars: number;
  /** Approximate source window size before overlap. */
  windowChars?: number;
  /** Characters of overlap between adjacent windows. */
  overlapChars?: number;
  /** Maximum number of ranked windows returned. */
  maxWindows?: number;
}

interface RankedWindow {
  index: number;
  start: number;
  end: number;
  text: string;
  score: number;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'are', 'been', 'before', 'being',
  'between', 'both', 'but', 'can', 'could', 'does', 'each', 'for', 'from', 'have', 'into',
  'must', 'not', 'only', 'other', 'over', 'proposal', 'provide', 'requirement', 'requirements',
  'shall', 'should', 'such', 'than', 'that', 'the', 'their', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'using', 'with', 'within', 'would'
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function queryTerms(queries: EvidenceQuery[]): { phrases: string[]; terms: string[] } {
  const phrases: string[] = [];
  const counts = new Map<string, number>();

  for (const q of queries) {
    const phrase = normalize(q.name);
    if (phrase.length >= 6) phrases.push(phrase);

    const source = `${q.name} ${q.description ?? ''} ${q.farReference ?? ''}`;
    for (const raw of normalize(source).split(' ')) {
      if (raw.length < 4 || STOP_WORDS.has(raw)) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }

  // Terms that occur across multiple requirements are useful for a batch, but very common words
  // are filtered above. Cap the list to keep scoring predictable on very large matrices.
  const terms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 80)
    .map(([term]) => term);

  return { phrases: phrases.slice(0, 30), terms };
}

function buildWindows(text: string, windowChars: number, overlapChars: number): RankedWindow[] {
  const clean = text.trim();
  if (!clean) return [];

  const windows: RankedWindow[] = [];
  const step = Math.max(500, windowChars - overlapChars);
  let index = 0;

  for (let start = 0; start < clean.length; start += step) {
    let end = Math.min(clean.length, start + windowChars);
    if (end < clean.length) {
      // Prefer a paragraph or line boundary so evidence remains readable and citations survive.
      const floor = Math.max(start + Math.floor(windowChars * 0.65), start);
      const paragraph = clean.lastIndexOf('\n\n', end);
      const line = clean.lastIndexOf('\n', end);
      const boundary = Math.max(paragraph, line);
      if (boundary >= floor) end = boundary;
    }

    const body = clean.slice(start, end).trim();
    if (body) windows.push({ index, start, end, text: body, score: 0 });
    index++;
    if (end >= clean.length) break;
  }

  return windows;
}

function scoreWindow(window: RankedWindow, phrases: string[], terms: string[]): number {
  const haystack = normalize(window.text);
  let score = 0;

  for (const phrase of phrases) {
    if (haystack.includes(phrase)) score += 18;
  }

  for (const term of terms) {
    let from = 0;
    let hits = 0;
    while (hits < 4) {
      const at = haystack.indexOf(term, from);
      if (at === -1) break;
      hits++;
      from = at + term.length;
    }
    score += hits;
  }

  // Keep document/section headers competitive because they provide provenance and context.
  if (/^=== .+ ===/m.test(window.text)) score += 2;
  if (/\b(section|volume|task|factor|subfactor|pws|sow)\b/i.test(window.text)) score += 1;
  return score;
}

/**
 * Select a bounded, deterministic evidence context for one or more requirements.
 *
 * Returns ranked source windows in source order so the model sees coherent evidence rather than
 * a relevance-sorted collage. When lexical matching is weak, includes the first source window as
 * a conservative fallback and clearly labels every selected window.
 */
export function selectEvidenceContext(
  text: string,
  queries: EvidenceQuery[],
  options: EvidenceSelectionOptions
): string {
  const maxChars = Math.max(2_000, options.maxChars);
  if (text.length <= maxChars) return text;

  const windowChars = Math.max(1_500, options.windowChars ?? 4_000);
  const overlapChars = Math.min(windowChars - 500, Math.max(0, options.overlapChars ?? 600));
  const maxWindows = Math.max(1, options.maxWindows ?? 10);
  const windows = buildWindows(text, windowChars, overlapChars);
  const { phrases, terms } = queryTerms(queries);

  for (const window of windows) {
    window.score = scoreWindow(window, phrases, terms);
  }

  const ranked = [...windows].sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: RankedWindow[] = [];
  let used = 0;

  for (const window of ranked) {
    if (selected.length >= maxWindows) break;
    const labelledLength = window.text.length + 80;
    if (used + labelledLength > maxChars && selected.length > 0) continue;
    selected.push(window);
    used += labelledLength;
  }

  // A weak lexical query should still carry source context rather than return an empty package.
  if (selected.length === 0 && windows.length > 0) selected.push(windows[0]);
  if (selected.every((w) => w.score === 0) && windows.length > 0 && !selected.includes(windows[0])) {
    selected.unshift(windows[0]);
  }

  selected.sort((a, b) => a.index - b.index);

  let output = '';
  for (const window of selected) {
    const block = `\n\n--- EVIDENCE WINDOW ${window.index + 1} (source chars ${window.start + 1}-${window.end}) ---\n${window.text}`;
    if (output.length + block.length > maxChars && output.length > 0) break;
    output += block;
  }

  return output.trim();
}
