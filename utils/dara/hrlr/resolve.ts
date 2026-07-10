// Deterministic resolution over the parsed nodes. Nothing here calls the model — it assigns the
// stable LOGICAL identity and the derived PRESENTATION identity, repairs/validates the graph, and
// detects where the document's SOURCE numbering contradicts the reconstructed logical hierarchy.
//
// The three identities are kept strictly separate (HRLR core doctrine):
//   provenance.originalMarker  = SOURCE identity  (never rewritten here)
//   logicalId (REQ-XXXXXX)     = LOGICAL identity (assigned by extraction order, stable)
//   syntheticPath (R-n.n)      = PRESENTATION identity (derived by walking the resolved tree)

import type { NumberingConflict, RequirementGraph, RequirementNode } from './types';

function reqId(seq: number): string {
  return 'REQ-' + String(seq).padStart(6, '0');
}

// Pull a dotted numeric marker (e.g. "4.2.1" from "4.2.1(a)") for conflict analysis; '' if none.
function dottedNumber(marker: string): string {
  const m = marker.match(/\b(\d+(?:\.\d+)+|\d+)\b/);
  return m ? m[1] : '';
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
  documentName: string
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

  const stats = {
    total: nodes.length,
    standalone: nodes.filter((n) => n.state === 'STANDALONE').length,
    parents: nodes.filter((n) => n.state === 'PARENT_WITH_CHILDREN' || n.state === 'PARENT_AND_CHILD').length,
    children: nodes.filter((n) => n.state === 'CHILD' || n.state === 'PARENT_AND_CHILD').length,
    unresolved: nodes.filter((n) => n.state === 'UNRESOLVED').length,
    unverified: nodes.filter((n) => !n.provenance.verbatimVerified).length
  };

  return { docKind, documentName, nodes: order, numberingConflicts, stats };
}
