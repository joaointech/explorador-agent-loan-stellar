import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { decodeAgentPosition, decodeDrawResult, decodeLineView, decodeNote, decodeNotes, decodePoolStats, decodeU32Vec } from "./decode";
import { DecodeError } from "./errors";
import {
  AGENT,
  agentPositionScVal,
  drawResultScVal,
  lineViewScVal,
  noteScVal,
  poolStatsScVal,
} from "./fixtures";
import { asEnum, scStruct, scU32, scU64, scValToJson, snakeToCamel } from "./scval";

/** Round-trips through XDR bytes, like a value returned by RPC. */
const wire = (v: xdr.ScVal): xdr.ScVal => xdr.ScVal.fromXDR(v.toXDR());

describe("decodeNote", () => {
  it("decodes every field of the Rust Note struct", () => {
    const note = decodeNote(wire(noteScVal()));
    expect(note).toEqual({
      id: 1,
      agent: AGENT,
      totalCommission: 150_000_000_000n,
      agentCommission: 75_000_000_000n,
      exploradorCommission: 75_000_000_000n,
      escrituraDay: 20_500,
      commitment: "11".repeat(32),
      nullifier: "22".repeat(32),
      proof: { a: "aa".repeat(64), b: "bb".repeat(128), c: "cc".repeat(64) },
      mintedAt: 1_792_000_000n,
      status: "Active",
    });
  });

  it("decodes each NoteStatus variant", () => {
    for (const status of ["Active", "Settled", "Cancelled"] as const) {
      expect(decodeNote(wire(noteScVal({ status }))).status).toBe(status);
    }
  });

  it("decodes a Vec<Note>", () => {
    const notes = decodeNotes(wire(xdr.ScVal.scvVec([noteScVal({ id: 1 }), noteScVal({ id: 2, status: "Settled" })])));
    expect(notes.map((n) => [n.id, n.status])).toEqual([
      [1, "Active"],
      [2, "Settled"],
    ]);
  });

  it("names the missing field", () => {
    const broken = scStruct({ id: scU32(1) });
    expect(() => decodeNote(broken)).toThrow(DecodeError);
    expect(() => decodeNote(broken)).toThrow(/Note: missing field "agent"/);
  });

  it("rejects a BytesN of the wrong length", () => {
    const v = noteScVal();
    const entries = (v as xdr.ScVal & { map: xdr.ScMapEntry[] }).map.map((e) =>
      String(e.key.value) === "commitment" ? new xdr.ScMapEntry({ key: e.key, val: xdr.ScVal.scvBytes(new Uint8Array(31)) }) : e,
    );
    expect(() => decodeNote(xdr.ScVal.scvMap(entries))).toThrow(/commitment: expected 32 bytes, got 31/);
  });
});

describe("decodePoolStats", () => {
  it("decodes PoolStats with nested Params", () => {
    const stats = decodePoolStats(wire(poolStatsScVal()));
    expect(stats.seniorAssets).toBe(1_000_000_000_000n);
    expect(stats.juniorAssets).toBe(100_000_000_000n);
    expect(stats.totalDebt).toBe(600_000_000_000n);
    expect(stats.sharePriceScaled).toBe(1_052_631_578_947_368_421n);
    expect(stats.utilizationBps).toBe(5_454);
    expect(stats.leverageX100).toBe(600);
    expect(stats.protocolNow).toBe(1_792_000_000n);
    expect(stats.writtenOffTotal).toBe(0n);
    expect(stats.params).toEqual({
      agentAprBps: 1200,
      protocolFeeBps: 1000,
      seniorTargetBps: 800,
      ltvBps: 5000,
      gracePeriodSecs: 15_552_000n,
      maxLeverage: 10,
      demoMode: true,
    });
  });
});

describe("decodeAgentPosition", () => {
  it("decodes lines and a None grace deadline", () => {
    const pos = decodeAgentPosition(wire(agentPositionScVal()));
    expect(pos.cardEnabled).toBe(true);
    expect(pos.graceDeadline).toBeNull();
    expect(pos.lines).toHaveLength(1);
    expect(pos.lines[0].line).toMatchObject({ noteId: 1, agent: AGENT, creditLimit: 37_500_000_000n, status: "Active" });
    expect(pos.lines[0].debt).toBe(30_887_700_000n);
    expect(pos.borrowableNow).toBe(6_612_300_000n);
  });

  it("decodes Some(grace_deadline)", () => {
    const pos = decodeAgentPosition(wire(agentPositionScVal({ graceDeadline: 1_807_552_000n, lines: [] })));
    expect(pos.graceDeadline).toBe(1_807_552_000n);
    expect(pos.lines).toEqual([]);
  });
});

describe("other return types", () => {
  it("decodes LineView, DrawResult and Vec<u32>", () => {
    expect(decodeLineView(wire(lineViewScVal({ noteId: 4 }))).line.noteId).toBe(4);
    expect(decodeDrawResult(wire(drawResultScVal(48_000_000n, 0n)))).toEqual({ fromBalance: 48_000_000n, fromCredit: 0n });
    expect(decodeU32Vec(wire(xdr.ScVal.scvVec([scU32(1), scU32(5)])))).toEqual([1, 5]);
  });

  it("accepts integer width differences (u64 where u32 is expected)", () => {
    expect(decodeU32Vec(xdr.ScVal.scvVec([scU64(7n)]))).toEqual([7]);
  });
});

describe("asEnum", () => {
  const variants = ["Active", "Settled", "Cancelled"] as const;
  it("accepts Vec[Symbol], a bare Symbol and a u32 discriminant", () => {
    expect(asEnum(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Settled")]), variants, "s")).toBe("Settled");
    expect(asEnum(xdr.ScVal.scvSymbol("Cancelled"), variants, "s")).toBe("Cancelled");
    expect(asEnum(scU32(0), variants, "s")).toBe("Active");
  });
  it("rejects unknown variants", () => {
    expect(() => asEnum(xdr.ScVal.scvSymbol("Paused"), variants, "status")).toThrow(/status: expected one of/);
  });
});

describe("scValToJson", () => {
  it("is JSON-safe: big integers as strings, u32 as numbers, bytes as hex, camelCase keys", () => {
    const json = scValToJson(wire(drawResultScVal(1n, 2n)));
    expect(json).toEqual({ fromBalance: "1", fromCredit: "2" });
    expect(scValToJson(noteScVal())).toMatchObject({ id: 1, totalCommission: "150000000000", status: "Active", commitment: "11".repeat(32) });
    expect(snakeToCamel("leverage_x100")).toBe("leverageX100");
  });
});
