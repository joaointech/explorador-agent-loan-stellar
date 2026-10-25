// Route-handler helpers: JSON responses, `{ error: { code, message } }` errors, zod parsing.
import { NextResponse } from "next/server";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
}

export function errorResponse(status: number, code: string, message: string): NextResponse {
  return json({ error: { code, message } }, { status });
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "BAD_JSON", "Request body must be JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new HttpError(400, "VALIDATION", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data;
}

/** Wraps a handler so thrown HttpErrors (and anything else) become JSON errors. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message);
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      return errorResponse(500, "INTERNAL", message);
    }
  };
}

/** Server-Sent Events stream for POST pipelines. */
export function sseStream(run: (send: (event: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        const data = JSON.stringify(event, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      try {
        await run(send);
      } catch (e) {
        send({ step: "error", status: "error", line: String(e), error: e instanceof Error ? e.message : String(e), message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
