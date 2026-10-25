// Interface owned by the Auth & DB workstream (spec §9.2). Other workstreams
// call these; the iron-session implementation replaces the stub bodies.

import type { IronSession } from "iron-session";

import { notImplemented } from "@/lib/http";

const OWNER = "auth & database";

export type Role = "AGENT" | "ADMIN";

export interface SessionData {
  userId?: string;
  email?: string;
  role?: Role;
  /** True once the user registered or signed in with a passkey. */
  passkeyVerified?: boolean;
  /** WebAuthn challenge for the ceremony in flight. */
  challenge?: string;
}

export interface SessionUser {
  userId: string;
  email: string;
  role: Role;
  passkeyVerified: boolean;
}

/** Read/write session: iron-session httpOnly cookie, 7 days. */
export async function getSession(): Promise<IronSession<SessionData>> {
  notImplemented("getSession", OWNER);
}

/** Current user, or null when signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  notImplemented("getSessionUser", OWNER);
}

/** Throws HttpError 401 when signed out. */
export async function requireUser(): Promise<SessionUser> {
  notImplemented("requireUser", OWNER);
}

/** Throws 401/403 unless the user is an AGENT. Pre-passkey sessions pass (onboarding). */
export async function requireAgent(): Promise<SessionUser> {
  notImplemented("requireAgent", OWNER);
}

/** Throws 401/403 unless the user is an ADMIN. */
export async function requireAdmin(): Promise<SessionUser> {
  notImplemented("requireAdmin", OWNER);
}
