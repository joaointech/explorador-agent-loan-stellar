// Shared bootstrap for the operational scripts: loads apps/web/.env.local
// (values already in the shell win) and gives Node more time per resolved
// address when connecting (slow links otherwise fail every RPC call with
// "fetch failed"). Import it first, then import lib modules dynamically.

import net from "node:net";
import path from "node:path";
import process from "node:process";

net.setDefaultAutoSelectFamilyAttemptTimeout(5_000);

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const WEB_DIR = path.join(REPO_ROOT, "apps", "web");
export const ENV_FILE = path.join(WEB_DIR, ".env.local");

export function loadEnv(file = ENV_FILE): boolean {
  try {
    process.loadEnvFile(file);
    return true;
  } catch {
    return false;
  }
}

/** Timestamped console logger used by every script. */
export function logger(tag: string) {
  const started = Date.now();
  return (message: string) => {
    const secs = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
    console.log(`[${tag} ${secs}s] ${message}`);
  };
}
