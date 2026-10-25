// Long-running event indexer for local dev (spec §9.6, §11.1): `pnpm indexer`.
// Polls Soroban RPC and writes ChainEvent / PoolSnapshot rows, like the
// sync-on-read that API routes do. Options: --interval=<ms> (default 5000),
// --once (single pass, exit code 1 on error).

import path from "node:path";
import process from "node:process";

const envFile = path.resolve(import.meta.dirname, "../apps/web/.env.local");
try {
  process.loadEnvFile(envFile);
} catch {
  console.warn(`[indexer] ${envFile} not found; using the current environment`);
}

// Imported after the env file: lib/db reads DATABASE_URL at import time.
const { runSync } = await import("@/lib/indexer/sync");
const { db } = await import("@/lib/db");

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const intervalMs = Math.max(1_000, Number(arg("interval")?.split("=")[1] ?? 5_000) || 5_000);
const once = Boolean(arg("once"));

let stopping = false;
let wake: (() => void) | undefined;
const stop = () => {
  stopping = true;
  wake?.();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function describe(r: Awaited<ReturnType<typeof runSync>>): string {
  if (r.status === "skipped") return `skipped (${r.reason})`;
  if (r.status === "error") return `error: ${r.reason}`;
  const range = `ledgers ${r.fromLedger}→${r.toLedger}`;
  const events = `+${r.inserted} event${r.inserted === 1 ? "" : "s"}`;
  const gap = r.gap ? `, lost ${r.gap.from}–${r.gap.to} to retention` : "";
  return `ok ${range} (${events}${r.snapshot ? ", snapshot" : ""}${gap}) ${r.durationMs} ms`;
}

console.log(`[indexer] polling every ${intervalMs} ms${once ? " (once)" : ""}; Ctrl+C to stop`);
let failed = false;
while (!stopping) {
  const result = await runSync();
  failed = result.status === "error";
  if (result.inserted > 0 || result.status !== "ok" || once) console.log(`[indexer] ${new Date().toISOString()} ${describe(result)}`);
  if (once) break;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

await db.$disconnect();
if (once && failed) process.exit(1);
