// Test helpers for the CPCV attestation circuit. This is an independent JS
// implementation of the input encoding (spec §8.3–8.4), deliberately not
// shared with apps/web/lib/zk, so the circuit tests cross-check it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEddsa } from "circomlibjs";
import * as snarkjs from "snarkjs";

export { snarkjs };

export const CIRCUITS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = join(CIRCUITS_DIR, "..");
export const SOURCE = join(CIRCUITS_DIR, "cpcv_attestation.circom");
export const ZK_DIR = join(REPO_DIR, "apps", "web", "zk");

/** BN254 scalar field modulus r. */
export const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Fixed test keys (never used outside tests). */
export const ATTESTER_PRIVKEY = Buffer.from("a1".repeat(32), "hex");
export const OTHER_PRIVKEY = Buffer.from("b2".repeat(32), "hex");

const DAY_MS = 86_400_000;
export const dayOf = (y, m, d) => BigInt(Math.floor(Date.UTC(y, m - 1, d) / DAY_MS));

let ctxPromise;
/** circomlibjs EdDSA + Poseidon, built once. */
export function zk() {
  ctxPromise ??= buildEddsa().then((eddsa) => {
    const F = eddsa.F;
    const poseidon = (xs) => F.toObject(eddsa.poseidon(xs.map((x) => BigInt(x))));
    return { eddsa, F, poseidon };
  });
  return ctxPromise;
}

/** Big-endian bytes → bigint. */
const beToBigInt = (bytes) => (bytes.length === 0 ? 0n : BigInt("0x" + Buffer.from(bytes).toString("hex")));

/**
 * property_hash (spec §8.4): lowercase, trim and collapse whitespace; UTF-8;
 * 31-byte chunks (max 8, zero-padded, each read big-endian);
 * Poseidon(len_bytes, chunk_0 … chunk_7) in one 9-input call.
 */
export async function propertyHash(address) {
  const { poseidon } = await zk();
  const normalized = address.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
  const bytes = Buffer.from(normalized, "utf8");
  if (bytes.length > 8 * 31) throw new Error("address too long");
  const chunks = [];
  for (let i = 0; i < 8; i++) {
    const chunk = Buffer.alloc(31);
    bytes.subarray(i * 31, (i + 1) * 31).copy(chunk);
    chunks.push(beToBigInt(chunk));
  }
  return poseidon([BigInt(bytes.length), ...chunks]);
}

/** The worked example of spec §5.6: €300,000 at 5% → €15,000 total commission. */
export const BASE_DEAL = {
  agent_field: BigInt("0x00" + "5c".repeat(31)),
  buyer_nif: 123456789n,
  seller_nif: 987654321n,
  sale_price_cents: 30_000_000n,
  commission_rate_bps: 500n,
  property_address: "Rua Augusta 100, 1100-053 Lisboa",
  cpcv_day: dayOf(2026, 10, 25),
  escritura_day: dayOf(2027, 1, 23),
  salt: BigInt("0x" + "3d".repeat(31)),
  nullifier_secret: BigInt("0x" + "0e".repeat(31)),
};

/**
 * Builds a circuit input. Every derived value is recomputed from the deal so
 * that a test can violate exactly one constraint through `override`:
 *   total, agent, commitment, nullifier, nsc  → replace a derived value
 *   signer                                    → private key used to sign
 *   tamper(input)                             → last-minute edits
 * The message is always signed over the (possibly overridden) public values.
 */
export async function buildInput(dealOverrides = {}, override = {}) {
  const { eddsa, F, poseidon } = await zk();
  const d = { ...BASE_DEAL, ...dealOverrides };
  const property_hash = d.property_hash ?? (await propertyHash(d.property_address));

  const total = override.total ?? (d.sale_price_cents * d.commission_rate_bps) / 10_000n;
  const agent = override.agent ?? total / 2n;
  const commitment =
    override.commitment ??
    poseidon([
      d.buyer_nif,
      d.seller_nif,
      d.sale_price_cents,
      d.commission_rate_bps,
      property_hash,
      d.cpcv_day,
      d.escritura_day,
      d.salt,
    ]);
  const nullifier =
    override.nullifier ?? poseidon([property_hash, d.buyer_nif, d.seller_nif, d.cpcv_day, d.nullifier_secret]);
  const nsc = override.nsc ?? poseidon([d.nullifier_secret]);

  const [ax, ay] = eddsa.prv2pub(ATTESTER_PRIVKEY).map((c) => F.toObject(c));
  const msg = poseidon([commitment, d.agent_field, total, d.escritura_day, nullifier]);
  const sig = eddsa.signPoseidon(override.signer ?? ATTESTER_PRIVKEY, F.e(msg));

  const input = {
    agent_field: d.agent_field,
    total_commission_cents: total,
    agent_commission_cents: agent,
    escritura_day: d.escritura_day,
    commitment,
    nullifier,
    attester_ax: ax,
    attester_ay: ay,
    nullifier_secret_commitment: nsc,
    buyer_nif: d.buyer_nif,
    seller_nif: d.seller_nif,
    sale_price_cents: d.sale_price_cents,
    commission_rate_bps: d.commission_rate_bps,
    property_hash,
    cpcv_day: d.cpcv_day,
    salt: d.salt,
    nullifier_secret: d.nullifier_secret,
    sig_r8x: F.toObject(sig.R8[0]),
    sig_r8y: F.toObject(sig.R8[1]),
    sig_s: sig.S,
  };
  if (override.tamper) override.tamper(input);
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v.toString()]));
}

/** The public signals in spec §8.2 order. */
export const PUBLIC_ORDER = [
  "agent_field",
  "total_commission_cents",
  "agent_commission_cents",
  "escritura_day",
  "commitment",
  "nullifier",
  "attester_ax",
  "attester_ay",
  "nullifier_secret_commitment",
];

/** Compiles the circuit from source into circuits/build/test (fresh on every test run). */
export function compileCircuit() {
  const out = join(CIRCUITS_DIR, "build", "test");
  mkdirSync(out, { recursive: true });
  execFileSync("circom", [SOURCE, "--r1cs", "--wasm", "--sym", "-o", out, "-l", join(CIRCUITS_DIR, "node_modules")], {
    stdio: "pipe",
  });
  return {
    wasm: join(out, "cpcv_attestation_js", "cpcv_attestation.wasm"),
    r1cs: join(out, "cpcv_attestation.r1cs"),
  };
}

/** 1-based line number of the unique source line containing `marker`. */
export function sourceLine(marker) {
  const lines = readFileSync(SOURCE, "utf8").split("\n");
  const hits = lines.flatMap((l, i) => (l.includes(marker) ? [i + 1] : []));
  if (hits.length !== 1) throw new Error(`marker ${JSON.stringify(marker)} found ${hits.length} times`);
  return hits[0];
}

/** Runs `fn` with the witness calculator's console error output silenced. */
export async function quietly(fn) {
  const { error, log } = console;
  console.error = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
    console.log = log;
  }
}

/** Committed artifacts produced by build.sh, or null when not built yet. */
export function committedArtifacts() {
  const wasm = join(ZK_DIR, "cpcv_attestation.wasm");
  const zkey = join(ZK_DIR, "cpcv_attestation_final.zkey");
  const vk = join(ZK_DIR, "verification_key.json");
  if (![wasm, zkey, vk].every(existsSync)) return null;
  return { wasm, zkey, vk: JSON.parse(readFileSync(vk, "utf8")) };
}

/** Terminates snarkjs' cached worker threads so the test process can exit. */
export async function releaseCurve() {
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
}
