// Server-Sent Events for long admin operations (POST /api/admin/cpcv and
// POST /api/admin/demo/reset). A POST can't use EventSource, so the browser
// reads the body with fetch (lib/admin/sse-parser.ts); the wire format is
// plain SSE: one `data: <json>` frame per event, `: keepalive` comments while
// a slow step runs.
//
// The operation keeps running if the client goes away (closing the tab must
// not leave a CPCV half-minted): `send` becomes a no-op and `done` still
// settles, so the route can hand it to `keepAlive` (lib/admin/background).

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Stop proxies (nginx, some CDNs) from buffering the stream.
  "X-Accel-Buffering": "no",
};

const encoder = new TextEncoder();
const KEEPALIVE = encoder.encode(": keepalive\n\n");

/** One SSE frame carrying `data` as JSON. */
export function encodeSseEvent(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export interface SseWriter<T> {
  send(event: T): void;
  /** True once the client disconnected or the stream ended. */
  readonly closed: boolean;
}

export interface SseStream {
  response: Response;
  /** Settles when the operation has finished, whether or not anyone is still listening. */
  done: Promise<void>;
}

/** Starts `run` at once and streams what it sends. Errors escaping `run` are logged, not thrown. */
export function sseStream<T>(run: (writer: SseWriter<T>) => Promise<void>, opts: { keepaliveMs?: number } = {}): SseStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;

  const push = (chunk: Uint8Array) => {
    if (closed) return;
    try {
      controller.enqueue(chunk);
    } catch {
      closed = true;
    }
  };

  // The first tick comes long after the stream below exists (start() runs synchronously).
  const timer = setInterval(() => push(KEEPALIVE), opts.keepaliveMs ?? 10_000);

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });

  const writer: SseWriter<T> = {
    send: (event) => push(encodeSseEvent(event)),
    get closed() {
      return closed;
    },
  };

  const done = (async () => {
    try {
      await run(writer);
    } catch (err) {
      console.error("[admin] streamed operation failed", err);
    } finally {
      clearInterval(timer);
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed or errored.
        }
      }
    }
  })();

  return { response: new Response(stream, { headers: SSE_HEADERS }), done };
}
