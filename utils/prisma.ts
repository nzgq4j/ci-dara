import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// DARA-004: tenant isolation is enforced at the database via RLS, not just by
// app-layer `where: { companyId }` filters. That requires connecting as
// least-privilege roles instead of the BYPASSRLS owner:
//
//   prismaTenant  -> role `dara_app`  (NOT bypassrls). MUST be used through
//                    withTenant(), which sets the per-transaction GUC the RLS
//                    policies read. A bare query on it with no tenant context is
//                    fail-closed (returns zero rows), by design.
//   prismaAdmin   -> role `dara_admin` (permissive RLS policy = sees all tenants).
//                    ONLY for the audited cross-tenant paths: user provisioning,
//                    the Stripe webhook (lookup by stripeCustomerId), and the
//                    platform-admin pages. Every call site should justify itself.
//
// See prisma/security/2026-06-27_dara004_rls_policies.sql.

declare global {
  // eslint-disable-next-line no-var
  var prismaTenant: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaAdmin: PrismaClient | undefined;
}

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Constructing an adapter does not open a connection (pg connects lazily on the
// first query), so referencing possibly-undefined URLs here is safe at build.
// DARA-004: in production a missing tenant/admin URL must fail LOUDLY rather than
// silently fall back to the owner connection (which bypasses RLS) — that footgun
// would quietly disable tenant isolation. In development we still fall back to
// DATABASE_URL (with a warning) for convenience.
function connString(primary: string | undefined, varName: string): string {
  if (primary) return primary;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${varName} is required in production (DARA-004 least-privilege RLS roles). ` +
        `Refusing to fall back to the owner connection, which would bypass RLS.`
    );
  }
  if (process.env.DATABASE_URL) {
    console.warn(
      `[prisma] ${varName} is unset; falling back to DATABASE_URL ` +
        `(owner role — RLS NOT enforced). Development only.`
    );
    return process.env.DATABASE_URL;
  }
  return '';
}

// DARA-014: require TLS on every runtime DB connection (sslmode=require). The
// Supabase pooler terminates TLS with a cert not in the system CA bundle, so we
// encrypt without CA verification; verify-full (bundled CA) is a future hardening.
const ssl = { rejectUnauthorized: false };

// Bound how long we'll wait on the DB so a transient pooler blip fails fast instead of hanging
// the whole function until Vercel's 300s kill (which orphans in-flight worker jobs as
// `running`). connectionTimeoutMillis caps waiting for a pooled connection; statement_timeout
// (server) / query_timeout (client) cap a single runaway query. Generous vs. real query times.
const dbTimeouts = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
  query_timeout: 60_000
};

const tenantAdapter = new PrismaPg({
  connectionString: connString(process.env.DATABASE_URL_APP, 'DATABASE_URL_APP'),
  ssl,
  ...dbTimeouts
});
const adminAdapter = new PrismaPg({
  connectionString: connString(process.env.DATABASE_URL_ADMIN, 'DATABASE_URL_ADMIN'),
  ssl,
  ...dbTimeouts
});

export const prismaTenant =
  global.prismaTenant ?? new PrismaClient({ adapter: tenantAdapter });
export const prismaAdmin =
  global.prismaAdmin ?? new PrismaClient({ adapter: adminAdapter });

if (process.env.NODE_ENV !== 'production') {
  global.prismaTenant = prismaTenant;
  global.prismaAdmin = prismaAdmin;
}

/** The transaction-scoped client handed to a withTenant() callback. */
export type TenantTx = Prisma.TransactionClient;

/**
 * Run tenant-scoped work with database-enforced isolation.
 *
 * Opens an interactive transaction on the restricted `dara_app` role, sets the
 * `app.company_id` GUC LOCAL to that transaction, then runs `fn`. SET LOCAL is
 * the only safe way to pin the tenant on Supabase's transaction-mode pooler: the
 * value lives and dies with this one transaction and never leaks across pooled
 * connections.
 *
 * Keep the callback short and DB-only — do NOT await slow work (e.g. LLM calls)
 * inside it, or the pinned connection is held and the interactive-transaction
 * timeout can trip. For long jobs, split into multiple withTenant() bursts around
 * the slow work (see utils/dara/evaluator.ts).
 */
export function withTenant<T>(
  companyId: bigint,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { maxWait?: number; timeout?: number }
): Promise<T> {
  // `options` is optional and passed straight through to $transaction. Existing callers are
  // unaffected (undefined = Prisma defaults: 2s maxWait / 5s timeout). A caller doing a single
  // large clear-then-write (e.g. the shred persist) can raise `timeout` for headroom.
  return prismaTenant.$transaction(async (tx) => {
    // set_config(setting, value, is_local=true) == SET LOCAL. Parameterized.
    await tx.$executeRaw`select set_config('app.company_id', ${companyId.toString()}, true)`;
    return fn(tx);
  }, options);
}
