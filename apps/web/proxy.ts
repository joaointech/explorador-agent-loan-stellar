// Route protection (§9.2): /agent/** needs an AGENT session, /admin/** an ADMIN session.
// Optimistic check on the sealed iron-session cookie; API routes re-check on every call.
import { unsealData } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, type SessionData } from "@/lib/auth/session-cookie";

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const need = pathname.startsWith("/admin") ? "ADMIN" : "AGENT";
  let session: SessionData = {};
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && process.env.SESSION_SECRET) {
    try {
      session = await unsealData<SessionData>(cookie, { password: process.env.SESSION_SECRET });
    } catch {
      session = {};
    }
  }
  if (!session.userId || session.prePasskey) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (session.role !== need) {
    return NextResponse.redirect(new URL(session.role === "ADMIN" ? "/admin" : "/agent", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/agent/:path*", "/admin/:path*"],
};
