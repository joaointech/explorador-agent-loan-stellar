// Session configuration and pure session logic, shared by `lib/auth/session.ts`
// (route handlers, server components) and `proxy.ts`. No `next/headers` here.

import { type SessionOptions, unsealData } from "iron-session";

import { sessionSecret } from "@/lib/crypto";

export type Role = "AGENT" | "ADMIN";

export interface SessionData {
  userId?: string;
  email?: string;
  role?: Role;
  /** True once the user registered or signed in with a passkey. */
  passkeyVerified?: boolean;
  /** WebAuthn challenge for the ceremony in flight. */
  challenge?: string;
  /** When this sign-in happened (ms since epoch). Limits how long a pre-passkey session lasts. */
  signedInAt?: number;
}

export interface SessionUser {
  userId: string;
  email: string;
  role: Role;
  passkeyVerified: boolean;
}

export const SESSION_COOKIE = "advance_session";

/** Cookie and seal lifetime: 7 days (spec §9.2). */
export const SESSION_TTL_SECS = 7 * 24 * 60 * 60;

/**
 * A session started by an email code alone (`passkeyVerified = false`) is the
 * spec's short "pre-passkey" session: it stops being valid 24 h after sign-in
 * unless a passkey ceremony upgrades it. Long enough for onboarding and for
 * the email-code fallback login (seed agents only have that).
 */
export const PRE_PASSKEY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function sessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE,
    password: sessionSecret(),
    ttl: SESSION_TTL_SECS,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    onUnsealError: (reason) => {
      // "expired" is how sessions normally end; anything else is worth a line in the logs.
      if (reason !== "expired") console.warn(`[auth] session cookie rejected (${reason})`);
    },
  };
}

const isRole = (value: unknown): value is Role => value === "AGENT" || value === "ADMIN";

/** The signed-in user described by session data, or null if it's empty, malformed or a stale pre-passkey session. */
export function sessionUserFromData(data: Partial<SessionData>, now: number = Date.now()): SessionUser | null {
  if (typeof data.userId !== "string" || !data.userId) return null;
  if (typeof data.email !== "string" || !data.email) return null;
  if (!isRole(data.role)) return null;
  const passkeyVerified = data.passkeyVerified === true;
  if (!passkeyVerified && typeof data.signedInAt === "number" && now - data.signedInAt > PRE_PASSKEY_MAX_AGE_MS) {
    return null;
  }
  return { userId: data.userId, email: data.email, role: data.role, passkeyVerified };
}

/**
 * Reads a session cookie value without touching the database (optimistic
 * check for `proxy.ts`). Tampered, expired or foreign cookies read as signed out.
 */
export async function readSessionCookie(value: string | undefined, now: number = Date.now()): Promise<SessionUser | null> {
  if (!value) return null;
  const { password, ttl, onUnsealError } = sessionOptions();
  const data = await unsealData<Partial<SessionData>>(value, { password, ttl, onUnsealError });
  return sessionUserFromData(data, now);
}
