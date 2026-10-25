// Creates a Postgres database if it doesn't exist (the e2e runs against its
// own database so it never touches the seeded demo data). Connects to the
// server's `postgres` maintenance database with the same credentials.

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

/** Returns true when the database was created now. */
export async function ensureDatabase(url: string): Promise<boolean> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Refusing to create a database with an unusual name: ${name}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: admin.toString() }) });
  try {
    const rows = await client.$queryRawUnsafe<{ exists: boolean }[]>("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists", name);
    if (rows[0]?.exists) return false;
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    return true;
  } finally {
    await client.$disconnect();
  }
}
