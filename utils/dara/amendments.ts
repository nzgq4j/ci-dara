// Amendment reconciliation engine. An amendment's documents are AI-diffed against the
// current compliance matrix into proposed changes; accepting a change folds it into the
// matrix, versioning a modified requirement or marking a removed one (retained, never
// deleted). Mirrors the evaluator's burst pattern — the LLM call runs OUTSIDE any
// tenant transaction.

import { Prisma } from '@prisma/client';
import { withTenant } from '@/utils/prisma';
import { decryptField } from '@/utils/dara/crypto';
import { buildAmendmentDiffPrompt, parseAmendmentDiff } from '@/utils/dara/prompt';
import { complete, resolveCompanyAI } from '@/utils/dara/providers';
import { getPlatformAI } from '@/utils/dara/platform-ai';

// Generous headroom so a large diff's JSON isn't truncated; parseAmendmentDiff also
// salvages complete changes from a truncated array as a backstop.
const DIFF_MAX_TOKENS = 16000;

export interface ReconcileSummary {
  ok: boolean;
  changes: number;
  error?: string;
}

interface DocFile {
  originalFilename: string;
  extractedText: string | null;
  extractionStatus: string;
}

function concatDocs(files: DocFile[]): string {
  return files
    .filter((f) => f.extractionStatus === 'complete')
    .map((f) => ({ name: f.originalFilename, text: decryptField(f.extractedText) }))
    .filter((d) => d.text.trim() !== '')
    .map((d) => `=== ${d.name} ===\n\n${d.text}`)
    .join('\n\n');
}

/**
 * AI-diff an amendment against the current (active) compliance matrix, replacing any
 * prior un-resolved proposals with the freshly proposed changes.
 */
export async function reconcileAmendment(
  amendmentId: bigint,
  companyId: bigint
): Promise<ReconcileSummary> {
  const loaded = await withTenant(companyId, async (tx) => {
    const amendment = await tx.amendment.findFirst({
      where: { id: amendmentId, companyId },
      include: { documents: true }
    });
    if (!amendment) return null;
    const company = await tx.company.findUnique({ where: { id: companyId } });
    const requirements = await tx.requirement.findMany({
      where: { solicitationId: amendment.solicitationId, companyId, removedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    return { amendment, company, requirements };
  });

  if (!loaded?.amendment) return { ok: false, changes: 0, error: 'Amendment not found.' };
  if (!loaded.company) return { ok: false, changes: 0, error: 'Company not found.' };

  const amendmentText = concatDocs(loaded.amendment.documents);
  if (amendmentText.trim() === '') {
    return {
      ok: false,
      changes: 0,
      error: 'No extracted amendment text. Upload the amendment document and wait for extraction.'
    };
  }

  const platform = loaded.company.aiKeyMode === 'platform' ? await getPlatformAI() : undefined;
  const { provider, model, apiKey } = resolveCompanyAI(loaded.company, platform);
  if (!apiKey) return { ok: false, changes: 0, error: `No API key configured for provider "${provider}".` };

  const { system, user } = buildAmendmentDiffPrompt(
    loaded.requirements.map((r) => ({
      id: r.id.toString(),
      name: r.name,
      description: r.description,
      source: r.source
    })),
    amendmentText
  );

  let ai;
  try {
    ai = await complete(provider, system, user, model, apiKey, DIFF_MAX_TOKENS);
  } catch (e) {
    return { ok: false, changes: 0, error: e instanceof Error ? e.message : 'AI request failed.' };
  }

  const diff = parseAmendmentDiff(ai.text);
  const validIds = new Set(loaded.requirements.map((r) => r.id.toString()));

  await withTenant(companyId, async (tx) => {
    // Replace any still-pending proposals (keep already accepted/rejected history).
    await tx.amendmentChange.deleteMany({
      where: { amendmentId, companyId, status: 'proposed' }
    });
    for (const c of diff.changes) {
      // Drop modify/remove whose target no longer exists.
      if ((c.action === 'modify' || c.action === 'remove') && (!c.requirementId || !validIds.has(c.requirementId))) {
        continue;
      }
      await tx.amendmentChange.create({
        data: {
          companyId,
          amendmentId,
          requirementId: c.requirementId ? BigInt(c.requirementId) : null,
          changeType: c.action,
          proposed: c.proposed ? (c.proposed as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          rationale: c.rationale || null,
          status: 'proposed'
        }
      });
    }
    await tx.amendment.update({
      where: { id: amendmentId },
      data: { aiSummary: diff.summary || null, reconciliationStatus: 'proposed' }
    });
  });

  return { ok: true, changes: diff.changes.length };
}

/**
 * Accept or reject a single proposed change. Accepting folds it into the matrix:
 * add → new requirement; modify → version the prior values then update in place;
 * remove → mark removedAt (retained). Updates the amendment's applied state.
 */
export async function applyAmendmentChange(
  changeId: bigint,
  companyId: bigint,
  accept: boolean
): Promise<{ ok: boolean; error?: string }> {
  return withTenant(companyId, async (tx) => {
    const change = await tx.amendmentChange.findFirst({ where: { id: changeId, companyId } });
    if (!change) return { ok: false, error: 'Change not found.' };
    if (change.status !== 'proposed') return { ok: true }; // already resolved

    if (!accept) {
      await tx.amendmentChange.update({ where: { id: changeId }, data: { status: 'rejected' } });
      await maybeFinalize(tx, change.amendmentId, companyId);
      return { ok: true };
    }

    const amendment = await tx.amendment.findFirst({ where: { id: change.amendmentId, companyId } });
    if (!amendment) return { ok: false, error: 'Amendment not found.' };
    const proposed = (change.proposed ?? {}) as any;

    if (change.changeType === 'add') {
      const agg = await tx.requirement.aggregate({
        where: { solicitationId: amendment.solicitationId, companyId },
        _max: { sortOrder: true }
      });
      await tx.requirement.create({
        data: {
          companyId,
          solicitationId: amendment.solicitationId,
          name: String(proposed.name ?? 'Requirement').slice(0, 300),
          description: proposed.description ? String(proposed.description) : null,
          source: proposed.source ?? 'other',
          isScored: proposed.isScored === true,
          disposition: proposed.isScored === true ? ('scored' as const) : ('compliance' as const),
          farReference: String(proposed.farReference ?? '').slice(0, 100),
          weight: Number(proposed.weight ?? 0) || 0,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
          addedByAmendmentId: amendment.id
        }
      });
    } else if (change.requirementId) {
      const req = await tx.requirement.findFirst({
        where: { id: change.requirementId, companyId }
      });
      if (req) {
        if (change.changeType === 'modify') {
          // Snapshot the prior values, then update in place.
          await tx.requirementVersion.create({
            data: {
              companyId,
              requirementId: req.id,
              version: req.version + 1,
              name: req.name,
              description: req.description,
              source: req.source,
              isScored: req.isScored,
              farReference: req.farReference,
              weight: req.weight,
              complianceStatus: req.complianceStatus,
              proposalRef: req.proposalRef,
              amendmentId: amendment.id
            }
          });
          await tx.requirement.update({
            where: { id: req.id },
            data: {
              name: String(proposed.name ?? req.name).slice(0, 300),
              description: proposed.description ? String(proposed.description) : null,
              source: proposed.source ?? req.source,
              isScored: proposed.isScored === true,
              // Keep disposition in sync with scored-ness; preserve an administrative
              // classification when the amendment doesn't make it a scored factor.
              disposition:
                proposed.isScored === true
                  ? ('scored' as const)
                  : req.disposition === 'scored'
                    ? ('compliance' as const)
                    : req.disposition,
              farReference: String(proposed.farReference ?? req.farReference).slice(0, 100),
              weight: Number(proposed.weight ?? req.weight) || 0,
              version: req.version + 1,
              changedByAmendmentId: amendment.id
            }
          });
        } else {
          // remove — retained, excluded from the active matrix.
          await tx.requirement.update({
            where: { id: req.id },
            data: { removedAt: new Date(), removedByAmendmentId: amendment.id }
          });
        }
      }
    }

    await tx.amendmentChange.update({ where: { id: changeId }, data: { status: 'accepted' } });
    // The matrix changed — mark the amendment applied (drives stale-review flagging).
    await tx.amendment.update({
      where: { id: amendment.id },
      data: { appliedAt: amendment.appliedAt ?? new Date() }
    });
    await maybeFinalize(tx, change.amendmentId, companyId);
    return { ok: true };
  });
}

// Flip the amendment to 'applied' once no proposed changes remain.
async function maybeFinalize(tx: any, amendmentId: bigint, companyId: bigint) {
  const remaining = await tx.amendmentChange.count({
    where: { amendmentId, companyId, status: 'proposed' }
  });
  if (remaining === 0) {
    await tx.amendment.update({
      where: { id: amendmentId },
      data: { reconciliationStatus: 'applied' }
    });
  }
}
