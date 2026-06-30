// Color-team review helpers. The proposal working draft lives on the solicitation
// (SolDocument docType='proposal'); a review freezes that draft into ReviewDocument
// snapshots so the gate reflects what it actually saw. Copying carries the extracted
// text verbatim — it stays encrypted at rest (DARA-009); the evaluator decrypts at use.

import { withTenant } from '@/utils/prisma';

export interface SnapshotSummary {
  ok: boolean;
  count: number;
  error?: string;
}

/**
 * Capture (or re-capture) the current proposal working draft into a review's frozen
 * snapshot, replacing any prior snapshot. Sets snapshotAt when at least one proposal
 * document was captured.
 */
export async function captureSnapshot(
  reviewId: bigint,
  companyId: bigint
): Promise<SnapshotSummary> {
  return withTenant(companyId, async (tx) => {
    const review = await tx.review.findFirst({ where: { id: reviewId, companyId } });
    if (!review) return { ok: false, count: 0, error: 'Review not found.' };

    const proposalDocs = await tx.solDocument.findMany({
      where: { solicitationId: review.solicitationId, companyId, docType: 'proposal' }
    });

    // Replace any prior snapshot (the review keeps a fresh copy of the current draft).
    await tx.reviewDocument.deleteMany({ where: { reviewId, companyId } });
    if (proposalDocs.length > 0) {
      await tx.reviewDocument.createMany({
        data: proposalDocs.map((d) => ({
          companyId,
          reviewId,
          originalFilename: d.originalFilename,
          storedFilename: d.storedFilename,
          fileSize: d.fileSize,
          extractionStatus: d.extractionStatus,
          extractedText: d.extractedText
        }))
      });
    }

    await tx.review.update({
      where: { id: reviewId },
      data: { snapshotAt: proposalDocs.length > 0 ? new Date() : null }
    });

    return { ok: true, count: proposalDocs.length };
  });
}
