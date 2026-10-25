// Session cookie shape, importable from proxy.ts (no next/headers dependency).
export interface SessionData {
  userId?: string;
  email?: string;
  role?: "AGENT" | "ADMIN";
  /** Email verified but no passkey registered yet. */
  prePasskey?: boolean;
  regChallenge?: string;
  loginChallenge?: string;
}

export const SESSION_COOKIE = "ea_session";
export const SESSION_TTL_SECS = 7 * 24 * 3600;
