"use client";
// Reads the Server-Sent Events streams returned by POST /api/admin/cpcv and
// POST /api/admin/demo/reset. EventSource can't POST, so we parse `data:` lines
// from a fetch ReadableStream ourselves.

import { ApiClientError } from "./api";

export async function postSSE<E>(url: string, body: unknown, onEvent: (e: E) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    let code = `HTTP_${res.status}`;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      message = j.error?.message ?? message;
      code = j.error?.code ?? code;
    } catch {
      /* not JSON */
    }
    throw new ApiClientError(message, code, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (chunk: string) => {
    // An SSE event is a block of lines separated by a blank line.
    const data = chunk
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as E);
    } catch {
      /* ignore malformed event */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      flush(chunk);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}
