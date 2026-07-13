// Determinism harness for the multipass extraction pipeline.
//
//   npx tsx utils/dara/extraction/test-determinism.ts <solicitationId> <companyId>
//
// Clears the matrix, shreds twice, and diffs the (citation, description) row set. The deterministic
// steps (candidate selection, verification, IbR) fix the row identity; the temperature=0 LLM classify
// step can, in rare cases, flip is_requirement and change which rows persist — so this measures how
// close to identical two runs are rather than asserting a hard LLM guarantee.

import { withTenant } from '@/utils/prisma';
import { shredRequirements } from '@/utils/dara/requirements';

async function clearMatrix(solicitationId: bigint, companyId: bigint) {
  await withTenant(companyId, (tx) => tx.requirement.deleteMany({ where: { solicitationId, companyId } }));
}

async function getRequirements(solicitationId: bigint, companyId: bigint) {
  return withTenant(companyId, (tx) =>
    tx.requirement.findMany({
      where: { solicitationId, companyId, removedAt: null },
      select: { citation: true, description: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    })
  );
}

const key = (r: { citation: string; description: string | null }) =>
  `${r.citation}|||${(r.description ?? '').slice(0, 80)}`;

async function main() {
  const solId = BigInt(process.argv[2] ?? '0');
  const companyId = BigInt(process.argv[3] ?? '0');
  if (!solId || !companyId) {
    console.error('Usage: npx tsx utils/dara/extraction/test-determinism.ts <solicitationId> <companyId>');
    process.exit(2);
  }

  await clearMatrix(solId, companyId);
  await shredRequirements(solId, companyId);
  const run1 = await getRequirements(solId, companyId);

  await clearMatrix(solId, companyId);
  await shredRequirements(solId, companyId);
  const run2 = await getRequirements(solId, companyId);

  const keys1 = new Set(run1.map(key));
  const keys2 = new Set(run2.map(key));
  const onlyIn1 = Array.from(keys1).filter((k) => !keys2.has(k));
  const onlyIn2 = Array.from(keys2).filter((k) => !keys1.has(k));

  console.log(`Run 1: ${run1.length} rows`);
  console.log(`Run 2: ${run2.length} rows`);
  console.log(`Only in run 1: ${onlyIn1.length}`);
  console.log(`Only in run 2: ${onlyIn2.length}`);
  if (onlyIn1.length || onlyIn2.length) {
    console.log('\nSample differences:');
    for (const k of [...onlyIn1.slice(0, 5), ...onlyIn2.slice(0, 5)]) console.log('  ', k);
  }
  const identical = onlyIn1.length === 0 && onlyIn2.length === 0;
  console.log(`\nDeterminism: ${identical ? 'PASS (identical row sets)' : 'DIFFERENCES DETECTED'}`);
  process.exit(identical ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
