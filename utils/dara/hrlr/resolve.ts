// Deterministic resolution over the parsed nodes. Nothing here calls the model — it assigns the
// stable LOGICAL identity and the derived PRESENTATION identity, repairs/validates the graph, and
// detects where the document's SOURCE numbering contradicts the reconstructed logical hierarchy.
//
// The three identities are kept strictly separate (HRLR core doctrine):
//   provenance.originalMarker  = SOURCE identity  (never rewritten here)
//   logicalId (REQ-XXXXXX)     = LOGICAL identity (assigned by extraction order, stable)
//   syntheticPath (R-n.n)      = PRESENTATION identity (derived by walking the resolved tree)

import type { CoverageGap, NumberingConflict, RequirementGraph, RequirementNode } from './types';

function reqId(seq: number): string {
  return 'REQ-' + String(seq).padStart(6, '0');
}

// Pull a dotted numeric marker (e.g. "4.2.1" from "4.2.1(a)") for conflict analysis; '' if none.
function dottedNumber(marker: string): string {
  const m = marker.match(/\b(\d+(?:\.\d+)+|\d+)\b/);
  return m ? m[1] : '';
}

// Normalize a section marker for cross-comparison: collapse internal whitespace, trim, strip trailing
// periods. Applied IDENTICALLY to source-scanned markers and emitted node markers so the coverage
// diff and the fragment grouping compare like with like (e.g. source "2.4.1." == emitted "2.4.1").
function normalizeMarker(marker: string): string {
  return marker.replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trim();
}

// Scan the raw source for its own structural markers (decimal outline, lettered items, parenthetical
// clause numbers, bullet-list items, and roman numeral section headers). Returns each normalized
// marker mapped to the char offset of its first occurrence (used to slice review context for a gap).
function scanSourceMarkers(sourceText: string): Map<string, number> {
  const patterns = [
    /^\s*\d+(\.\d+)+[.\s]/gm,      // decimal outline numbers, e.g. "2.4.1."
    /^\s*\(?[a-z]\)[.\s]/gm,        // lettered list items, e.g. "(a)" / "a)"
    /^\s*\(\d+\)/gm,                // parenthetical clause numbers, e.g. "(1)"
    /^\s*[•\-–]\s+.{10,}/gm,       // bullet items with substantive text (10+ chars after bullet)
    /^\s*(?:I{1,3}|IV|VI{0,3}|IX|X{0,3}I{0,3})[.\s]+[A-Z]/gm // Roman numeral sections
  ];
  const markers = new Map<string, number>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(sourceText)) !== null) {
      const marker = normalizeMarker(m[0]);
      if (marker && !markers.has(marker)) markers.set(marker, m.index);
      if (m.index === re.lastIndex) re.lastIndex++; // zero-length-match guard
    }
  }
  return markers;
}

// COVERAGE-GAP DETECTOR — diff the markers physically present in the source against the markers the
// model actually emitted. Every source marker with no extracted node is a gap (the model dropped a
// requirement). Flag it; do not attempt re-extraction here (out of scope for this pass).
function detectCoverageGaps(nodes: RequirementNode[], sourceText: string): CoverageGap[] {
  const sourceMarkers = scanSourceMarkers(sourceText);
  const emitted = new Set<string>();
  for (const n of nodes) {
    const norm = normalizeMarker(n.provenance.originalMarker || '');
    if (norm) emitted.add(norm);
  }

  const gaps: CoverageGap[] = [];
  for (const [marker, index] of Array.from(sourceMarkers.entries())) {
    if (emitted.has(marker)) continue;
    const ctxStart = Math.max(0, index - 30);
    gaps.push({
      type: 'coverageGap',
      sourceMarker: marker,
      rawContext: sourceText.slice(ctxStart, ctxStart + 300),
      detectedAt: 'resolveGraph',
      status: 'UNEXTRACTED'
    });
    console.warn(
      `[HRLR] Coverage gap detected: source marker §${marker} present in document, not found in extracted nodes.`
    );
  }
  console.log(`[HRLR] Coverage gap detection complete. ${gaps.length} gap(s) found.`);
  return gaps;
}

// Which fragment signal (if any) marks a node as a probable mis-split. Returns the reason, or null.
function fragmentSignal(n: RequirementNode): string | null {
  const t = n.exactText;
  const hasObligation = /\b(shall|must)\b/i.test(t);
  if (t.length < 120) return 'exact_text under 120 characters';
  if (/^\s*\(.*\)\s*$/.test(t)) return 'bare parenthetical';
  if (/CDRL\s+[A-Z]\d+/i.test(t) && !hasObligation) return 'CDRL tag without an obligation verb';
  if (/^see\s+section/i.test(t) && !hasObligation) return '"see section" cross-reference without an obligation verb';
  return null;
}

// SAME-MARKER FRAGMENT DETECTOR — when the model emits more than one node under a single source
// marker, the short/parenthetical/reference ones are likely a real requirement broken apart (e.g. a
// trailing "(CDRL A005)" split off from its sentence). Flag them with a merge candidate (the longest
// node under that marker). Flag only — never delete or merge; the reviewer decides.
function detectFragments(nodes: RequirementNode[]): void {
  const groups = new Map<string, RequirementNode[]>();
  for (const n of nodes) {
    const norm = normalizeMarker(n.provenance.originalMarker || '');
    if (!norm) continue; // only group nodes that actually carry a source marker
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(n);
  }

  for (const [marker, group] of Array.from(groups.entries())) {
    if (group.length < 2) continue;
    const longest = group.reduce((a, b) => (b.exactText.length > a.exactText.length ? b : a));
    for (const n of group) {
      if (n.logicalId === longest.logicalId) continue; // don't flag the merge target against itself
      const reason = fragmentSignal(n);
      if (!reason) continue;
      n.fragmentStatus = 'PROBABLE_SPLIT';
      n.fragmentReason = reason;
      n.fragmentMergeCandidate = longest.logicalId;
      console.warn(
        `[HRLR] Fragment detected: node ${n.logicalId} (source §${marker}) flagged as probable mis-split. ` +
          `Merge candidate: ${longest.logicalId}.`
      );
    }
  }
}

/**
 * Resolve a parsed node list into a full graph:
 *  - validate parent/child references and break cycles,
 *  - repair `state` from the actual resolved topology,
 *  - assign stable logicalIds and derived syntheticPaths,
 *  - flag satisfaction/verbatim/marker anomalies,
 *  - detect source-vs-logical numbering conflicts.
 */
export function resolveGraph(
  nodes: RequirementNode[],
  docKind: 'solicitation' | 'response',
  documentName: string,
  sourceText?: string
): RequirementGraph {
  const byKey = new Map<string, RequirementNode>();
  for (const n of nodes) if (!byKey.has(n.key)) byKey.set(n.key, n);

  // 1. Validate parent references; drop dangling ones (flag the node).
  for (const n of nodes) {
    if (n.parentKey && !byKey.has(n.parentKey)) {
      n.flags.push(`dangling parent key "${n.parentKey}" (dropped)`);
      n.parentKey = null;
    }
    n.childKeys = n.childKeys.filter((k) => {
      if (byKey.has(k)) return true;
      n.flags.push(`dangling child key "${k}" (dropped)`);
      return false;
    });
  }

  // 2. Reconcile parent<->child agreement. Parent link is authoritative; back-fill children lists.
  const childrenOf = new Map<string, RequirementNode[]>();
  for (const n of nodes) childrenOf.set(n.key, []);
  for (const n of nodes) {
    if (n.parentKey) childrenOf.get(n.parentKey)!.push(n);
  }
  // Also honor a parent that listed children which didn't set their own parent.
  for (const n of nodes) {
    for (const ck of n.childKeys) {
      const child = byKey.get(ck)!;
      if (!child.parentKey) {
        child.parentKey = n.key;
        childrenOf.get(n.key)!.push(child);
      }
    }
  }

  // 3. Break cycles: if following parents loops, cut the offending link.
  for (const n of nodes) {
    const seen = new Set<string>();
    let cur: RequirementNode | undefined = n;
    while (cur && cur.parentKey) {
      if (seen.has(cur.key)) {
        cur.flags.push(`cycle detected; parent link "${cur.parentKey}" cut`);
        const stranded = cur;
        childrenOf.set(stranded.parentKey!, (childrenOf.get(stranded.parentKey!) ?? []).filter((c) => c.key !== stranded.key));
        stranded.parentKey = null;
        break;
      }
      seen.add(cur.key);
      cur = cur.parentKey ? byKey.get(cur.parentKey) : undefined;
    }
  }

  // 4. Repair structural state from the resolved topology (explicit, not model-trusted).
  for (const n of nodes) {
    const hasChildren = (childrenOf.get(n.key) ?? []).length > 0;
    const hasParent = n.parentKey !== null;
    const repaired: RequirementNode['state'] = hasChildren && hasParent
      ? 'PARENT_AND_CHILD'
      : hasChildren
        ? 'PARENT_WITH_CHILDREN'
        : hasParent
          ? 'CHILD'
          : 'STANDALONE';
    // Preserve an explicit UNRESOLVED only when the topology is genuinely a leaf/root with no signal.
    if (n.state !== repaired && !(n.state === 'UNRESOLVED' && !hasChildren && !hasParent)) {
      if (n.state !== repaired) n.flags.push(`state ${n.state} -> ${repaired} (from topology)`);
      n.state = repaired;
    }
  }

  // 5. Satisfaction-rule sanity.
  for (const n of nodes) {
    const hasChildren = (childrenOf.get(n.key) ?? []).length > 0;
    if (hasChildren && (n.satisfaction.kind === 'NONE' || n.satisfaction.kind === 'UNRESOLVED')) {
      n.flags.push('has children but satisfaction rule is ' + n.satisfaction.kind + ' — needs review');
    }
    if (!hasChildren && n.satisfaction.kind !== 'NONE') {
      n.satisfaction = { ...n.satisfaction, kind: 'NONE', n: null };
    }
    if (n.satisfaction.kind === 'AT_LEAST_N' && !n.satisfaction.n) {
      n.flags.push('AT_LEAST_N without a threshold n');
    }
    if (!n.provenance.verbatimVerified) {
      n.flags.push('exact_text not found verbatim in source — provenance UNVERIFIED');
    }
  }

  // 6. Order nodes for stable logical IDs: by source span when known, else original array order.
  const order = [...nodes];
  order.sort((a, b) => {
    const sa = a.provenance.spanStart ?? Number.MAX_SAFE_INTEGER;
    const sb = b.provenance.spanStart ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return nodes.indexOf(a) - nodes.indexOf(b);
  });
  order.forEach((n, i) => {
    n.logicalId = reqId(i + 1);
  });

  // 7. Assign synthetic presentation paths by walking the resolved tree in document order.
  const roots = order.filter((n) => n.parentKey === null);
  const assignPaths = (list: RequirementNode[], prefix: string) => {
    // list already in document order via `order`
    let i = 0;
    for (const n of list) {
      i++;
      n.syntheticPath = prefix ? `${prefix}.${i}` : `R-${i}`;
      const kids = (childrenOf.get(n.key) ?? []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
      if (kids.length) assignPaths(kids, n.syntheticPath);
    }
  };
  assignPaths(roots.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)), '');

  // 8. Detect source-vs-logical numbering conflicts: a child whose source number is NOT a numeric
  //    descendant of its parent's source number (e.g. parent 4.1, child 4.2 — peers, not 4.1.x).
  const numberingConflicts: NumberingConflict[] = [];
  for (const n of nodes) {
    if (!n.parentKey) continue;
    const parent = byKey.get(n.parentKey)!;
    const pn = dottedNumber(parent.provenance.originalMarker);
    const cn = dottedNumber(n.provenance.originalMarker);
    if (pn && cn && !cn.startsWith(pn + '.')) {
      const note = `source numbering "${cn}" is not subordinate to parent "${pn}" (kept as evidence; logical link preserved)`;
      n.flags.push('SOURCE/LOGICAL numbering conflict: ' + note);
      numberingConflicts.push({ childId: n.logicalId, parentId: parent.logicalId, note });
    }
  }

  // 9. Coverage-gap detection — source markers with no extracted node. Needs the raw source text;
  //    when it isn't supplied (a caller that only has the node list) the check is skipped -> [].
  const coverageGaps = sourceText != null ? detectCoverageGaps(order, sourceText) : [];

  // 10. Same-marker fragment detection — probable mis-splits (e.g. a "(CDRL A005)" tag emitted as its
  //     own node). Runs on the emitted nodes only; logicalIds are already assigned above.
  detectFragments(order);

  const stats = {
    total: nodes.length,
    standalone: nodes.filter((n) => n.state === 'STANDALONE').length,
    parents: nodes.filter((n) => n.state === 'PARENT_WITH_CHILDREN' || n.state === 'PARENT_AND_CHILD').length,
    children: nodes.filter((n) => n.state === 'CHILD' || n.state === 'PARENT_AND_CHILD').length,
    unresolved: nodes.filter((n) => n.state === 'UNRESOLVED').length,
    unverified: nodes.filter((n) => !n.provenance.verbatimVerified).length
  };

  return { docKind, documentName, nodes: order, numberingConflicts, coverageGaps, stats };
}
