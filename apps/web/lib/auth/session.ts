// iron-session cookie sessions (§9.2): httpOnly, 7 days.
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { HttpError } from "@/lib/http";
import { SESSION_COOKIE, SESSION_TTL_SECS, type SessionData } from "./session-cookie";

export { SESSION_COOKIE, SESSION_TTL_SECS, type SessionData } from "./session-cookie";

export function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return {
    cookieName: SESSION_COOKIE,
    password,
    ttl: SESSION_TTL_SECS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** A fully logged-in user (passkey registered, or email fallback after registration). */
export async function requireUser(role?: "AGENT" | "ADMIN") {
  const s = await getSession();
  if (!s.userId || s.prePasskey) throw new HttpError(401, "UNAUTHENTICATED", "Sign in first");
  if (role && s.role !== role) throw new HttpError(403, "FORBIDDEN", `Requires ${role.toLowerCase()} access`);
  return { userId: s.userId, email: s.email!, role: s.role! };
}

export async function requireAgent() {
  return requireUser("AGENT");
}

export async function requireAdmin() {
  return requireUser("ADMIN");
}
