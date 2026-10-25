// Primary navigation (spec §10.2 "Shared"): Registry, Invest, Agent, and Admin
// for admins only.

export interface NavLink {
  href: string;
  label: string;
}

export const PUBLIC_NAV: NavLink[] = [
  { href: "/registry", label: "Registry" },
  { href: "/invest", label: "Invest" },
  { href: "/agent", label: "Agent" },
];

export const ADMIN_NAV: NavLink = { href: "/admin", label: "Admin" };

/** Minimal, serializable user info the client header needs. */
export interface HeaderUser {
  email: string;
  role: "AGENT" | "ADMIN";
}

export const SIGN_IN_HREF = "/login";
/** POST endpoint that clears the session cookie (owned by the auth workstream). */
export const SIGN_OUT_ENDPOINT = "/api/auth/logout";

export function navFor(user: HeaderUser | null): NavLink[] {
  return user?.role === "ADMIN" ? [...PUBLIC_NAV, ADMIN_NAV] : PUBLIC_NAV;
}

/** True when `pathname` is `href` or below it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Signs out, then reloads on the landing page so server-rendered UI drops the session. */
export async function signOut(): Promise<void> {
  try {
    await fetch(SIGN_OUT_ENDPOINT, { method: "POST" });
  } finally {
    // A full document load on purpose: signing out must drop every client
    // cache (router cache, in-memory stores), not just re-render the header.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }
}
