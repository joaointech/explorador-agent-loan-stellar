import { HttpError } from "@/lib/http";

/**
 * Rejects bodies that aren't sent as JSON. An HTML form on another site can
 * post `text/plain` that happens to parse as JSON, but it can't send
 * `application/json` without a CORS preflight, so this blocks login CSRF on
 * the sign-in routes.
 */
export function assertJsonRequest(req: Request): void {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType.trim())) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as application/json");
  }
}
