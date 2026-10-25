// Contract deployment and wiring (spec §7.4), shared by `pnpm deploy:testnet`,
// the demo reset (redeploy from the stored wasm hashes, no upload) and
// `pnpm e2e` (fresh contracts in its own database):
//   upload wasm (deploy:testnet only) → teurc(admin) → cpcv_note(admin, operator,
//   attester key, nullifier-secret commitment, vk, base_uri) → advance_pool(admin,
//   operator, treasury, card_settlement, teurc, cpcv_note, params) →
//   cpcv_note.set_pool → mint 1,000,000 tEURC to treasury → junior_deposit(10,000)
// then an active Deployment row (older ones deactivated) and, for local runs,
// deployments/testnet.json.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Address, xdr } from "@stellar/stellar-sdk";

import { db, Prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { adminKeypair, networkConfig, operatorKeypair, roleKeypair, treasuryKeypair } from "@/lib/stellar/config";
import { invalidateDeploymentCache, resolveDeployment } from "@/lib/stellar/deployment";
import { NotConfiguredError } from "@/lib/stellar/errors";
import { getRpc, rpcCall } from "@/lib/stellar/rpc";
import { asAddress, scAddress, scBool, scBytes, scI128, scStruct, scU32, scU64 } from "@/lib/stellar/scval";
import { PARAMS, STROOPS_PER_EUR } from "@/lib/units";
import { VK_SOROBAN_FILE, zkArtifacts } from "@/lib/zk/artifacts";
import { fromHex } from "@/lib/zk/field";
import { attesterParams, parseAttesterKey } from "@/lib/zk/keys";
import { zkKeysFromEnv } from "@/lib/zk/prove";

import { ensureXlm, STROOPS_PER_XLM, type Log } from "./accounts";
import { submitHostFunction, type HostFunctionResult } from "./tx";

export const CONTRACTS = ["teurc", "cpcvNote", "advancePool"] as const;
export type ContractKey = (typeof CONTRACTS)[number];
/** Crate / wasm file name of each contract (contracts/target/wasm32v1-none/release/<name>.wasm). */
export const CRATE: Record<ContractKey, string> = { teurc: "teurc", cpcvNote: "cpcv_note", advancePool: "advance_pool" };
export type WasmHashes = Record<ContractKey, string>;

/** Treasury float minted at deploy, and the junior seed (spec §2, §7.4). */
export const TREASURY_MINT = 1_000_000n * STROOPS_PER_EUR;
export const JUNIOR_SEED = 10_000n * STROOPS_PER_EUR;

export interface DeployResult {
  network: "testnet";
  teurc: string;
  cpcvNote: string;
  advancePool: string;
  wasmHashes: WasmHashes;
  /** Step → transaction hash. */
  txs: Record<string, string>;
  admin: string;
  operator: string;
  treasury: string;
  cardSettlement: string;
  baseUri: string;
  demoMode: boolean;
  deployedAt: string;
  /** XLM fees paid by the deployer for this run, in stroops. */
  feesStroops: string;
}

const isHash = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

export const wasmHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function codeKey(hashHex: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(hashHex, "hex") }));
}

/** "live", "archived" (TTL expired: simulation restores it) or "missing" (never uploaded, or testnet reset). */
export async function codeStatus(hashHex: string): Promise<"live" | "archived" | "missing"> {
  const res = await rpcCall("getLedgerEntries", () => getRpc().getLedgerEntries(codeKey(hashHex)));
  const entry = res.entries[0];
  if (!entry) return "missing";
  return entry.liveUntilLedgerSeq !== undefined && entry.liveUntilLedgerSeq < res.latestLedger ? "archived" : "live";
}

function invokeFunc(contract: string, fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args }),
  );
}

function createFunc(deployer: string, hashHex: string, constructorArgs: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({ address: new Address(deployer).toScAddress(), salt: randomBytes(32) }),
      ),
      executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(hashHex, "hex")),
      constructorArgs,
    }),
  );
}

/** Uploads a contract WASM as admin unless that code is already on the network. */
export async function uploadWasm(name: string, bytes: Uint8Array, log: Log): Promise<{ hash: string; tx: HostFunctionResult | null }> {
  const hash = wasmHash(bytes);
  const status = await codeStatus(hash);
  if (status === "live") {
    log(`${name}: wasm ${hash.slice(0, 12)}… already uploaded`);
    return { hash, tx: null };
  }
  log(`${name}: uploading ${(bytes.length / 1024).toFixed(1)} KB wasm${status === "archived" ? " (archived copy found)" : ""}`);
  const admin = adminKeypair();
  const tx = await submitHostFunction({
    func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from(bytes)),
    source: admin,
    label: `upload ${name}`,
    // Upload fees reach thousands of XLM when testnet fees spike: top the admin up first.
    beforeSubmit: async (fee) => {
      log(`${name}: upload fee ${(Number(fee) / 1e7).toFixed(2)} XLM`);
      await ensureXlm(admin.publicKey(), Number(fee / STROOPS_PER_XLM) + 300, log);
    },
  });
  log(`${name}: uploaded ${hash.slice(0, 12)}… (tx ${tx.txHash}, fee ${(Number(tx.feeCharged) / 1e7).toFixed(2)} XLM${tx.feeBumped ? ", fee bump" : ""})`);
  return { hash, tx };
}

interface VkHex {
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  ic: string[];
}

/** apps/web/zk/verification_key.soroban.json as the cpcv_note `VerificationKey` struct. */
export function verificationKeyScVal(): xdr.ScVal {
  const vk = JSON.parse(readFileSync(/* turbopackIgnore: true */ path.join(zkArtifacts().dir, VK_SOROBAN_FILE), "utf8")) as VkHex;
  if (!Array.isArray(vk.ic) || vk.ic.length !== 10) throw new Error(`${VK_SOROBAN_FILE}: expected 10 ic points`);
  return scStruct({
    alpha: scBytes(fromHex(vk.alpha), 64),
    beta: scBytes(fromHex(vk.beta), 128),
    gamma: scBytes(fromHex(vk.gamma), 128),
    delta: scBytes(fromHex(vk.delta), 128),
    ic: xdr.ScVal.scvVec(vk.ic.map((p) => scBytes(fromHex(p), 64))),
  });
}

/** `${APP_URL}/api/notes`: token_uri(id) = base_uri + "/" + id resolves to GET /api/notes/[id]. */
export const noteBaseUri = (appUrl = env().APP_URL): string => `${appUrl.replace(/\/+$/, "")}/api/notes`;

/** advance_pool `Params` (spec §5.1). */
export function poolParamsScVal(demoMode: boolean): xdr.ScVal {
  return scStruct({
    agent_apr_bps: scU32(PARAMS.agentAprBps),
    protocol_fee_bps: scU32(PARAMS.protocolFeeBps),
    senior_target_bps: scU32(PARAMS.seniorTargetBps),
    ltv_bps: scU32(PARAMS.ltvBps),
    grace_period_secs: scU64(PARAMS.gracePeriodSecs),
    max_leverage: scU32(PARAMS.maxLeverage),
    demo_mode: scBool(demoMode),
  });
}

function cardSettlementAddress(): string {
  const value = env().CARD_SETTLEMENT_PUBLIC;
  if (!value) throw new NotConfiguredError("CARD_SETTLEMENT_PUBLIC is not set (run pnpm keys:generate)");
  return value;
}

/** Wasm hashes of the current deployment (Deployment row, else deployments/testnet.json), for redeploys. */
export async function storedWasmHashes(): Promise<WasmHashes> {
  const deployment = await resolveDeployment({ fresh: true });
  const hashes = deployment?.wasmHashes ?? {};
  const out = Object.fromEntries(CONTRACTS.map((k) => [k, hashes[k] ?? hashes[CRATE[k]]])) as Record<ContractKey, unknown>;
  if (!CONTRACTS.every((k) => isHash(out[k]))) {
    throw new NotConfiguredError("No stored wasm hashes: run pnpm deploy:testnet first (it uploads the contracts)");
  }
  return out as WasmHashes;
}

export interface DeployOptions {
  wasmHashes: WasmHashes;
  log: Log;
  /** Defaults to DEMO_MODE. */
  demoMode?: boolean;
  /** Defaults to `${APP_URL}/api/notes`. */
  baseUri?: string;
}

/** Deploys and wires a fresh set of contracts from already-uploaded wasm. Takes ~1 minute on testnet. */
export async function deployContracts(opts: DeployOptions): Promise<DeployResult> {
  const { log } = opts;
  const admin = adminKeypair();
  const operator = operatorKeypair();
  const treasury = treasuryKeypair();
  roleKeypair("SPONSOR_SECRET"); // fail early: agents can't be onboarded without it
  const cardSettlement = cardSettlementAddress();
  const demoMode = opts.demoMode ?? env().DEMO_MODE;
  const baseUri = opts.baseUri ?? noteBaseUri();
  const keys = zkKeysFromEnv();
  parseAttesterKey(keys.attesterPrivKey);

  for (const key of CONTRACTS) {
    const status = await codeStatus(opts.wasmHashes[key]);
    if (status === "missing") {
      throw new NotConfiguredError(`${CRATE[key]} wasm ${opts.wasmHashes[key].slice(0, 12)}… is not on ${networkConfig().network} (testnet reset?): run pnpm deploy:testnet`);
    }
  }

  let fees = 0n;
  const txs: Record<string, string> = {};
  const run = async (step: string, func: xdr.HostFunction, signers: typeof admin[] = []) => {
    const res = await submitHostFunction({
      func,
      source: admin,
      signers,
      label: step,
      beforeSubmit: (fee) => ensureXlm(admin.publicKey(), Number(fee / STROOPS_PER_XLM) + 100, log).then(() => undefined),
    });
    fees += res.feeCharged;
    txs[step] = res.txHash;
    log(`${step}: tx ${res.txHash} (fee ${(Number(res.feeCharged) / 1e7).toFixed(2)} XLM${res.feeBumped ? ", fee bump" : ""})`);
    return res;
  };
  const deploy = async (key: ContractKey, args: xdr.ScVal[]) => {
    const res = await run(`deploy ${CRATE[key]}`, createFunc(admin.publicKey(), opts.wasmHashes[key], args));
    if (!res.returnValue) throw new Error(`deploy ${CRATE[key]} returned no contract address`);
    const id = asAddress(res.returnValue, `deploy ${CRATE[key]}`);
    log(`${CRATE[key]}: ${id}`);
    return id;
  };

  const teurc = await deploy("teurc", [scAddress(admin.publicKey())]);
  const att = await attesterParams(keys);
  const cpcvNote = await deploy("cpcvNote", [
    scAddress(admin.publicKey()),
    scAddress(operator.publicKey()),
    scBytes(att.attesterAx, 32),
    scBytes(att.attesterAy, 32),
    scBytes(att.nullifierSecretCommitment, 32),
    verificationKeyScVal(),
    xdr.ScVal.scvString(baseUri),
  ]);
  const advancePool = await deploy("advancePool", [
    scAddress(admin.publicKey()),
    scAddress(operator.publicKey()),
    scAddress(treasury.publicKey()),
    scAddress(cardSettlement),
    scAddress(teurc),
    scAddress(cpcvNote),
    poolParamsScVal(demoMode),
  ]);

  await run("cpcv_note.set_pool", invokeFunc(cpcvNote, "set_pool", [scAddress(advancePool)]));
  await run("teurc.mint treasury 1,000,000", invokeFunc(teurc, "mint", [scAddress(treasury.publicKey()), scI128(TREASURY_MINT)]));
  await run("advance_pool.junior_deposit 10,000", invokeFunc(advancePool, "junior_deposit", [scI128(JUNIOR_SEED)]), [treasury]);

  return {
    network: networkConfig().network,
    teurc,
    cpcvNote,
    advancePool,
    wasmHashes: opts.wasmHashes,
    txs,
    admin: admin.publicKey(),
    operator: operator.publicKey(),
    treasury: treasury.publicKey(),
    cardSettlement,
    baseUri,
    demoMode,
    deployedAt: new Date().toISOString(),
    feesStroops: fees.toString(),
  };
}

/**
 * Makes `result` the active deployment: deactivates older rows of the network,
 * inserts the new row, clears the deployment cache and, when `file` is given,
 * writes deployments/<network>.json.
 */
export async function recordDeployment(result: DeployResult, opts: { file?: string } = {}): Promise<void> {
  await db.$transaction([
    db.deployment.updateMany({ where: { network: result.network, active: true }, data: { active: false } }),
    db.deployment.create({
      data: {
        network: result.network,
        active: true,
        teurc: result.teurc,
        cpcvNote: result.cpcvNote,
        advancePool: result.advancePool,
        wasmHashes: result.wasmHashes,
      },
    }),
    // Note ids restart at 1 on every cpcv_note contract, but Cpcv.noteId is unique: detach the
    // rows of the previous contracts (kept, with their PII and tx hashes) so new mints can link.
    db.cpcv.updateMany({ where: { noteId: { not: null } }, data: { noteId: null } }),
    // Card consent is per pool: nobody has enabled their card on the new one yet.
    db.agent.updateMany({ data: { cardEnabledOnChain: false, cachedPosition: Prisma.DbNull, cachedAt: null } }),
  ]);
  invalidateDeploymentCache();
  if (opts.file) writeFileSync(/* turbopackIgnore: true */ opts.file, `${JSON.stringify(deploymentFileContent(result), null, 2)}\n`);
}

/** deployments/testnet.json: contract ids + wasm hashes (spec §7.4) plus the wiring facts worth keeping. */
export function deploymentFileContent(r: DeployResult) {
  return {
    network: r.network,
    teurc: r.teurc,
    cpcvNote: r.cpcvNote,
    advancePool: r.advancePool,
    wasmHashes: r.wasmHashes,
    deployedAt: r.deployedAt,
    roles: { admin: r.admin, operator: r.operator, treasury: r.treasury, cardSettlement: r.cardSettlement },
    baseUri: r.baseUri,
    demoMode: r.demoMode,
    txs: r.txs,
  };
}
