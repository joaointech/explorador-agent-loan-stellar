// Locates the committed circuit artifacts in apps/web/zk (spec §6, §8.6).
// Node only. Resolution is relative to process.cwd(), which is apps/web for
// `next dev`/`next start`, Vitest and Vercel functions (with the files traced
// via `outputFileTracingIncludes`), scripts/ for `pnpm --filter @advance/scripts …`
// and the repo root for ad-hoc runs. `ZK_ARTIFACTS_DIR` overrides it.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SnarkjsVerificationKey } from "./format";

export const WASM_FILE = "cpcv_attestation.wasm";
export const ZKEY_FILE = "cpcv_attestation_final.zkey";
export const VK_FILE = "verification_key.json";
export const VK_SOROBAN_FILE = "verification_key.soroban.json";

export interface ZkArtifacts {
  dir: string;
  wasm: string;
  zkey: string;
  vk: string;
}

let cached: ZkArtifacts | undefined;

function candidates(): string[] {
  const cwd = process.cwd();
  const fromEnv = process.env.ZK_ARTIFACTS_DIR;
  return [
    // Script-only fallbacks are marked turbopackIgnore so `next build` does not
    // trace the whole project; the Next.js location stays statically scoped.
    ...(fromEnv ? [path.resolve(/*turbopackIgnore: true*/ cwd, fromEnv)] : []),
    path.join(process.cwd(), "zk"),
    path.join(/*turbopackIgnore: true*/ cwd, "apps", "web", "zk"),
    path.join(/*turbopackIgnore: true*/ cwd, "..", "apps", "web", "zk"),
    path.join(/*turbopackIgnore: true*/ cwd, "..", "..", "apps", "web", "zk"),
  ];
}

/** Absolute paths of the wasm, zkey and verification key; throws a clear error if they are missing. */
export function zkArtifacts(): ZkArtifacts {
  if (cached) return cached;
  for (const dir of candidates()) {
    const wasm = path.join(/*turbopackIgnore: true*/ dir, WASM_FILE);
    const zkey = path.join(/*turbopackIgnore: true*/ dir, ZKEY_FILE);
    const vk = path.join(/*turbopackIgnore: true*/ dir, VK_FILE);
    if (existsSync(wasm) && existsSync(zkey) && existsSync(vk)) {
      cached = { dir, wasm, zkey, vk };
      return cached;
    }
  }
  throw new Error(
    `ZK artifacts not found (looked for ${WASM_FILE}, ${ZKEY_FILE}, ${VK_FILE} in: ${candidates().join(", ")}). ` +
      "Run `pnpm circuits:build` or set ZK_ARTIFACTS_DIR.",
  );
}

let vkCache: SnarkjsVerificationKey | undefined;

/** apps/web/zk/verification_key.json (also served at /zk/verification_key.json). */
export function loadVerificationKey(): SnarkjsVerificationKey {
  vkCache ??= JSON.parse(readFileSync(/*turbopackIgnore: true*/ zkArtifacts().vk, "utf8")) as SnarkjsVerificationKey;
  return vkCache;
}
