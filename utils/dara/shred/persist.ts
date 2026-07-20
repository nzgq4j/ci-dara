// Persistence for the shred: clear the solicitation's matrix and write the fresh rows in ONE
// short transaction (a single deleteMany + a single createMany — two statements, well inside the
// interactive-transaction budget). Regeneration is clear-then-write, so duplicates from repeated
// runs are structurally impossible.

import type { Prisma } from '@prisma/client';
import { withTenant } from '@/utils/prisma';

export async function persistMatrix(
  companyId: bigint,
  solicitationId: bigint,
  rows: Prisma.RequirementCreateManyInput[],
  solicitationNotes?: string
): Promise<{ inserted: number; cleared: number }> {
  return withTenant(companyId, async (tx) => {
    const del = await tx.requirement.deleteMany({ where: { solicitationId, companyId } });
    let inserted = 0;
    if (rows.length > 0) {
      inserted = (await tx.requirement.createMany({ data: rows })).count;
    }
    // Persist the run trace on the solicitation for transparency + the test battery to read.
    if (solicitationNotes !== undefined) {
      await tx.solicitation.update({ where: { id: solicitationId }, data: { notes: solicitationNotes } });
    }
    return { inserted, cleared: del.count };
  });
}
