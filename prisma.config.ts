import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Load local env files so the Prisma CLI sees the datasource URL without it
// being hardcoded in source. .env.local takes precedence over .env (dotenv does
// not override already-set vars). In hosted builds the values come from the
// platform's environment, so the missing local files are a no-op.
loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
