// Browser side of lib/admin/sse.ts: reads a `text/event-stream` body from
// fetch (EventSource can't POST) and hands each event's JSON data to a
// callback. Pure and browser-safe.

/** Incremental SSE frame parser: push text chunks as they arrive, get each frame's `data` payload. */
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";

  const emit = (frame: string) => {
    const data: string[] = [];
    for (const line of frame.split(/\r\n|\r|\n/)) {
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      // Comments (": keepalive"), `event:`, `id:` and `retry:` lines are ignored.
    }
    if (data.length > 0) onData(data.join("\n"));
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      for (;;) {
        const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
        if (!match) break;
        emit(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    /** Emits a final frame that wasn't terminated by a blank line. */
    flush() {
      if (buffer.trim() !== "") emit(buffer);
      buffer = "";
    },
  };
}

/** Reads an SSE response to the end, calling `onEvent` with each parsed JSON event. */
export async function readSseEvents<T>(response: Response, onEvent: (event: T) => void): Promise<void> {
  if (!response.body) return;
  const parser = createSseParser((data) => {
    let event: T;
    try {
      event = JSON.parse(data) as T;
    } catch {
      return; // Not JSON: ignore the frame.
    }
    onEvent(event);
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
}

/** True when a fetch response is an event stream (rather than a JSON error). */
export const isEventStream = (response: Response) => (response.headers.get("content-type") ?? "").includes("text/event-stream");
