// Contract ids (from the active Deployment row, falling back to deployments/testnet.json)
// and contract specs (parsed from the committed wasm in apps/web/contracts-wasm).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { contract } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export type ContractName = "teurc" | "cpcvNote" | "advancePool";

export interface Contracts {
  network: string;
  teurc: string;
  cpcvNote: string;
  advancePool: string;
  wasmHashes: Record<string, string>;
  createdAt?: string;
}

const WASM_FILES: Record<ContractName, string> = {
  teurc: "teurc.wasm",
  cpcvNote: "cpcv_note.wasm",
  advancePool: "advance_pool.wasm",
};

/** apps/web root, whether we run inside Next (cwd = apps/web) or a script (cwd = repo root). */
export function webRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "contracts-wasm"))) return cwd;
  const nested = path.join(cwd, "apps", "web");
  if (existsSync(nested)) return nested;
  return cwd;
}

export function repoRoot(): string {
  const web = webRoot();
  return path.resolve(/*turbopackIgnore: true*/ web, "..", "..");
}

export function wasmPath(name: ContractName): string {
  return path.join(webRoot(), "contracts-wasm", WASM_FILES[name]);
}

export function readWasm(name: ContractName): Buffer {
  return readFileSync(wasmPath(name));
}

const specs = new Map<ContractName, contract.Spec>();

export function spec(name: ContractName): contract.Spec {
  let s = specs.get(name);
  if (!s) {
    s = contract.Spec.fromWasm(readWasm(name));
    specs.set(name, s);
  }
  return s;
}

let cache: { at: number; value: Contracts } | null = null;

export function invalidateContracts() {
  cache = null;
}

function readJsonFallback(): Contracts | null {
  const candidates = [path.join(repoRoot(), "deployments", "testnet.json"), path.join(webRoot(), "deployments.json")];
  for (const p of candidates) {
    // Local fallback only (outside apps/web, so not traced); deployed servers use the Deployment row.
    if (existsSync(/*turbopackIgnore: true*/ p)) {
      const j = JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8"));
      return {
        network: j.network ?? env.network,
        teurc: j.contracts?.teurc ?? j.teurc,
        cpcvNote: j.contracts?.cpcvNote ?? j.cpcvNote,
        advancePool: j.contracts?.advancePool ?? j.advancePool,
        wasmHashes: j.wasmHashes ?? {},
        createdAt: j.deployedAt,
      };
    }
  }
  return null;
}

export async function getContracts(): Promise<Contracts> {
  if (cache && Date.now() - cache.at < 5_000) return cache.value;
  let value: Contracts | null = null;
  try {
    const row = await db.deployment.findFirst({ where: { active: true, network: env.network }, orderBy: { createdAt: "desc" } });
    if (row) {
      value = {
        network: row.network,
        teurc: row.teurc,
        cpcvNote: row.cpcvNote,
        advancePool: row.advancePool,
        wasmHashes: row.wasmHashes as Record<string, string>,
        createdAt: row.createdAt.toISOString(),
      };
    }
  } catch (e) {
    console.warn("deployment lookup failed, using deployments/testnet.json", e);
  }
  value ??= readJsonFallback();
  if (!value) throw new Error("No deployment found. Run `pnpm deploy:testnet`.");
  cache = { at: Date.now(), value };
  return value;
}

export async function contractId(name: ContractName): Promise<string> {
  return (await getContracts())[name];
}
