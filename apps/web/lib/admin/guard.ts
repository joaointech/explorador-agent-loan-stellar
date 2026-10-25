// Guards shared by the admin route handlers.

import { assertJsonRequest } from "@/lib/auth/request";
import { requireAdmin, type SessionUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/http";

import { UPLOAD_HEADER } from "./document-upload";

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

/**
 * Admin-only file upload (multipart/form-data, which any site's HTML form can
 * post): 401/403 unless an admin is signed in, then 403 unless the request
 * carries `X-Advance-Upload: 1`. Forms can't set headers, and a cross-origin
 * fetch that sets one needs a CORS preflight this app never grants.
 */
export async function requireAdminUpload(req: Request): Promise<SessionUser> {
  const user = await requireAdmin();
  if (req.headers.get(UPLOAD_HEADER) !== "1") {
    throw new HttpError(403, "CROSS_SITE_UPLOAD", `Uploads must be sent by the admin panel (missing the ${UPLOAD_HEADER} header)`);
  }
  return user;
}
