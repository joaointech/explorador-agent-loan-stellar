import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/lib/env";
import { PrismaClient } from "@/lib/generated/prisma/client";

export * from "@/lib/generated/prisma/client";

const LOCAL_URL = "postgresql://advance:advance@localhost:5433/advance";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = env().DATABASE_URL ?? LOCAL_URL;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Prisma client singleton (reused across hot reloads in dev). Works in route handlers and scripts. */
export const db: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
