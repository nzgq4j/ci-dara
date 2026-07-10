// Human-readable renderers for a resolved requirement graph: a logical tree (with satisfaction
// annotations) and a flat compliance matrix. Pure string builders — no I/O.

import type { RequirementGraph, RequirementNode } from './types';

function satLabel(n: RequirementNode): string {
  const s = n.satisfaction;
  if (s.kind === 'NONE') return '';
  const th = s.kind === 'AT_LEAST_N' && s.n ? `(${s.n})` : '';
  return ` [${s.kind}${th} · ${s.basis}]`;
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

/** Indented logical tree, annotated with source markers, states, and satisfaction rules. */
export function renderTree(graph: RequirementGraph): string {
  const childrenOf = new Map<string, RequirementNode[]>();
  for (const n of graph.nodes) childrenOf.set(n.logicalId, []);
  const idByKey = new Map(graph.nodes.map((n) => [n.key, n.logicalId] as const));
  for (const n of graph.nodes) {
    if (n.parentKey) {
      const pid = idByKey.get(n.parentKey);
      if (pid) childrenOf.get(pid)!.push(n);
    }
  }
  const roots = graph.nodes.filter((n) => n.parentKey === null);
  const lines: string[] = [];
  const walk = (n: RequirementNode, depth: number) => {
    const pad = '  '.repeat(depth);
    const marker = n.provenance.originalMarker || '(unnumbered)';
    const verify = n.provenance.verbatimVerified ? '' : ' ⚠UNVERIFIED';
    lines.push(
      `${pad}${n.syntheticPath}  «${marker}»  ${n.logicalId}  [${n.state}]${satLabel(n)}${verify}\n` +
        `${pad}    ${truncate(n.exactText || n.normalizedMeaning, 140)}`
    );
    for (const c of childrenOf.get(n.logicalId)!) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return lines.join('\n');
}

/** Flat compliance matrix (Markdown). Every node is a row; parents included (they may carry an
 *  independent obligation and always anchor their children's rollup). */
export function renderMatrix(graph: RequirementGraph): string {
  // Summary block: always shown (even at 0) so a reviewer can confirm the coverage check ran.
  const summary = `**Coverage gaps detected: ${graph.coverageGaps.length}** (see coverageGaps in graph output)`;
  const head =
    '| Logical ID | Source Ref | Path | Requirement | Mand. | State | Satisfaction | Eval | Class | Disp | Conf | Flags |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = graph.nodes.map((n) => {
    const cells = [
      n.logicalId,
      n.provenance.originalMarker || '—',
      n.syntheticPath,
      truncate(n.exactText || n.normalizedMeaning, 90).replace(/\|/g, '\\|'),
      n.mandatory === 'MANDATORY' ? 'Y' : n.mandatory === 'CONDITIONAL' ? 'C' : 'N',
      n.state,
      n.satisfaction.kind === 'NONE' ? '—' : n.satisfaction.kind + (n.satisfaction.n ? `(${n.satisfaction.n})` : ''),
      n.evalScope,
      n.source,
      n.disposition,
      n.confidence[0],
      n.flags.length ? String(n.flags.length) : ''
    ];
    return '| ' + cells.join(' | ') + ' |';
  });
  return [summary, '', head, ...rows].join('\n');
}

/** Everything the model was unsure about, plus source/logical numbering conflicts. */
export function renderReviewQueue(graph: RequirementGraph): string {
  const flagged = graph.nodes.filter((n) => n.flags.length > 0);
  const out: string[] = [];
  out.push(`### Review queue (${flagged.length} node(s) flagged)`);
  for (const n of flagged) {
    out.push(`- ${n.logicalId} «${n.provenance.originalMarker || 'unnumbered'}» (${n.syntheticPath})`);
    for (const f of n.flags) out.push(`    - ${f}`);
  }
  if (graph.numberingConflicts.length) {
    out.push('');
    out.push(`### Source ↔ logical numbering conflicts (${graph.numberingConflicts.length})`);
    for (const c of graph.numberingConflicts) out.push(`- ${c.childId} under ${c.parentId}: ${c.note}`);
  }
  return out.join('\n');
}

export function renderReport(graph: RequirementGraph): string {
  const s = graph.stats;
  return (
    `# HRLR — ${graph.docKind} · ${graph.documentName}\n\n` +
    `**${s.total}** nodes · ${s.standalone} standalone · ${s.parents} parents · ${s.children} children · ` +
    `${s.unresolved} unresolved · ${s.unverified} unverified provenance\n\n` +
    `## Logical tree\n\n\`\`\`\n${renderTree(graph)}\n\`\`\`\n\n` +
    `## Compliance matrix\n\n${renderMatrix(graph)}\n\n` +
    `## ${renderReviewQueue(graph)}\n`
  );
}
