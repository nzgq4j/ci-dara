import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

declare global {
  var prisma: PrismaClient | undefined;
}

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Prisma 7 no longer reads the datasource URL from prisma.config.ts or the
// schema at runtime; a direct database connection must be supplied via a driver
// adapter passed to the PrismaClient constructor. The pg adapter connects using
// DATABASE_URL (the transaction pooler). Constructing the adapter does not open
// a connection — pg connects lazily on first query — so this is safe at build.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = global.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
