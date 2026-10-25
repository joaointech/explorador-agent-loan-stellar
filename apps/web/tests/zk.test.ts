// agent_field parity, property_hash determinism and proof-format round trip (§12.1).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as snarkjs from "snarkjs";
import { agentField, formatProof, propertyHash, toHex32, unformatProof, type SnarkjsProof } from "@advance/zk";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const fixture = JSON.parse(readFileSync(path.join(root, "circuits", "test", "fixture.json"), "utf8"));
const vk = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "zk", "verification_key.json"), "utf8"));
const hasDeployment = existsSync(path.join(root, "deployments", "testnet.json"));

describe("agent_field", () => {
  it("matches the value the contract computed in the Rust fixture", () => {
    expect(toHex32(agentField(fixture.agent))).toBe(fixture.agentField);
  });

  it("starts with a zero byte and is below the field modulus", () => {
    const hex = toHex32(agentField(fixture.other));
    expect(hex.slice(0, 2)).toBe("00");
  });

  it.runIf(hasDeployment)("matches cpcv_note.agent_field on testnet", async () => {
    const { readContract } = await import("@/lib/stellar/client");
    for (const addr of [fixture.agent, fixture.other]) {
      const onChain = await readContract<Buffer>("cpcvNote", "agent_field", { addr });
      expect(Buffer.from(onChain).toString("hex")).toBe(toHex32(agentField(addr)));
    }
  });
});

describe("property_hash", () => {
  it("is deterministic and normalizes case and whitespace", async () => {
    const a = await propertyHash("Rua Augusta 100, 3.º Esq, 1100-053 Lisboa");
    const b = await propertyHash("  rua   AUGUSTA 100,  3.º esq, 1100-053   lisboa ");
    expect(a).toBe(b);
    expect(await propertyHash("Rua Augusta 100, 3.º Esq, 1100-053 Lisboa")).toBe(a);
  });

  it("differs for different addresses", async () => {
    const a = await propertyHash("Rua Augusta 100, 3.º Esq, 1100-053 Lisboa");
    const b = await propertyHash("Rua Augusta 101, 3.º Esq, 1100-053 Lisboa");
    expect(a).not.toBe(b);
  });

  it("handles long addresses (up to 8 × 31 bytes) and rejects longer ones", async () => {
    const long = "x".repeat(8 * 31);
    await expect(propertyHash(long)).resolves.toBeTypeOf("bigint");
    await expect(propertyHash(long + "y")).rejects.toThrow();
  });
});

describe("proof formatting", () => {
  const deal = fixture.deal1;

  it("formats a snarkjs proof into the committed Soroban bytes (A negated, G2 swapped)", () => {
    expect(formatProof(deal.snarkjs)).toEqual(deal.soroban);
  });

  it("round-trips: un-negating A gives back the snarkjs proof", () => {
    const back = unformatProof(deal.soroban);
    expect(back.pi_a.slice(0, 2)).toEqual(deal.snarkjs.pi_a.slice(0, 2));
    expect(back.pi_b.slice(0, 2)).toEqual(deal.snarkjs.pi_b.slice(0, 2));
    expect(back.pi_c.slice(0, 2)).toEqual(deal.snarkjs.pi_c.slice(0, 2));
  });

  it("the round-tripped proof verifies with snarkjs, a tampered one does not", async () => {
    const proof = unformatProof(deal.soroban) as SnarkjsProof;
    expect(await snarkjs.groth16.verify(vk, deal.publicSignals, proof)).toBe(true);
    const tamperedSignals = [...deal.publicSignals];
    tamperedSignals[1] = (BigInt(tamperedSignals[1]) + 1n).toString();
    expect(await snarkjs.groth16.verify(vk, tamperedSignals, proof)).toBe(false);
    // Forgetting to un-negate A must fail.
    const notNegated = { ...proof, pi_a: [proof.pi_a[0], deal.soroban.a.slice(64), "1"] };
    notNegated.pi_a[1] = BigInt("0x" + deal.soroban.a.slice(64)).toString();
    expect(await snarkjs.groth16.verify(vk, deal.publicSignals, notNegated)).toBe(false);
  });
});
