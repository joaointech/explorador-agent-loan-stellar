// Contract deployment wiring (§7.4). Shared by `pnpm deploy:testnet`, `pnpm demo:reset`
// and the admin "Reset demo" button.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Address, Operation, xdr } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resetIndexer } from "@/lib/indexer/sync";
import { invoke, latestLedger, simulateOp, submitOperation } from "@/lib/stellar/client";
import { invalidateContracts, readWasm, repoRoot, spec, webRoot, type ContractName } from "@/lib/stellar/contracts";
import { accountExists, ensureXlm, friendbot, publicKey, rpcServer, type Role } from "@/lib/stellar/network";
import { attesterConstructorValues } from "@/lib/zk/prove";

export const TEURC = 10_000_000n; // 1 tEURC in stroops
export const TREASURY_MINT = 1_000_000n * TEURC;
export const JUNIOR_SEED = 10_000n * TEURC;

export type Log = (line: string) => void;

export interface DeployResult {
  teurc: string;
  cpcvNote: string;
  advancePool: string;
  wasmHashes: Record<ContractName, string>;
  startLedger: number;
}

export function poolParams() {
  return {
    agent_apr_bps: 1200,
    protocol_fee_bps: 1000,
    senior_target_bps: 800,
    ltv_bps: 5000,
    grace_period_secs: BigInt(180 * 86_400),
    max_leverage: 10,
    demo_mode: env.demoMode,
  };
}

export async function ensureFunded(log: Log, roles: Role[] = ["admin", "operator", "treasury", "sponsor"]) {
  for (const role of roles) {
    const pub = publicKey(role);
    if (!(await accountExists(pub))) {
      log(`Funding ${role} ${pub} with Friendbot`);
      await friendbot(pub);
    }
  }
  if (env.cardSettlementPublic && !(await accountExists(env.cardSettlementPublic))) {
    log(`Funding card settlement ${env.cardSettlementPublic} with Friendbot`);
    await friendbot(env.cardSettlementPublic);
  }
}

async function wasmInstalled(hash: Buffer): Promise<boolean> {
  const key = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash }));
  const r = await rpcServer().getLedgerEntries(key);
  return r.entries.length > 0;
}

/** Uploads the wasm unless the network already has it (content-addressed by sha256). */
export async function uploadWasm(name: ContractName, log: Log): Promise<string> {
  const wasm = readWasm(name);
  const hash = createHash("sha256").update(wasm).digest();
  if (await wasmInstalled(hash)) {
    log(`${name}: wasm ${hash.toString("hex").slice(0, 12)}… already on the network`);
  } else {
    // Code rent is surcharged on testnet (thousands of XLM per contract); top up from the simulated fee.
    const op = Operation.uploadContractWasm({ wasm });
    const sim = await simulateOp(op, publicKey("admin"));
    const feeXlm = Number(BigInt(sim.minResourceFee) / 10_000_000n);
    log(`${name}: upload fee ≈ ${feeXlm.toLocaleString("en-GB")} XLM`);
    await ensureXlm(publicKey("admin"), feeXlm + 500, log);
    log(`${name}: uploading wasm (${wasm.length} bytes)`);
    await submitOperation(Operation.uploadContractWasm({ wasm }), { source: "admin" });
  }
  return hash.toString("hex");
}

async function deployContract(name: ContractName, wasmHash: string, args: Record<string, unknown>, log: Log): Promise<string> {
  const deployer = publicKey("admin");
  const salt = randomBytes(32);
  const constructorArgs = spec(name).funcArgsToScVals("__constructor", args);
  const op = Operation.createCustomContract({ address: new Address(deployer), wasmHash: Buffer.from(wasmHash, "hex"), salt, constructorArgs });
  const r = await submitOperation(op, { source: "admin" });
  const id = r.returnValue ? Address.fromScVal(r.returnValue).toString() : "";
  if (!id) throw new Error(`${name}: deploy returned no address`);
  log(`${name}: deployed ${id}`);
  return id;
}

function loadSorobanVk() {
  const vk = JSON.parse(readFileSync(path.join(webRoot(), "zk", "verification_key.soroban.json"), "utf8")) as {
    alpha: string;
    beta: string;
    gamma: string;
    delta: string;
    ic: string[];
  };
  const b = (h: string) => Buffer.from(h, "hex");
  return { alpha: b(vk.alpha), beta: b(vk.beta), gamma: b(vk.gamma), delta: b(vk.delta), ic: vk.ic.map(b) };
}

/** §7.4 steps 1–6, then records the deployment (JSON + Deployment row) and resets the indexer. */
export async function deployAll(log: Log = console.log): Promise<DeployResult> {
  await ensureFunded(log);
  // Every role pays surcharged rent on the entries it creates; keep a comfortable float.
  for (const role of ["admin", "operator", "treasury", "sponsor"] as const) await ensureXlm(publicKey(role), 5_000, log);
  const startLedger = await latestLedger();

  const wasmHashes = {
    teurc: await uploadWasm("teurc", log),
    cpcvNote: await uploadWasm("cpcvNote", log),
    advancePool: await uploadWasm("advancePool", log),
  };

  const admin = publicKey("admin");
  const operator = publicKey("operator");
  const treasury = publicKey("treasury");

  const teurc = await deployContract("teurc", wasmHashes.teurc, { admin }, log);

  const att = await attesterConstructorValues();
  const cpcvNote = await deployContract(
    "cpcvNote",
    wasmHashes.cpcvNote,
    {
      admin,
      operator,
      attester_ax: Buffer.from(att.ax, "hex"),
      attester_ay: Buffer.from(att.ay, "hex"),
      nullifier_secret_commitment: Buffer.from(att.nsc, "hex"),
      vk: loadSorobanVk(),
      base_uri: `${env.appUrl.replace(/\/$/, "")}/api/registry`,
    },
    log,
  );

  const advancePool = await deployContract(
    "advancePool",
    wasmHashes.advancePool,
    {
      admin,
      operator,
      treasury,
      card_settlement: env.cardSettlementPublic,
      asset: teurc,
      note_contract: cpcvNote,
      params: poolParams(),
    },
    log,
  );

  await invoke("cpcvNote", "set_pool", { pool: advancePool }, { source: "admin", contract: cpcvNote });
  log("cpcv_note.set_pool done");
  await invoke("teurc", "mint", { to: treasury, amount: TREASURY_MINT }, { source: "admin", contract: teurc });
  log("Minted 1,000,000 tEURC to treasury");
  await invoke("advancePool", "junior_deposit", { amount: JUNIOR_SEED }, { source: "treasury", contract: advancePool });
  log("Junior tranche seeded with 10,000 tEURC");

  const result: DeployResult = { teurc, cpcvNote, advancePool, wasmHashes, startLedger };
  await recordDeployment(result);
  log("Deployment recorded (deployments/testnet.json + Deployment row)");
  return result;
}

export function writeDeploymentJson(r: Omit<DeployResult, "startLedger"> & { startLedger?: number }, deployedAt = new Date().toISOString()) {
  const json = {
    network: env.network,
    rpcUrl: env.rpcUrl,
    deployedAt,
    contracts: { teurc: r.teurc, cpcvNote: r.cpcvNote, advancePool: r.advancePool },
    wasmHashes: r.wasmHashes,
    roles: {
      admin: publicKey("admin"),
      operator: publicKey("operator"),
      treasury: publicKey("treasury"),
      sponsor: publicKey("sponsor"),
      cardSettlement: env.cardSettlementPublic,
    },
    startLedger: r.startLedger,
  };
  try {
    const dir = path.join(repoRoot(), "deployments");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${env.network}.json`), JSON.stringify(json, null, 2) + "\n");
  } catch (e) {
    // Read-only filesystems (Vercel): the Deployment row is the source of truth.
    console.warn("could not write deployments json:", e instanceof Error ? e.message : e);
  }
}

export async function recordDeployment(r: DeployResult) {
  writeDeploymentJson(r);
  await db.$transaction([
    db.deployment.updateMany({ where: { network: env.network, active: true }, data: { active: false } }),
    db.deployment.create({
      data: { network: env.network, teurc: r.teurc, cpcvNote: r.cpcvNote, advancePool: r.advancePool, wasmHashes: r.wasmHashes, active: true },
    }),
  ]);
  invalidateContracts();
  await resetIndexer(r.startLedger);
}
