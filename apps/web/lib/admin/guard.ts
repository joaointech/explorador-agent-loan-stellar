// Guards shared by the admin route handlers.

import { assertJsonRequest } from "@/lib/auth/request";
import { requireAdmin, type SessionUser } from "@/lib/auth/session";

/**
 * Admin-only state change: 401/403 unless an admin is signed in, then 415
 * unless the body is sent as JSON. The JSON requirement means another site
 * can't post a plain form at these routes (it would need a CORS preflight),
 * on top of the SameSite=Lax session cookie.
 */
export async function requireAdminMutation(req: Request): Promise<SessionUser> {
  const user = await requireAdmin();
  assertJsonRequest(req);
  return user;
}
