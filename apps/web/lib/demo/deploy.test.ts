import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeParams } from "@/lib/stellar/decode";
import { asStruct, asVec, field } from "@/lib/stellar/scval";

import type { DeployResult } from "./deploy";

const calls: string[] = [];
const resolved = vi.hoisted(() => ({ value: null as null | { wasmHashes: Record<string, unknown> } }));

vi.mock("@/lib/db", () => {
  const op = (name: string) =>
    vi.fn((args: unknown) => {
      calls.push(`${name} ${JSON.stringify(args)}`);
      return Promise.resolve({ count: 1 });
    });
  return {
    Prisma: { DbNull: "DbNull" },
    db: {
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      deployment: { updateMany: op("deployment.updateMany"), create: op("deployment.create") },
      cpcv: { updateMany: op("cpcv.updateMany") },
      agent: { updateMany: op("agent.updateMany") },
    },
  };
});
vi.mock("@/lib/stellar/deployment", () => ({
  invalidateDeploymentCache: vi.fn(() => calls.push("invalidateDeploymentCache")),
  resolveDeployment: vi.fn(async () => resolved.value),
}));

const { noteBaseUri, poolParamsScVal, recordDeployment, storedWasmHashes, verificationKeyScVal, wasmHash } = await import("./deploy");

const HASHES = { teurc: "a".repeat(64), cpcvNote: "b".repeat(64), advancePool: "c".repeat(64) };
const RESULT: DeployResult = {
  network: "testnet",
  teurc: "CD6Z55NBIYGIND4PVHDKH2F6WL3NQ6XKLKUFPBTQIUSUAKQGFKMJWBFX",
  cpcvNote: "CCJD426FWUWN7SCVOMK2PSYKQSP2DYJLPDGNAQ2NIWSRAY4KNERYCUP7",
  advancePool: "CCKM4622V3AE7ATBO6RXFDL3GOAZSDVO4ZTXIMSKNFHM4O6UMKF5Z3UN",
  wasmHashes: HASHES,
  txs: { "deploy teurc": "d".repeat(64) },
  admin: "GADMCAK3SSHGRAL7JS3XUQID7UZLAY4A57UR4W5VOY7TKTNARVHB3RWW",
  operator: "GDLVQ5V5OZ4TGYHJGESUR5X4YAPBILXJSMALA56MILPJYBGS7XRBKQYT",
  treasury: "GBDCCBA6CRR5VYZ7YLCSIZKMOOPOJ5MWT36RG23A5HMX5LJIUH5YLI5K",
  cardSettlement: "GAHT6VRCGSMA7DVPINHXD7K4KYKVYI246ZKPRIL4B6LVKTNGLYGSO2ZP",
  baseUri: "http://localhost:3112/api/notes",
  demoMode: true,
  deployedAt: "2026-10-25T00:00:00.000Z",
  feesStroops: "0",
};

beforeEach(() => {
  calls.length = 0;
  resolved.value = null;
});

describe("deploy helpers", () => {
  it("token_uri base: APP_URL + /api/notes, without a double slash", () => {
    expect(noteBaseUri("http://localhost:3112/")).toBe("http://localhost:3112/api/notes");
    expect(noteBaseUri("https://advance.explorador.ai")).toBe("https://advance.explorador.ai/api/notes");
  });

  it("encodes the spec §5.1 pool params", () => {
    expect(decodeParams(poolParamsScVal(true))).toEqual({
      agentAprBps: 1200,
      protocolFeeBps: 1000,
      seniorTargetBps: 800,
      ltvBps: 5000,
      gracePeriodSecs: 15_552_000n,
      maxLeverage: 10,
      demoMode: true,
    });
    expect(decodeParams(poolParamsScVal(false)).demoMode).toBe(false);
  });

  it("builds the cpcv_note VerificationKey from verification_key.soroban.json", () => {
    const vk = asStruct(verificationKeyScVal(), "vk");
    expect(asVec(field(vk, "ic", "vk"), "ic")).toHaveLength(10);
    for (const name of ["alpha", "beta", "gamma", "delta"]) expect(field(vk, name, "vk").type).toBe("scvBytes");
  });

  it("wasm hash = sha256 of the file", () => {
    expect(wasmHash(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("storedWasmHashes", () => {
  it("reads the active deployment's hashes (DeploymentInfo or crate keys)", async () => {
    resolved.value = { wasmHashes: HASHES };
    await expect(storedWasmHashes()).resolves.toEqual(HASHES);
    resolved.value = { wasmHashes: { teurc: HASHES.teurc, cpcv_note: HASHES.cpcvNote, advance_pool: HASHES.advancePool } };
    await expect(storedWasmHashes()).resolves.toEqual(HASHES);
  });

  it("refuses without a previous upload", async () => {
    await expect(storedWasmHashes()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    resolved.value = { wasmHashes: { teurc: "nope" } };
    await expect(storedWasmHashes()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("recordDeployment", () => {
  it("activates the new deployment, detaches old CPCV note ids, resets card consent and writes the file", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "deploy-test-")), "testnet.json");
    await recordDeployment(RESULT, { file });
    expect(calls[0]).toBe(`deployment.updateMany ${JSON.stringify({ where: { network: "testnet", active: true }, data: { active: false } })}`);
    expect(calls[1]).toContain('"active":true');
    expect(calls[1]).toContain(RESULT.advancePool);
    expect(calls[2]).toBe(`cpcv.updateMany ${JSON.stringify({ where: { noteId: { not: null } }, data: { noteId: null } })}`);
    expect(calls[3]).toContain('"cardEnabledOnChain":false');
    expect(calls[4]).toBe("invalidateDeploymentCache");
    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written).toMatchObject({ network: "testnet", teurc: RESULT.teurc, cpcvNote: RESULT.cpcvNote, advancePool: RESULT.advancePool, wasmHashes: HASHES, baseUri: RESULT.baseUri });
  });
});
