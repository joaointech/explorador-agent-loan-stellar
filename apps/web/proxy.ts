// Route protection (spec §9.2). Next 16 renamed Middleware to Proxy; it runs
// on the Node.js runtime before pages render.
//
// Optimistic check only: the session cookie is unsealed, the database is not
// consulted. Signed-out visitors of /agent/** and /admin/** go to
// /login?next=…; signed-in users in the wrong area go to their own home.
// API routes don't rely on this: they call requireAgent()/requireAdmin().

import { type NextRequest, NextResponse } from "next/server";

import { homeForRole, loginPath, requiredRoleForPath } from "@/lib/auth/redirect";
import { readSessionCookie, SESSION_COOKIE } from "@/lib/auth/session-core";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const required = requiredRoleForPath(pathname);
  if (!required) return NextResponse.next();

  const user = await readSessionCookie(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.redirect(new URL(loginPath(`${pathname}${search}`), request.url));
  if (user.role !== required) return NextResponse.redirect(new URL(homeForRole(user.role), request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/agent", "/agent/:path*", "/admin", "/admin/:path*"],
};
