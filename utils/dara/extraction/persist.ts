// Persist the pipeline output to dara_requirements (maps to existing columns + the hrlr JSONB bundle).
//
// No schema change on dara_requirements: pipeline-specific fields (title, normalizedMeaning,
// sourceAnchor, conditionalTriggerIds, conditions, ibrFlags, citationChain, traversalDepth,
// versionResolved, passOrigin) live in the hrlr JSONB. Parent links (parentCandidateId → parentId) are
// wired in a second pass after ids exist, correlated by candidateId via sortOrder.

import { withTenant } from '@/utils/prisma';
import type { VerifiedCandidate, ExtractedRequirement } from './types';
import { llmSourceToDb, deriveReviewStatus } from './types';

const CLAUSE_NUM = /\b(\d{2,3}\.\d{3}(?:-\d{1,4})?)\b/;

/** Map a verified (Pass 1/2) candidate to the persist row shape. Assumes classification.isRequirement. */
export function verifiedToExtracted(v: VerifiedCandidate): ExtractedRequirement {
  const c = v.classification;
  const source = llmSourceToDb(c.source);
  const flags: string[] = [];
  if (v.subjectInferred) flags.push('subject_inferred');
  if (v.duplicateSourceIds.length) flags.push(`merged:${v.duplicateSourceIds.length}`);
  const far = (v.sourceText.match(CLAUSE_NUM) ?? [''])[0];
  return {
    candidateId: v.candidateId,
    title: c.title,
    description: v.sourceText,
    normalizedMeaning: c.normalizedMeaning,
    source,
    disposition: c.disposition,
    citation: (v.sectionPath || '').slice(0, 200),
    farReference: source === 'far_clause' ? far : '',
    sourceAnchor: v.sentenceId || null,
    sectionId: v.sectionId,
    pageNumber: v.pageNumber,
    parentCandidateId: c.parentCandidateId,
    confidence: c.confidence,
    verbatimVerified: v.verbatimVerified,
    reviewStatus: deriveReviewStatus(c.confidence, v.verbatimVerified, flags),
    flags,
    conditionalTriggerIds: v.conditionalTriggerIds,
    conditions: v.conditions,
    ibrFlags: v.ibrFlagIds,
    citationChain: [],
    traversalDepth: 0,
    versionResolved: false,
    passOrigin: v.candidateId.startsWith('cond-') ? 2 : 1,
    documentId: null
  };
}

export interface PersistResult {
  count: number;
}

/**
 * Insert all requirements for a solicitation, then wire parent links. Runs inside withTenant so RLS
 * applies. `base` sortOrder is computed from the current max so a re-run appends deterministically.
 */
export async function persistRequirements(
  rows: ExtractedRequirement[],
  solicitationId: bigint,
  companyId: bigint,
  userId?: string
): Promise<PersistResult> {
  if (rows.length === 0) return { count: 0 };

  return withTenant(companyId, async (tx) => {
    const agg = await tx.requirement.aggregate({
      _max: { sortOrder: true },
      where: { solicitationId, companyId, removedAt: null }
    });
    const base = (agg._max.sortOrder ?? -1) + 1;

    const data = rows.map((r, i) => ({
      companyId,
      solicitationId,
      name: r.title.slice(0, 300),
      description: r.description || r.normalizedMeaning || null,
      source: r.source as any,
      isScored: r.disposition === 'scored',
      disposition: r.disposition as any,
      farReference: r.farReference.slice(0, 100),
      citation: r.citation.slice(0, 200),
      citationSynthesized: r.citation === '',
      weight: 0,
      complianceStatus: (r.disposition === 'administrative' ? 'not_applicable' : 'not_assessed') as any,
      reviewStatus: r.reviewStatus as any,
      governingFactors: [] as string[],
      documentId: r.documentId ?? null,
      composition: null,
      rollupMode: null,
      decompositionSource: 'multipass',
      hrlr: {
        title: r.title,
        normalizedMeaning: r.normalizedMeaning,
        sourceAnchor: r.sourceAnchor,
        sectionId: r.sectionId,
        page: r.pageNumber,
        confidence: r.confidence,
        verbatimVerified: r.verbatimVerified,
        flags: r.flags,
        conditionalTriggerIds: r.conditionalTriggerIds,
        conditions: r.conditions,
        ibrFlags: r.ibrFlags,
        citationChain: r.citationChain,
        traversalDepth: r.traversalDepth,
        versionResolved: r.versionResolved,
        passOrigin: r.passOrigin
      } as unknown as object,
      sortOrder: base + i
    }));

    await tx.requirement.createMany({ data });

    // Second pass: wire parentCandidateId → parentId, correlating by candidateId via sortOrder.
    const sortByCandidate = new Map<string, number>();
    rows.forEach((r, i) => sortByCandidate.set(r.candidateId, base + i));

    const inserted = await tx.requirement.findMany({
      where: { solicitationId, companyId, sortOrder: { gte: base } },
      select: { id: true, sortOrder: true }
    });
    const idBySort = new Map(inserted.map((x) => [x.sortOrder, x.id] as const));

    let childOrder = 0;
    for (let i = 0; i < rows.length; i++) {
      const parentCid = rows[i].parentCandidateId;
      if (!parentCid) continue;
      const parentSort = sortByCandidate.get(parentCid);
      if (parentSort === undefined) continue;
      const childId = idBySort.get(base + i);
      const parentId = idBySort.get(parentSort);
      if (!childId || !parentId || childId === parentId) continue;
      await tx.requirement.update({ where: { id: childId }, data: { parentId, childOrder: childOrder++ } });
    }

    return { count: inserted.length };
  });
}
