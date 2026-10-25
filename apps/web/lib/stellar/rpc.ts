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

/** JSON-RPC error message/code from whatever the SDK threw. */
export function rpcErrorInfo(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown };
    return {
      message: typeof e.message === "string" ? e.message : String(err),
      code: typeof e.code === "number" ? e.code : undefined,
    };
  }
  return { message: String(err) };
}

/** Runs an RPC call with an optional timeout; transport/JSON-RPC failures become 502 RPC_UNAVAILABLE. */
export async function rpcCall<T>(what: string, call: () => Promise<T>, timeoutMs?: number): Promise<T> {
  try {
    return await withTimeout(call(), timeoutMs, what);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new RpcError(`${what} failed: ${rpcErrorInfo(err).message}`);
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
