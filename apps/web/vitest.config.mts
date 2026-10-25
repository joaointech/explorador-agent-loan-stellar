import { readFileSync } from "node:fs";

import { parse } from "dotenv";
import { configDefaults, defineConfig } from "vitest/config";

// Database-backed tests use TEST_DATABASE_URL (from the shell or .env.local)
// and are skipped when it is unset, so `pnpm test` never writes to the dev
// database. Nothing else is loaded from .env.local: tests control their env.
function testDatabaseUrl(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    return parse(readFileSync(".env.local"))["TEST_DATABASE_URL"] || undefined;
  } catch {
    return undefined;
  }
}

const testDb = testDatabaseUrl();

export default defineConfig({
  // Resolve the `@/` alias from tsconfig.json, like Next.js does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, ".next/**", "lib/generated/**"],
    env: testDb ? { TEST_DATABASE_URL: testDb, DATABASE_URL: testDb } : {},
  },
});
