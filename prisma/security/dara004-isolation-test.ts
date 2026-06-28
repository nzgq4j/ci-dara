/**
 * DARA-004 — two-tenant isolation test harness.
 *
 * Behavioral proof that database-enforced tenant isolation works. Typecheck
 * passing is NOT enough; this exercises the real clients from utils/prisma.ts
 * (withTenant / prismaTenant / prismaAdmin) against the live database.
 *
 * WHAT IT DOES (safe + self-cleaning):
 *   - Creates two throwaway companies (slug `dara004-test-a/b-<ts>`) via prismaAdmin.
 *   - Asserts: read isolation, fail-closed-when-unscoped, cross-tenant
 *     update/delete blocked, cross-tenant insert rejected (WITH CHECK), own-tenant
 *     insert allowed, admin path sees across tenants, companies table policy.
 *   - Deletes both test companies (cascade) in a finally block.
 *
 * PREREQUISITES:
 *   - The SQL artifact has been applied (roles + RLS policies).
 *   - dara_app / dara_admin passwords set; DATABASE_URL_APP / DATABASE_URL_ADMIN
 *     present in .env.local (this script loads it).
 *
 * RUN:
 *   npx tsx prisma/security/dara004-isolation-test.ts
 *
 * EXIT CODE: 0 if every check passes, 1 otherwise (CI-friendly).
 */
import { config as loadEnv } from 'dotenv';

// Load env BEFORE importing utils/prisma (it reads process.env at module load to
// build the adapters). Dynamic import below guarantees this order under ESM.
loadEnv({ path: '.env.local' });
loadEnv();

// ── tiny assertion framework ────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`${GREEN}PASS${RESET} ${name}`);
  } else {
    failed++;
    console.log(`${RED}FAIL${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  }
}

async function expectRejected(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, 'expected the operation to be rejected, but it succeeded');
  } catch {
    check(name, true);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  // Import AFTER dotenv has populated process.env (utils/prisma reads it at module
  // load to build the adapters). Dynamic import keeps that ordering under ESM.
  const { prismaTenant, prismaAdmin, withTenant } = await import('../../utils/prisma');

  // Preflight: refuse to run if we're not actually connected as the restricted,
  // non-bypass role — otherwise the owner fallback would give false passes.
  if (!process.env.DATABASE_URL_APP) {
    console.error(
      `${RED}ABORT${RESET} DATABASE_URL_APP is not set — prismaTenant would fall back to ` +
        `the owner connection (RLS bypassed). Set it before running this test.`
    );
    process.exit(2);
  }
  const ident = (await prismaTenant.$queryRawUnsafe(
    `select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls`
  )) as Array<{ role: string; bypassrls: boolean }>;
  const { role, bypassrls } = ident[0];
  check('preflight: tenant client connects as dara_app', role === 'dara_app', `got "${role}"`);
  check('preflight: dara_app does NOT bypass RLS', bypassrls === false, `rolbypassrls=${bypassrls}`);
  if (role !== 'dara_app' || bypassrls) {
    console.error(`${RED}ABORT${RESET} not connected as a restricted role; results would be meaningless.`);
    process.exit(2);
  }

  const ts = Date.now().toString(36);
  let aId: bigint | null = null;
  let bId: bigint | null = null;

  try {
    // ── set up two tenants via the admin (bootstrap) client ──
    const a = await prismaAdmin.company.create({
      data: { name: 'DARA004 Test A', slug: `dara004-test-a-${ts}`, plan: 'trial', planStatus: 'trialing' }
    });
    const b = await prismaAdmin.company.create({
      data: { name: 'DARA004 Test B', slug: `dara004-test-b-${ts}`, plan: 'trial', planStatus: 'trialing' }
    });
    aId = a.id;
    bId = b.id;

    const personaA = await prismaAdmin.persona.create({
      data: { companyId: a.id, displayName: 'A-persona', systemPrompt: 'x' }
    });
    const personaB = await prismaAdmin.persona.create({
      data: { companyId: b.id, displayName: 'B-persona', systemPrompt: 'x' }
    });

    // ── 1. Read isolation: tenant A sees only A ──
    const aSees = await withTenant(a.id, (tx) =>
      tx.persona.findMany({ where: { id: { in: [personaA.id, personaB.id] } } })
    );
    check(
      'read: tenant A sees its own persona',
      aSees.some((p) => p.id === personaA.id),
      `saw ${aSees.length} of the 2 test personas`
    );
    check(
      "read: tenant A does NOT see tenant B's persona",
      !aSees.some((p) => p.id === personaB.id)
    );
    const aSeesBDirect = await withTenant(a.id, (tx) =>
      tx.persona.findFirst({ where: { id: personaB.id } })
    );
    check("read: direct lookup of B's persona from A context returns null", aSeesBDirect === null);

    // ── 2. Fail-closed: no withTenant ⇒ no GUC ⇒ zero rows ──
    const unscoped = await prismaTenant.persona.findMany({
      where: { id: { in: [personaA.id, personaB.id] } }
    });
    check(
      'fail-closed: unscoped tenant query returns zero rows (not a leak)',
      unscoped.length === 0,
      `returned ${unscoped.length} rows`
    );

    // ── 3. Cross-tenant UPDATE blocked (USING hides the row) ──
    const upd = await withTenant(a.id, (tx) =>
      tx.persona.updateMany({ where: { id: personaB.id }, data: { displayName: 'HACKED' } })
    );
    check('write: tenant A cannot update tenant B (0 rows affected)', upd.count === 0, `count=${upd.count}`);
    const bAfterUpd = await prismaAdmin.persona.findUnique({ where: { id: personaB.id } });
    check("write: tenant B's persona is unchanged", bAfterUpd?.displayName === 'B-persona');

    // ── 4. Cross-tenant DELETE blocked ──
    const del = await withTenant(a.id, (tx) =>
      tx.persona.deleteMany({ where: { id: personaB.id } })
    );
    check('write: tenant A cannot delete tenant B (0 rows affected)', del.count === 0, `count=${del.count}`);
    const bStillThere = await prismaAdmin.persona.findUnique({ where: { id: personaB.id } });
    check("write: tenant B's persona still exists", bStillThere !== null);

    // ── 5. Cross-tenant INSERT rejected by WITH CHECK ──
    await expectRejected('write: tenant A cannot insert a row tagged as tenant B (WITH CHECK)', () =>
      withTenant(a.id, (tx) =>
        tx.persona.create({ data: { companyId: b.id, displayName: 'smuggled', systemPrompt: 'x' } })
      )
    );

    // ── 6. Own-tenant INSERT allowed (positive control) ──
    const legit = await withTenant(a.id, (tx) =>
      tx.persona.create({ data: { companyId: a.id, displayName: 'A-legit', systemPrompt: 'x' } })
    );
    check('write: tenant A can insert its own row', legit.companyId === a.id);

    // ── 7. Admin path is intentionally cross-tenant ──
    const both = await prismaAdmin.persona.findMany({
      where: { id: { in: [personaA.id, personaB.id] } }
    });
    check('admin: prismaAdmin sees both tenants', both.length === 2, `saw ${both.length}`);

    // ── 8. Companies table policy (keyed on id, not company_id) ──
    const aCompanies = await withTenant(a.id, (tx) =>
      tx.company.findMany({ where: { id: { in: [a.id, b.id] } } })
    );
    check(
      'companies: tenant A sees only its own company row',
      aCompanies.length === 1 && aCompanies[0].id === a.id,
      `saw ${aCompanies.length}`
    );
  } finally {
    // Cleanup — cascade deletes personas/solicitations/etc.
    try {
      if (aId !== null) await prismaAdmin.company.delete({ where: { id: aId } });
      if (bId !== null) await prismaAdmin.company.delete({ where: { id: bId } });
    } catch (e) {
      console.log(`${RED}WARN${RESET} cleanup failed; remove test companies manually (slug dara004-test-*-${ts}).`);
      console.log(e);
    }
    await prismaTenant.$disconnect();
    await prismaAdmin.$disconnect();
  }

  console.log(`\n${failed === 0 ? GREEN : RED}${passed} passed, ${failed} failed${RESET}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`${RED}ERROR${RESET} harness crashed:`, e);
  process.exit(1);
});
