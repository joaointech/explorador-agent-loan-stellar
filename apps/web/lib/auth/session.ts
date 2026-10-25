// Sessions and guards (spec §9.2), owned by the Auth & DB workstream. Other
// workstreams call these from route handlers and server components.
//
// Cookie: iron-session, httpOnly, 7 days, `secure` in production. The cookie
// holds who the user is; `getSessionUser()` re-reads the user from Postgres so
// deleted users and role changes take effect immediately.

import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

import { sessionOptions, sessionUserFromData, type Role, type SessionData, type SessionUser } from "@/lib/auth/session-core";
import { db } from "@/lib/db";
import { forbidden, unauthorized } from "@/lib/http";

export type { Role, SessionData, SessionUser } from "@/lib/auth/session-core";

/**
 * Read/write session: iron-session httpOnly cookie, 7 days. Writing (`save`,
 * `destroy`) only works in route handlers and server functions.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** Current user, or null when signed out (or when the cookie's user no longer exists). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const fromCookie = sessionUserFromData(await getSession());
  if (!fromCookie) return null;
  const user = await db.user.findUnique({
    where: { id: fromCookie.userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) return null;
  return { userId: user.id, email: user.email, role: user.role, passkeyVerified: fromCookie.passkeyVerified };
}

/** Throws HttpError 401 when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}

/** Throws 401/403 unless the user is an AGENT. Pre-passkey sessions pass (onboarding). */
export async function requireAgent(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "AGENT") throw forbidden("This is only available to agents");
  return user;
}

/** Throws 401/403 unless the user is an ADMIN. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw forbidden("This is only available to admins");
  return user;
}

/**
 * Starts a fresh session for `user` (route handlers only). Email-code sign-in
 * passes `passkeyVerified: false`; passkey registration and passkey sign-in
 * pass `true`, which also lifts the pre-passkey time limit.
 */
export async function signIn(
  user: { id: string; email: string; role: Role },
  opts: { passkeyVerified: boolean },
): Promise<SessionUser> {
  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  session.passkeyVerified = opts.passkeyVerified;
  session.signedInAt = Date.now();
  delete session.challenge;
  await session.save();
  return { userId: user.id, email: user.email, role: user.role, passkeyVerified: opts.passkeyVerified };
}

/** Clears the session cookie (route handlers only). */
export async function signOut(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
