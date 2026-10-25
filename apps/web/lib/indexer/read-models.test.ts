import { describe, expect, it } from "vitest";

import { downsample, toSnapshotPoint } from "@/lib/pool/stats";
import { convertToAssets } from "@/lib/pool/investor";
import { AGENT } from "@/lib/stellar/fixtures";

import { attributeDraws, type LineWindow } from "./attribution";
import { parseNoteId } from "./note-id";
import { writtenOffFromEvents, type StoredEvent } from "./queries";
import { countStatuses, matchesQuery, parseStoredProof } from "./registry";

const EUR = 10_000_000n;
const at = (ledger: number, eventIdx = 0) => ({ ledger, eventIdx });
const line = (noteId: number, escrituraDay: number, opened: number, closed: number | null, limitEur = 3_750n): LineWindow => ({
  noteId,
  escrituraDay,
  creditLimit: limitEur * EUR,
  opened: at(opened),
  closed: closed === null ? null : at(closed),
});

describe("attributeDraws (spec §5.4: earliest escritura first, up to each limit)", () => {
  it("fills the earliest-escritura line first and spills over to the next", () => {
    const lines = [line(1, 20_600, 1, null), line(2, 20_550, 2, null, 1_000n)];
    const [first, second] = attributeDraws(lines, [
      { at: at(5), fromCredit: 800n * EUR },
      { at: at(6), fromCredit: 700n * EUR },
    ]);
    expect(first).toEqual(new Map([[2, 800n * EUR]]));
    expect(second).toEqual(
      new Map([
        [2, 200n * EUR],
        [1, 500n * EUR],
      ]),
    );
  });

  it("only uses lines open at the draw and ignores balance-only draws", () => {
    const lines = [line(1, 20_500, 1, 10), line(2, 20_900, 11, null)];
    const res = attributeDraws(lines, [
      { at: at(5), fromCredit: 100n },
      { at: at(12), fromCredit: 200n },
      { at: at(13), fromCredit: 0n },
    ]);
    expect(res.map((m) => [...m.entries()])).toEqual([[[1, 100n]], [[2, 200n]], []]);
  });

  it("puts any excess over every cap on the last open line", () => {
    const res = attributeDraws([line(1, 1, 1, null, 1n)], [{ at: at(2), fromCredit: 3n * EUR }]);
    expect(res[0].get(1)).toBe(3n * EUR);
  });
});

describe("writtenOffFromEvents", () => {
  const e = (type: string, ledger: number, data: Record<string, unknown>): StoredEvent => ({ type, ledger, eventIdx: 0, contract: "C", txHash: `t${ledger}`, data, protocolTs: null });
  it("marks notes cancelled with debt before the agent's write-off", () => {
    const ids = writtenOffFromEvents([
      e("NoteCancelled", 1, { noteId: 4, agent: AGENT, debtCarried: "20000000000" }),
      e("NoteCancelled", 2, { noteId: 5, agent: AGENT, debtCarried: "0" }),
      e("DebtWrittenOff", 3, { agent: AGENT, amount: "20000000000" }),
      e("NoteCancelled", 4, { noteId: 6, agent: AGENT, debtCarried: "1" }),
    ]);
    expect([...ids]).toEqual([4]);
  });
});

describe("registry helpers", () => {
  it("matchesQuery: id, #id, full / partial / truncated address", () => {
    const note = { id: 12, agent: AGENT };
    expect(matchesQuery(note, "12")).toBe(true);
    expect(matchesQuery(note, "#12")).toBe(true);
    expect(matchesQuery(note, "1")).toBe(false);
    expect(matchesQuery(note, AGENT.toLowerCase())).toBe(true);
    expect(matchesQuery(note, AGENT.slice(10, 20))).toBe(true);
    expect(matchesQuery(note, `${AGENT.slice(0, 4)}…${AGENT.slice(-4)}`)).toBe(true);
    expect(matchesQuery(note, `${AGENT.slice(0, 4)}...${AGENT.slice(-4)}`)).toBe(true);
    expect(matchesQuery(note, "CXXX…YYYY")).toBe(false);
  });

  it("countStatuses", () => {
    expect(countStatuses(["Active", "Active", "WrittenOff"])).toEqual({ Active: 2, Settled: 0, Cancelled: 0, WrittenOff: 1, total: 3 });
  });

  it("parseStoredProof accepts Cpcv.proof JSON and rejects anything else", () => {
    const proof = { pi_a: ["1", "2", "1"], pi_b: [["3", "4"], ["5", "6"], ["1", "0"]], pi_c: ["7", "8", "1"], protocol: "groth16", curve: "bn128" };
    const signals = Array.from({ length: 9 }, (_, i) => String(i));
    expect(parseStoredProof({ proof, publicSignals: signals })).toEqual({ proof, publicSignals: signals });
    expect(parseStoredProof({ proof, publicSignals: signals.slice(1) })).toBeNull();
    expect(parseStoredProof(null)).toBeNull();
  });

  it("parseNoteId", () => {
    expect(parseNoteId("0")).toBe(0);
    expect(() => parseNoteId("-1")).toThrow();
    expect(() => parseNoteId("4294967296")).toThrow();
  });
});

describe("pool helpers", () => {
  it("downsample keeps the ends and the count", () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => i);
    const out = downsample(rows, 500);
    expect(out).toHaveLength(500);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(1_000);
    expect(downsample([1, 2], 500)).toEqual([1, 2]);
  });

  it("toSnapshotPoint and convertToAssets (§5.5 vault math, rounding down)", () => {
    expect(toSnapshotPoint({ protocolTs: 5n, seniorAssets: 7n, juniorAssets: 3n, totalDebt: 4n, sharePrice: "1500000000000000000" })).toEqual({
      t: 5,
      sharePrice: 1.5,
      tvl: "10",
      debt: "4",
      seniorAssets: "7",
      juniorAssets: "3",
    });
    expect(convertToAssets(100n, { seniorAssets: 1_049n, shareSupply: 999n })).toBe(105n);
    expect(convertToAssets(0n, { seniorAssets: 0n, shareSupply: 0n })).toBe(0n);
  });
});
