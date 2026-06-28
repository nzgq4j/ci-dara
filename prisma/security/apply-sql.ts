/**
 * Apply a .sql file as the database OWNER (DIRECT_URL) — for grants/RLS/DDL that
 * the restricted runtime roles can't perform.
 *
 *   npx tsx prisma/security/apply-sql.ts prisma/security/2026-06-28_dara013_audit_log.sql
 *
 * Reads DIRECT_URL from .env.local (the owner connection).
 */
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'fs';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: tsx prisma/security/apply-sql.ts <path-to.sql>');
    process.exit(2);
  }
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL (owner connection) is required in .env.local');
    process.exit(2);
  }
  const sql = readFileSync(file, 'utf8');

  // pg has no bundled types here; this is a throwaway owner-only utility script.
  // @ts-ignore -- no @types/pg installed (intentionally, to avoid a dep)
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(sql);
    console.log(`Applied ${file} as owner.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('apply-sql failed:', e);
  process.exit(1);
});
