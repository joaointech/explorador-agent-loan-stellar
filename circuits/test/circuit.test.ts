// Circuit tests (§12.1): a valid witness, and each constraint violated on its own fails.
// Uses the compiled circuit wasm in apps/web/zk (built by circuits/build.sh).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { StrKey } from "@stellar/stellar-sdk";
import * as snarkjs from "snarkjs";
import { buildAttestation, poseidon, signPoseidon, type CpcvRecord } from "../../packages/zk/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const WASM = path.join(here, "..", "..", "apps", "web", "zk", "cpcv_attestation.wasm");
const wasm = new Uint8Array(readFileSync(WASM));

const sha = (s: string) => createHash("sha256").update(s).digest();
const KEYS = {
  attesterPrivHex: sha("explorador advance TEST attester key").toString("hex"),
  nullifierSecret: BigInt("0x" + sha("explorador advance TEST nullifier secret").subarray(0, 31).toString("hex")),
};
const AGENT = StrKey.encodeContract(sha("fixture agent smart account"));

const DEAL: CpcvRecord = {
  buyerNif: 245871336,
  sellerNif: 198453270,
  salePriceCents: 30_000_000n,
  commissionRateBps: 500,
  propertyAddress: "Rua Augusta 100, 3.º Esq, 1100-053 Lisboa",
  cpcvDay: 20000,
  escrituraDay: 20090,
};

type Input = Record<string, string>;

async function witnessOk(input: Input): Promise<boolean> {
  const wtns = { type: "mem" } as { type: "mem"; data?: Uint8Array };
  try {
    await (snarkjs as unknown as { wtns: { calculate(i: Input, w: Uint8Array, o: object): Promise<void> } }).wtns.calculate(input, wasm, wtns);
    return true;
  } catch {
    return false;
  }
}

/** Re-signs msg after tampering public values so only the targeted constraint can fail. */
async function resign(input: Input): Promise<Input> {
  const msg = await poseidon([
    BigInt(input.commitment),
    BigInt(input.agent_field),
    BigInt(input.total_commission_cents),
    BigInt(input.escritura_day),
    BigInt(input.nullifier),
  ]);
  const sig = await signPoseidon(KEYS.attesterPrivHex, msg);
  return { ...input, sig_r8x: sig.r8x.toString(), sig_r8y: sig.r8y.toString(), sig_s: sig.s.toString() };
}

async function commitmentOf(i: Input): Promise<string> {
  return (
    await poseidon([
      BigInt(i.buyer_nif),
      BigInt(i.seller_nif),
      BigInt(i.sale_price_cents),
      BigInt(i.commission_rate_bps),
      BigInt(i.property_hash),
      BigInt(i.cpcv_day),
      BigInt(i.escritura_day),
      BigInt(i.salt),
    ])
  ).toString();
}

test("valid witness", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  assert.equal(await witnessOk(input), true);
});

test("commission rate out of range fails", async () => {
  // 11% with a consistent total, split, commitment and signature: only the rate range check is violated.
  const a = await buildAttestation({ ...DEAL, commissionRateBps: 1100 }, AGENT, KEYS);
  assert.equal(await witnessOk(a.input), false);
  const b = await buildAttestation({ ...DEAL, commissionRateBps: 50 }, AGENT, KEYS);
  assert.equal(await witnessOk(b.input), false);
});

test("wrong split fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  const bad = await resign({ ...input, agent_commission_cents: (BigInt(input.agent_commission_cents) + 1n).toString() });
  assert.equal(await witnessOk(bad), false);
});

test("wrong commission total fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  const total = BigInt(input.total_commission_cents) + 2n;
  const bad = await resign({ ...input, total_commission_cents: total.toString(), agent_commission_cents: (total / 2n).toString() });
  assert.equal(await witnessOk(bad), false);
});

test("wrong commitment fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  const bad = await resign({ ...input, commitment: (BigInt(input.commitment) + 1n).toString() });
  assert.equal(await witnessOk(bad), false);
});

test("wrong nullifier fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  const bad = await resign({ ...input, nullifier: (BigInt(input.nullifier) + 1n).toString() });
  assert.equal(await witnessOk(bad), false);
});

test("wrong nullifier secret commitment fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  assert.equal(await witnessOk({ ...input, nullifier_secret_commitment: "12345" }), false);
});

test("bad signature fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  assert.equal(await witnessOk({ ...input, sig_s: (BigInt(input.sig_s) + 1n).toString() }), false);
  // Signed by a different key.
  const other = await buildAttestation(DEAL, AGENT, { ...KEYS, attesterPrivHex: sha("someone else").toString("hex") });
  assert.equal(await witnessOk({ ...input, sig_r8x: other.input.sig_r8x, sig_r8y: other.input.sig_r8y, sig_s: other.input.sig_s }), false);
});

test("signature bound to the agent: another agent field fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  const otherAgent = await buildAttestation(DEAL, StrKey.encodeContract(sha("other")), KEYS);
  assert.equal(await witnessOk({ ...input, agent_field: otherAgent.input.agent_field }), false);
});

test("escritura before (or on) the CPCV date fails", async () => {
  const { input } = await buildAttestation(DEAL, AGENT, KEYS);
  for (const escr of [DEAL.cpcvDay, DEAL.cpcvDay - 10]) {
    const tampered: Input = { ...input, escritura_day: String(escr) };
    tampered.commitment = await commitmentOf(tampered);
    assert.equal(await witnessOk(await resign(tampered)), false);
  }
});
