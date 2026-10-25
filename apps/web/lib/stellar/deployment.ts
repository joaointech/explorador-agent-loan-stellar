// Contract ids (spec §11.3): the active `Deployment` row, falling back to
// deployments/<network>.json, so a demo reset needs no env change. Network
// settings (rpcUrl, passphrase, explorer) always come from env.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

import { db } from "@/lib/db";
import type { DeploymentInfo } from "@/lib/types/api";

import { networkConfig } from "./config";
import { NotDeployedError } from "./errors";

export interface ResolvedDeployment {
  info: DeploymentInfo;
  source: "db" | "file";
  /** `Deployment.createdAt` (db source only): used to ignore snapshots of older deployments. */
  createdAt: Date | null;
  wasmHashes: Record<string, unknown>;
  /** Stable identity of this set of contracts (indexer cursor id, cache keys). */
  key: string;
}

const CACHE_TTL_MS = 5_000;

const contractId = z.string().refine((s) => StrKey.isValidContract(s), "not a contract id (C…)");
const idsSchema = z.object({ teurc: contractId, cpcvNote: contractId, advancePool: contractId });
const fileSchema = idsSchema.extend({
  network: z.string().optional(),
  wasmHashes: z.record(z.string(), z.unknown()).optional(),
});

type CacheEntry = { at: number; value: ResolvedDeployment | null };
const state = globalThis as unknown as { stellarDeployment?: CacheEntry; stellarDeploymentWarned?: Set<string> };

function warnOnce(key: string, message: string) {
  state.stellarDeploymentWarned ??= new Set();
  if (state.stellarDeploymentWarned.has(key)) return;
  state.stellarDeploymentWarned.add(key);
  console.warn(`[stellar] ${message}`);
}

function build(ids: { teurc: string; cpcvNote: string; advancePool: string }, source: "db" | "file", createdAt: Date | null, wasmHashes: Record<string, unknown>): ResolvedDeployment {
  const net = networkConfig();
  return {
    info: {
      network: net.network,
      rpcUrl: net.rpcUrl,
      networkPassphrase: net.networkPassphrase,
      teurc: ids.teurc,
      cpcvNote: ids.cpcvNote,
      advancePool: ids.advancePool,
      explorerBase: net.explorerBase,
    },
    source,
    createdAt,
    wasmHashes,
    key: `${ids.teurc}:${ids.cpcvNote}:${ids.advancePool}`,
  };
}

async function fromDb(): Promise<ResolvedDeployment | null> {
  try {
    const row = await db.deployment.findFirst({
      where: { active: true, network: networkConfig().network },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    const parsed = idsSchema.safeParse(row);
    if (!parsed.success) {
      warnOnce(`row:${row.id}`, `Deployment row ${row.id} has invalid contract ids; ignoring it`);
      return null;
    }
    const hashes = row.wasmHashes && typeof row.wasmHashes === "object" ? (row.wasmHashes as Record<string, unknown>) : {};
    return build(parsed.data, "db", row.createdAt, hashes);
  } catch (err) {
    warnOnce("db", `could not read the Deployment table (${err instanceof Error ? err.message.split("\n")[0] : String(err)}); falling back to deployments/*.json`);
    return null;
  }
}

/** deployments/<network>.json, looked up from the cwd of Next.js (apps/web), scripts/ or the repo root. */
export function deploymentFileCandidates(network = networkConfig().network, cwd = process.cwd()): string[] {
  return ["deployments", "../deployments", "../../deployments"].map((dir) => path.resolve(cwd, dir, `${network}.json`));
}

async function fromFile(): Promise<ResolvedDeployment | null> {
  for (const file of deploymentFileCandidates()) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed = fileSchema.parse(JSON.parse(raw));
      return build(parsed, "file", null, parsed.wasmHashes ?? {});
    } catch (err) {
      warnOnce(`file:${file}`, `${file} is not a valid deployment file (${err instanceof Error ? err.message : String(err)})`);
      return null;
    }
  }
  return null;
}

/** The current deployment (cached for 5 s), or null when nothing is deployed. */
export async function resolveDeployment(opts: { fresh?: boolean } = {}): Promise<ResolvedDeployment | null> {
  const cached = state.stellarDeployment;
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const value = (await fromDb()) ?? (await fromFile());
  state.stellarDeployment = { at: Date.now(), value };
  return value;
}

/** Like resolveDeployment, but throws a 503 NOT_DEPLOYED HttpError when there is none. */
export async function requireDeployment(): Promise<ResolvedDeployment> {
  const d = await resolveDeployment();
  if (!d) throw new NotDeployedError();
  return d;
}

/** Call after writing a new Deployment row (deploy / demo reset) so the next read picks it up. */
export function invalidateDeploymentCache(): void {
  state.stellarDeployment = undefined;
}
