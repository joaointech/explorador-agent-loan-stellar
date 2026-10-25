import { ZodError, type ZodType } from "zod";

import { errorResponse } from "@/lib/json";

/** Throw from route handlers to return `{ error: { code, message } }` with this status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST") => new HttpError(400, code, message);
export const unauthorized = (message = "Sign in required") => new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Not allowed") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (message: string, code = "CONFLICT") => new HttpError(409, code, message);

/** Placeholder thrower for interfaces whose implementation belongs to another workstream. */
export function notImplemented(what: string, owner: string): never {
  throw new HttpError(501, "NOT_IMPLEMENTED", `${what} is not implemented yet (${owner} workstream)`);
}

/** Parses and validates a JSON body; throws a 400 HttpError on failure. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw badRequest(message, "VALIDATION_ERROR");
  }
  return parsed.data;
}

/** Wraps a route handler so thrown errors become `{ error: { code, message } }` responses. */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
      if (err instanceof ZodError) return errorResponse(400, "VALIDATION_ERROR", err.message);
      console.error(err);
      return errorResponse(500, "INTERNAL", err instanceof Error ? err.message : "Unexpected error");
    }
  };
}
