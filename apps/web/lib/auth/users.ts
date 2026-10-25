// User lookup and role assignment. No Next.js imports: the seed script can use
// `roleForEmail` / `findOrCreateUserByEmail` too.

import type { Role } from "@/lib/auth/session-core";
import { db, Prisma, type User } from "@/lib/db";
import { env } from "@/lib/env";

/** Canonical form of an email address for storage and comparison. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Seed agents live on this domain (spec §11.2). Their addresses are never emailed. */
export const DEMO_EMAIL_DOMAIN = "demo.explorador.pt";

export const isDemoEmail = (email: string): boolean => normalizeEmail(email).endsWith(`@${DEMO_EMAIL_DOMAIN}`);

/** ADMIN if the address is in ADMIN_EMAILS (spec §3), otherwise AGENT. */
export function roleForEmail(email: string, adminEmails: readonly string[] = env().ADMIN_EMAILS): Role {
  return adminEmails.includes(normalizeEmail(email)) ? "ADMIN" : "AGENT";
}

/**
 * Finds the user for a verified email address, creating it on first sign-in.
 * ADMIN_EMAILS is the source of truth for the admin role, so an existing
 * user's role is brought in line with it on every email sign-in.
 */
export async function findOrCreateUserByEmail(rawEmail: string): Promise<{ user: User; created: boolean }> {
  const email = normalizeEmail(rawEmail);
  const role = roleForEmail(email);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role === role) return { user: existing, created: false };
    const user = await db.user.update({ where: { id: existing.id }, data: { role } });
    return { user, created: false };
  }

  try {
    const user = await db.user.create({ data: { email, role } });
    return { user, created: true };
  } catch (err) {
    // Two first sign-ins for the same address raced; the other one created the row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      return { user, created: false };
    }
    throw err;
  }
}
