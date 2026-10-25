// Guards for server components (layouts and pages). proxy.ts already
// redirects on the cookie alone; these re-check against the database (e.g. a
// user deleted by a demo reset) and redirect instead of throwing an HttpError.

import { redirect } from "next/navigation";

import { homeForRole, loginPath } from "@/lib/auth/redirect";
import type { Role, SessionUser } from "@/lib/auth/session-core";
import { getSessionUser } from "@/lib/auth/session";

async function requirePageRole(role: Role, currentPath: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(loginPath(currentPath));
  if (user.role !== role) redirect(homeForRole(user.role));
  return user;
}

/** The signed-in agent; otherwise redirects to /login?next=<currentPath> (signed out) or /admin (admins). */
export const requireAgentPage = (currentPath = "/agent"): Promise<SessionUser> => requirePageRole("AGENT", currentPath);

/** The signed-in admin; otherwise redirects to /login?next=<currentPath> (signed out) or /agent (agents). */
export const requireAdminPage = (currentPath = "/admin"): Promise<SessionUser> => requirePageRole("ADMIN", currentPath);
