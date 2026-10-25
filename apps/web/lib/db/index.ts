import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/lib/env";
import { PrismaClient } from "@/lib/generated/prisma/client";

export * from "@/lib/generated/prisma/client";

/** docker compose Postgres (`pnpm db:up`), used when DATABASE_URL is unset. */
const LOCAL_URL = "postgresql://advance:advance@localhost:5433/advance";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = env().DATABASE_URL ?? LOCAL_URL;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** The real client: one per process, created on first use, kept across hot reloads in dev. */
function client(): PrismaClient {
  return (globalForPrisma.prisma ??= createClient());
}

/**
 * Prisma client singleton. Works in route handlers, server components and
 * `tsx` scripts (imported through the `@/` alias).
 *
 * The client is created lazily on first property access, so importing this
 * module never reads env: a script can load `apps/web/.env.local` after its
 * imports (or run with `tsx --env-file=../apps/web/.env.local`) and still
 * connect to the right database. Call `db.$disconnect()` at the end of a
 * script so the process can exit.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = client();
    const value: unknown = Reflect.get(real, prop, real);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(client(), prop);
  },
});
