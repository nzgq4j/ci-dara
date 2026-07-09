/**
 * spans.ts — deterministic-utility test harness (span-anchored requirement extraction).
 *
 * Pure functions, no DB/LLM/env — this exercises behavior, not just typecheck. Mirrors the
 * tiny check() harness in prisma/security/dara004-isolation-test.ts.
 *
 * RUN:   npx tsx utils/dara/spans.test.ts
 * EXIT:  0 if every check passes, 1 otherwise (CI-friendly).
 *
 * The offset-map + synthetic verifySpan tests run unconditionally. The REAL-fixture round-trip
 * (Prompt 2 §B) runs only when utils/dara/__fixtures__/pdf-extract.txt exists — it must be
 * captured from a PUBLIC SAM.gov RFP via unpdf (see capture script), never hand-typed and never
 * a tenant document. Until it exists, that block reports SKIP (not FAIL).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalize,
  verifySpan,
  windowize,
  mergeSpans,
  stitchFragments,
  computeResidual,
  classifyComposition,
  findEnumerators,
  clauseReference,
  deriveCitation,
  type Span,
  type TruncatableSpan
} from './spans';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`${GREEN}PASS${RESET} ${name}`);
  } else {
    failed++;
    console.log(`${RED}FAIL${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  }
}
function skip(name: string, why: string): void {
  skipped++;
  console.log(`${YELLOW}SKIP${RESET} ${name} ${DIM}— ${why}${RESET}`);
}
function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── normalize() + offset-map contract ─────────────────────────────────────────
// Exercises BOTH a ligature (1->2, "ﬁ") and a whitespace run (N->1). A hyphens-only fixture
// would have hidden a ligature-map bug, so this is deliberate.
{
  // raw: U+FB01(fi ligature) l e [3 spaces] t e s t  ->  "file test"
  // Layout: ﬁ(0) l(1) e(2) sp(3) sp(4) sp(5) t(6) e(7) s(8) t(9)   (raw length 10)
  const raw = 'ﬁle   test';
  const { text, map } = normalize(raw);
  check('normalize: ligature (1->2) + whitespace-run text', text === 'file test', `got "${text}"`);
  check('normalize: map length === text.length + 1', map.length === text.length + 1,
    `map=${map.length} text=${text.length}`);
  check('normalize: sentinel maps to raw length', map[text.length] === raw.length,
    `sentinel=${map[text.length]} rawLen=${raw.length}`);
  // Ligature 1->2: both 'f' and 'i' (normalized idx 0,1) map to the SAME raw index 0.
  check('normalize: ligature 1->2 both map to same raw index',
    map[0] === 0 && map[1] === 0, `map[0]=${map[0]} map[1]=${map[1]}`);
  check('normalize: char after ligature maps to raw+1', map[2] === 1, `map[2]=${map[2]}`);
  // Whitespace run N->1: the single space (normalized idx 4) maps to the FIRST ws raw index (3),
  // and the following 't' (normalized idx 5) maps past the whole run (raw 6).
  check('normalize: whitespace run collapses, maps to first ws index', map[4] === 3, `map[4]=${map[4]}`);
  check('normalize: char after ws-run maps past the run', map[5] === 6, `map[5]=${map[5]}`);
}

// ── verifySpan: symmetric hyphen, RAW offsets returned ─────────────────────────
{
  const raw = 'cost-\neffective services'; // hyphen + newline mid-word break
  const span = verifySpan(raw, 'cost-effective'); // model returns the clean hyphenated form
  check('verifySpan: line-broken hyphen matches clean quote', span !== null);
  if (span) {
    check('verifySpan: returns RAW start', span.start === 0, `start=${span.start}`);
    // end must cover the messy source INCLUDING the hyphen+newline, not the clean 13 chars.
    check('verifySpan: returns RAW end (messy source length)', span.end === 15, `end=${span.end}`);
    check('verifySpan: raw slice preserves the real hyphen',
      raw.slice(span.start, span.end) === 'cost-\neffective',
      `slice="${raw.slice(span.start, span.end)}"`);
  }
  // The three hyphen variants all key to the same normalized form.
  check('verifySpan: "costeffective" also matches the line-broken source',
    verifySpan(raw, 'costeffective') !== null);
  check('verifySpan: miss returns null', verifySpan(raw, 'nonexistent phrase') === null);
  check('verifySpan: empty quote returns null', verifySpan(raw, '   ') === null);
}

// ── windowize: correct at any n, full coverage ────────────────────────────────
{
  check('windowize: n=0 -> []', eq(windowize(0), []));
  check('windowize: sub-window -> single window',
    eq(windowize(100, 12000, 1500), [{ index: 0, start: 0, end: 100 }]));
  const ws = windowize(30000, 12000, 1500); // stride 10500, count ceil(28500/10500)=3
  check('windowize: multi-window count', ws.length === 3, `len=${ws.length}`);
  check('windowize: last window ends at n', ws[ws.length - 1].end === 30000, `end=${ws[ws.length - 1].end}`);
  // Coverage: every char index in [0,n) is inside at least one window.
  const n = 30000;
  let covered = true;
  for (let x = 0; x < n; x += 137) covered &&= ws.some((w) => x >= w.start && x < w.end);
  check('windowize: full coverage (no gaps)', covered);
  check('windowize: rejects overlap >= window', (() => {
    try { windowize(100, 100, 100); return false; } catch { return true; }
  })());
}

// ── mergeSpans: boundary straddle collapses, distinct spans survive ───────────
{
  type S = Span & { id: string };
  const merged = mergeSpans<S>([
    { start: 4400, end: 4700, id: 'a' }, // len 300 (longer)
    { start: 4450, end: 4720, id: 'b' }, // len 270 — overlaps a heavily
    { start: 9000, end: 9100, id: 'c' }  // distinct
  ]);
  check('mergeSpans: straddler collapses to one, distinct survives', merged.length === 2, `len=${merged.length}`);
  check('mergeSpans: union geometry', merged[0].start === 4400 && merged[0].end === 4720,
    `[${merged[0].start},${merged[0].end}]`);
  check('mergeSpans: keeps longer span metadata', merged[0].id === 'a', `id=${merged[0].id}`);
  check('mergeSpans: single/empty passthrough', mergeSpans([]).length === 0);
}

// ── stitchFragments: reassemble obligations split across window edges ─────────
{
  type S = TruncatableSpan & { id: string };
  // PWS 2.5 straddle (the case from the spec): a 2,967-char requirement at offset 4000 seen only
  // in fragments by two windows. window 0 -> [4000,6000) truncated; window 1 -> [4500,6967)
  // truncated; ranges overlap -> stitch to [4000,6967), the full requirement, no model judgment.
  const straddle = stitchFragments<S>([
    { start: 4000, end: 6000, truncated: true, id: 'a' }, // len 2000
    { start: 4500, end: 6967, truncated: true, id: 'b' }  // len 2467 (longer -> keeps metadata)
  ]);
  check('stitch: PWS 2.5 straddle reassembles to one span', straddle.length === 1, `len=${straddle.length}`);
  check('stitch: PWS 2.5 straddle geometry [4000,6967)',
    straddle[0] && straddle[0].start === 4000 && straddle[0].end === 6967,
    straddle[0] ? `[${straddle[0].start},${straddle[0].end}]` : 'none');
  check('stitch: reassembled span is marked complete', straddle[0] && straddle[0].truncated === false);
  check('stitch: keeps the longest fragment metadata', straddle[0] && straddle[0].id === 'b',
    straddle[0] ? `id=${straddle[0].id}` : 'none');

  check('stitch: complete span passes through untouched',
    eq(stitchFragments<S>([{ start: 10, end: 50, truncated: false, id: 'c' }]),
      [{ start: 10, end: 50, truncated: false, id: 'c' }]));

  // A truncated fragment overlapping a complete span is dropped (the complete one covers it).
  const dropped = stitchFragments<S>([
    { start: 100, end: 300, truncated: true, id: 'frag' },
    { start: 150, end: 250, truncated: false, id: 'whole' }
  ]);
  check('stitch: truncated fragment overlapping a complete span is dropped',
    dropped.length === 1 && dropped[0].id === 'whole', `n=${dropped.length}`);

  // A lonely truncated fragment survives — diagnostic that a requirement exceeds the window.
  const lonely = stitchFragments<S>([{ start: 100, end: 300, truncated: true, id: 'x' }]);
  check('stitch: lonely truncated fragment survives, still truncated',
    lonely.length === 1 && lonely[0].truncated === true && lonely[0].start === 100 && lonely[0].end === 300);

  // Transitive chaining across three abutting/overlapping fragments.
  const chain = stitchFragments<S>([
    { start: 0, end: 200, truncated: true, id: '1' },
    { start: 150, end: 400, truncated: true, id: '2' },
    { start: 380, end: 600, truncated: true, id: '3' }
  ]);
  check('stitch: transitive 3-fragment chain -> one span [0,600)',
    chain.length === 1 && chain[0].start === 0 && chain[0].end === 600 && chain[0].truncated === false,
    chain[0] ? `[${chain[0].start},${chain[0].end}]` : 'none');

  // NON-ABUTTING #1 — the overlap-zone margin. Windows g3=[31500,43500], g4=[42000,54000] overlap
  // on [42000,43500]. A model skipping 180 chars of debris at g4's start (fragment begins at 42180
  // instead of 42000) STILL overlaps g3's fragment (which reaches ~43500), so it stitches. Recovery
  // does NOT require exact edge-quoting — only quoting to within OVERLAP of the edge.
  const smallSkip = stitchFragments<S>([
    { start: 41000, end: 43500, truncated: true, id: 'g3' }, // reaches its window edge
    { start: 42180, end: 44000, truncated: true, id: 'g4' }  // skipped 180 chars at the start
  ]);
  check('stitch: small skip within the overlap zone still stitches',
    smallSkip.length === 1 && smallSkip[0].start === 41000 && smallSkip[0].end === 44000 &&
    smallSkip[0].truncated === false,
    smallSkip[0] ? `[${smallSkip[0].start},${smallSkip[0].end}]` : 'none');

  // NON-ABUTTING #2 — the pathological gap. Only if the model under-quotes by MORE than the overlap
  // width (g3's fragment ends 1700 chars short of its edge) does a real gap open. PINNED behavior:
  // two orphan rows survive, BOTH still truncated:true (so both are logged + written), and the gap
  // [41800,42180] is lost. Not one wrong row, not silently dropped — two visible partial rows.
  const gap = stitchFragments<S>([
    { start: 41000, end: 41800, truncated: true, id: 'g3' }, // under-quoted: 1700 short of 43500
    { start: 42180, end: 44000, truncated: true, id: 'g4' }
  ]);
  check('stitch: gap wider than overlap -> TWO orphans, both still truncated',
    gap.length === 2 && gap.every((s) => s.truncated === true) &&
    gap[0].start === 41000 && gap[0].end === 41800 &&
    gap[1].start === 42180 && gap[1].end === 44000,
    `n=${gap.length} truncated=${gap.map((s) => s.truncated).join(',')}`);
}

// ── computeResidual ───────────────────────────────────────────────────────────
{
  check('computeResidual: leading gap',
    eq(computeResidual({ start: 0, end: 1000 }, [{ start: 200, end: 400 }, { start: 400, end: 600 }]),
      { start: 0, end: 200 }));
  check('computeResidual: null when first child flush with parent start',
    computeResidual({ start: 0, end: 1000 }, [{ start: 0, end: 300 }]) === null);
  check('computeResidual: null with no children',
    computeResidual({ start: 0, end: 1000 }, []) === null);
}

// ── classifyComposition: three states ─────────────────────────────────────────
{
  const enums = (k: number) => Array.from({ length: k }, (_, i) => ({ marker: `(${i})`, index: i }));
  check('classify: >=3 enumerators -> compound/enumeration',
    eq(classifyComposition('', enums(3), 5),
      { composition: 'compound', enumeratorCount: 3, obligationCount: 5, path: 'enumeration' }));
  check('classify: null obligations -> unclassified/none',
    eq(classifyComposition('', enums(0), null),
      { composition: 'unclassified', enumeratorCount: 0, obligationCount: null, path: 'none' }));
  check('classify: <=1 obligation, few enumerators -> atomic/none',
    eq(classifyComposition('', enums(1), 1),
      { composition: 'atomic', enumeratorCount: 1, obligationCount: 1, path: 'none' }));
  check('classify: 2-3 obligations, few enumerators -> unclassified/tiling',
    eq(classifyComposition('', enums(1), 2),
      { composition: 'unclassified', enumeratorCount: 1, obligationCount: 2, path: 'tiling' }));
}

// ── clauseReference: deterministic length-gated collapse ──────────────────────
{
  const longClause =
    'FAR 52.222-41 Service Contract Labor Standards. ' +
    'The Contractor shall pay all service employees no less than the wages and fringe benefits ' +
    'determined by the Department of Labor, shall post the wage determination, shall maintain ' +
    'records for three years, shall comply with all provisions herein, shall notify the ' +
    'Contracting Officer of any disputes, and shall provide notice to affected employees of the ' +
    'applicable wage determination as required by the clause and its subparagraphs.';
  check('clauseReference: bare FAR citation collapses',
    clauseReference('Comply with FAR 52.212-5 as applicable.') === '52.212-5');
  check('clauseReference: bare DFARS citation collapses',
    clauseReference('See DFARS 252.204-7012.') === '252.204-7012');
  check('clauseReference: long substantive text does NOT collapse',
    longClause.length > 400 && clauseReference(longClause) === null,
    `len=${longClause.length}`);
  check('clauseReference: no clause number -> null',
    clauseReference('The offeror shall provide a plan.') === null);
}

// ── deriveCitation: nearest preceding heading (slices RAW) ────────────────────
{
  const raw = 'Section L.4.2 Volume Structure\nThe offeror shall submit a technical volume.';
  const span = verifySpan(raw, 'The offeror shall submit a technical volume.');
  check('deriveCitation: finds nearest heading', span !== null && deriveCitation(raw, span) === 'Section L.4.2',
    span ? `got "${deriveCitation(raw, span)}"` : 'span not found');
}

// ── findEnumerators: counts lettered/numbered markers ─────────────────────────
{
  const raw = 'The offeror shall: (a) do X; (b) do Y; (c) do Z.';
  check('findEnumerators: counts (a)(b)(c)', findEnumerators(raw).length === 3,
    `count=${findEnumerators(raw).length}`);
}

// ── REAL-fixture round-trip (Prompt 2 §B) — guarded until a PDF is supplied ────
{
  const fixturePath = join(__dirname, '__fixtures__', 'pdf-extract.txt');
  if (!existsSync(fixturePath)) {
    skip('verifySpan: real unpdf fixture round-trip',
      'utils/dara/__fixtures__/pdf-extract.txt absent — supply a PUBLIC SAM.gov RFP and run the capture script');
  } else {
    const fixture = readFileSync(fixturePath, 'utf8');
    // Find a raw span straddling a mid-word line break ("...-\n<lowercase>...").
    const brk = fixture.search(/[a-z]-\n[a-z]/);
    if (brk < 0) {
      skip('verifySpan: real unpdf fixture round-trip',
        'fixture contains no mid-word line break — recapture a sample that does');
    } else {
      // Take ~40 raw chars around the break as the "source span", build the model-cleaned quote.
      const rawSpan = fixture.slice(Math.max(0, brk - 10), brk + 30);
      const cleaned = normalize(rawSpan).text.trim();
      const span = verifySpan(fixture, cleaned);
      check('verifySpan: real fixture — model-cleaned quote matches', span !== null);
      if (span) {
        // Must return RAW offsets: the raw slice normalizes back to the same cleaned key.
        check('verifySpan: real fixture — returns RAW offsets (round-trips)',
          normalize(fixture.slice(span.start, span.end)).text.trim() === cleaned);
        check('verifySpan: real fixture — raw slice differs from cleaned (proves rawness)',
          fixture.slice(span.start, span.end) !== cleaned ||
          !/[a-z]-\n[a-z]/.test(rawSpan), // if the break is inside the span, slice keeps it
          'expected the raw slice to retain PDF artifacts');
      }
    }
  }
}

// ── stitchFragments on REAL fixture text (Prompt 2 §B) — guarded until a PDF ───
// Simulate a long obligation straddling two overlapping windows over real extracted text, and
// assert the reassembled [start,end) slices back to the full region — real offsets, no model.
{
  const fixturePath = join(__dirname, '__fixtures__', 'pdf-extract.txt');
  if (!existsSync(fixturePath)) {
    skip('stitch: real-fixture straddle reassembles full region', 'fixture absent (see capture script)');
  } else {
    const fixture = readFileSync(fixturePath, 'utf8');
    const p = 100;
    if (fixture.length < p + 3000) {
      skip('stitch: real-fixture straddle reassembles full region', 'fixture shorter than 3100 chars');
    } else {
      type S = TruncatableSpan;
      // Region [p, p+2500) is our "long requirement". Window A=[p-100,p+1500) sees its head
      // (truncated right); window B=[p+1000,p+3000) sees its tail (truncated left).
      const fragA: S = { start: p, end: p + 1500, truncated: true };
      const fragB: S = { start: p + 1000, end: p + 2500, truncated: true };
      const out = stitchFragments<S>([fragA, fragB]);
      check('stitch: real-fixture straddle reassembles full region',
        out.length === 1 && out[0].start === p && out[0].end === p + 2500 &&
        fixture.slice(out[0].start, out[0].end) === fixture.slice(p, p + 2500));
    }
  }
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
