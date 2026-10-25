// Soroban RPC client from env (spec §9.3), plus timeout helpers.

import { rpc } from "@stellar/stellar-sdk";

import { HttpError } from "@/lib/http";

import { networkConfig } from "./config";
import { RpcError, RpcTimeoutError } from "./errors";

/** Upper bound for any single RPC request; callers pass tighter per-call budgets. */
const HTTP_TIMEOUT_MS = 20_000;

const globalForRpc = globalThis as unknown as { stellarRpc?: { url: string; server: rpc.Server } };

/** Shared `rpc.Server` for `STELLAR_RPC_URL` (re-created if the URL changes). */
export function getRpc(): rpc.Server {
  const { rpcUrl } = networkConfig();
  const cached = globalForRpc.stellarRpc;
  if (cached && cached.url === rpcUrl) return cached.server;
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://"), timeout: HTTP_TIMEOUT_MS });
  globalForRpc.stellarRpc = { url: rpcUrl, server };
  return server;
}

/** Rejects with RpcTimeoutError after `ms`; the underlying request is left to settle on its own. */
export async function withTimeout<T>(promise: Promise<T>, ms: number | undefined, what: string): Promise<T> {
  if (!ms || ms <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RpcTimeoutError(what, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** JSON-RPC error message/code from whatever the SDK threw; network errors include undici's `cause` ("fetch failed: …"). */
export function rpcErrorInfo(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown; cause?: unknown };
    let message = typeof e.message === "string" ? e.message : String(err);
    const cause = e.cause as { message?: unknown; code?: unknown } | undefined;
    if (cause && typeof cause === "object" && typeof cause.message === "string" && !message.includes(cause.message)) {
      message += `: ${cause.message}${typeof cause.code === "string" ? ` (${cause.code})` : ""}`;
    }
    return { message, code: typeof e.code === "number" ? e.code : undefined };
  }
  return { message: String(err) };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const TRANSIENT = /fetch failed|other side closed|socket hang up|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT/i;

/**
 * A network-level failure (stale keep-alive socket, reset, DNS blip), as
 * opposed to a JSON-RPC error or a contract error. Seen in the Next.js server
 * after idle periods: the first POSTs on pooled sockets the RPC had closed
 * fail with "fetch failed".
 */
export function isTransientNetworkError(err: unknown): boolean {
  return !(err instanceof HttpError) && TRANSIENT.test(rpcErrorInfo(err).message);
}

/**
 * Retries `call` on transient network errors (100 ms, then 200 ms). Safe for
 * every RPC used here: reads are idempotent, and re-sending a signed
 * transaction is too (same hash, applied at most once; RPC answers DUPLICATE).
 */
export async function retryTransient<T>(call: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= retries || !isTransientNetworkError(err)) throw err;
      await sleep(100 * (attempt + 1));
    }
  }
}

/** Runs an RPC call (retrying network blips) within an optional timeout; failures become 502 RPC_UNAVAILABLE. */
export async function rpcCall<T>(what: string, call: () => Promise<T>, timeoutMs?: number): Promise<T> {
  try {
    return await withTimeout(retryTransient(call), timeoutMs, what);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new RpcError(`${what} failed: ${rpcErrorInfo(err).message}`);
  }
}
