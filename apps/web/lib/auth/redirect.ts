// Where signed-in users belong, and safe handling of `/login?next=…`.
// Pure functions: used by proxy.ts, the login page and the verify route.

import type { Role } from "@/lib/auth/session-core";

const ORIGIN = "http://advance.invalid";
const MAX_NEXT_LENGTH = 512;

/** Landing page after sign-in: agents continue onboarding on /agent, admins go to /admin. */
export const homeForRole = (role: Role): string => (role === "ADMIN" ? "/admin" : "/agent");

const inArea = (pathname: string, area: string) => pathname === area || pathname.startsWith(`${area}/`);

/** The role a page path requires (`/agent/**` → AGENT, `/admin/**` → ADMIN), or null for public pages. */
export function requiredRoleForPath(pathname: string): Role | null {
  if (inArea(pathname, "/agent")) return "AGENT";
  if (inArea(pathname, "/admin")) return "ADMIN";
  return null;
}

/**
 * Returns `next` as a same-origin path (pathname + search + hash) or null if
 * it could send the user elsewhere: absolute or protocol-relative URLs,
 * backslash tricks, control characters, API routes or the login page itself.
 */
export function sanitizeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_NEXT_LENGTH) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGIN) return null;
  if (inArea(url.pathname, "/api") || inArea(url.pathname, "/login")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Where to send a user after sign-in: `next` when it's safe and their role may open it, else their home. */
export function postLoginPath(role: Role, next?: unknown): string {
  const path = sanitizeNextPath(next);
  if (!path) return homeForRole(role);
  const required = requiredRoleForPath(new URL(path, ORIGIN).pathname);
  if (required && required !== role) return homeForRole(role);
  return path;
}

/** `/login?next=<path>` for a signed-out visitor of a protected page. */
export function loginPath(next?: string): string {
  const safe = sanitizeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
