// Work that outlives the response, via Next.js `after()`. Outside a request
// scope (Vitest, scripts) `after` throws; these helpers then just run the work.

import { after } from "next/server";

/** Keeps the function alive until `task` settles, even after the response ended (e.g. a client left an SSE stream). */
export function keepAlive(task: Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Not in a Next.js request: the promise runs on by itself.
  }
}

/** Runs `task` after the response is sent; errors are logged, never thrown. */
export function afterResponse(label: string, task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (err) {
      console.warn(`[admin] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
