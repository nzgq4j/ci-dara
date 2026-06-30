/**
 * DARA-009 — one-time backfill: encrypt existing plaintext document extracted_text.
 *
 * After the app started encrypting extracted_text on write, rows created earlier
 * are still plaintext. This script encrypts them in place (AES-256-GCM "v1:"
 * envelope) so all CUI is encrypted at rest. Idempotent: rows already "v1:" are
 * skipped, so it is safe to re-run.
 *
 * PREREQUISITES:
 *   - The decrypt-on-read code is already DEPLOYED (it tolerates both plaintext and
 *     ciphertext, so run this AFTER deploy — never before, or the live app would
 *     feed ciphertext to the LLM).
 *   - .env.local has DATABASE_URL_ADMIN (prod pooler) and the SAME APP_KEY as prod.
 *
 * RUN:  npx tsx prisma/security/backfill-dara009-encrypt-extracted-text.ts
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  const { prismaAdmin } = await import('../../utils/prisma');
  const { encryptField } = await import('../../utils/dara/crypto');

  let sol = 0;
  let files = 0;

  const solDocs = await prismaAdmin.solDocument.findMany({
    where: { NOT: { extractedText: null } },
    select: { id: true, extractedText: true }
  });
  for (const d of solDocs) {
    if (d.extractedText && !d.extractedText.startsWith('v1:')) {
      await prismaAdmin.solDocument.update({
        where: { id: d.id },
        data: { extractedText: encryptField(d.extractedText) }
      });
      sol++;
    }
  }

  const reviewDocs = await prismaAdmin.reviewDocument.findMany({
    where: { NOT: { extractedText: null } },
    select: { id: true, extractedText: true }
  });
  for (const f of reviewDocs) {
    if (f.extractedText && !f.extractedText.startsWith('v1:')) {
      await prismaAdmin.reviewDocument.update({
        where: { id: f.id },
        data: { extractedText: encryptField(f.extractedText) }
      });
      files++;
    }
  }

  console.log(
    `Encrypted ${sol} solicitation document(s) and ${files} review snapshot(s). ` +
      `(Rows already encrypted were skipped.)`
  );
  await prismaAdmin.$disconnect();
}

main().catch((e) => {
  console.error('backfill failed:', e);
  process.exit(1);
});
