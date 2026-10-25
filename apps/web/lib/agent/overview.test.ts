// Pure parts of the agent overview: event parsing, deal and activity assembly.

import { describe, expect, it } from "vitest";

import { jsonify } from "@/lib/json";
import type { AgentPosition, LineView } from "@/lib/types/chain";

import { assembleActivity, assembleDeals, parseAgentEvent, parseCachedAgentPosition, type AgentEvent, type AuthorizationSource, type ChainEventRow, type DealSource } from "./overview";

const EUR = 10_000_000n;
const SA = "CAGENTSMARTACCOUNTTESTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PROTOCOL_DAY = 20_833;

function lineView(noteId: number, escrituraDay: number, creditLimit: bigint, principal: bigint, debt: bigint): LineView {
  return {
    line: { noteId, agent: SA, creditLimit, principal, scaledDebt: debt, escrituraDay, status: "Active" },
    debt,
    interest: debt - principal,
    available: creditLimit - debt,
  };
}

function position(lines: LineView[], over: Partial<AgentPosition> = {}): AgentPosition {
  const totalDebt = lines.reduce((s, l) => s + l.debt, 0n);
  return {
    cardBalance: 0n,
    cardEnabled: true,
    blocked: false,
    lines,
    carriedDebt: 0n,
    graceDeadline: null,
    totalDebt,
    totalPrincipal: lines.reduce((s, l) => s + l.line.principal, 0n),
    availableCredit: lines.reduce((s, l) => s + l.available, 0n),
    borrowableNow: lines.reduce((s, l) => s + l.available, 0n),
    ...over,
  };
}

const row = (over: Partial<ChainEventRow> & Pick<ChainEventRow, "type" | "data">): ChainEventRow => ({
  ledger: 100,
  txHash: "tx-a",
  eventIdx: 0,
  createdAt: new Date("2026-10-25T10:00:00Z"),
  ...over,
});

const cpcv = (over: Partial<DealSource> & Pick<DealSource, "id" | "noteId">): DealSource => ({
  status: "MINTED",
  agentCommissionCents: 750_000n,
  escrituraDay: PROTOCOL_DAY + 45,
  mintTxHash: `mint-${over.id}`,
  ...over,
});

describe("parseAgentEvent", () => {
  it("reads indexer rows (PascalCase, camelCase fields, ledger close time)", () => {
    const e = parseAgentEvent(
      row({
        type: "NoteSettled",
        data: { noteId: 12, agent: SA, agentPayout: "44112328767", debtRepaid: "30887671233", ledgerClosedAt: "2026-10-25T09:30:00.000Z" },
      }),
    );
    expect(e).toMatchObject({ kind: "settled", noteId: 12, agentPayout: 44_112_328_767n, debtRepaid: 30_887_671_233n, at: "2026-10-25T09:30:00.000Z", id: "tx-a:0" });
  });

  it("reads raw contract names (snake_case) and falls back to the indexing time", () => {
    const e = parseAgentEvent(row({ type: "note_cancelled", data: { note_id: "14", agent: SA, debt_carried: 20_000_000_000, grace_deadline: "1815552000" } }));
    expect(e).toMatchObject({ kind: "cancelled", noteId: 14, debtCarried: 20_000_000_000n, graceDeadline: 1_815_552_000, at: "2026-10-25T10:00:00.000Z" });
    // Option<u64> = None is omitted from the event map
    expect(parseAgentEvent(row({ type: "NoteCancelled", data: { noteId: 15, agent: SA, debtCarried: "0" } }))).toMatchObject({ graceDeadline: null });
  });

  it("parses withdrawals, write-offs and card toggles; ignores other or malformed events", () => {
    expect(parseAgentEvent(row({ type: "BalanceWithdrawn", data: { agent: SA, amount: "5000000000", to: SA } }))).toMatchObject({ kind: "withdrawn", amount: 5_000_000_000n, to: SA });
    expect(parseAgentEvent(row({ type: "debt_written_off", data: { agent: SA, amount: "1" } }))).toMatchObject({ kind: "written_off", amount: 1n });
    expect(parseAgentEvent(row({ type: "CardEnabled", data: { agent: SA, enabled: false } }))).toMatchObject({ kind: "card_enabled", enabled: false });
    expect(parseAgentEvent(row({ type: "CardDraw", data: { agent: SA, amount: "1" } }))).toBeNull();
    expect(parseAgentEvent(row({ type: "NoteSettled", data: { agent: SA } }))).toBeNull();
    expect(parseAgentEvent(row({ type: "BalanceWithdrawn", data: null }))).toBeNull();
  });
});

describe("assembleDeals", () => {
  const live = jsonify(
    position([
      lineView(12, PROTOCOL_DAY + 45, 3_750n * EUR, 2_600n * EUR, 2_625_180_000_00n),
      lineView(7, PROTOCOL_DAY - 3, 1_000n * EUR, 500n * EUR, 512n * EUR),
      lineView(15, PROTOCOL_DAY + 80, 2_000n * EUR, 0n, 0n),
    ]),
  );
  const events: AgentEvent[] = [
    { kind: "settled", id: "s:0", ledger: 90, eventIdx: 0, txHash: "s", at: "2026-10-20T10:00:00.000Z", noteId: 9, agentPayout: 4_411_23n * 100_000n, debtRepaid: 3_088_77n * 100_000n },
    { kind: "cancelled", id: "c:0", ledger: 95, eventIdx: 1, txHash: "c", at: "2026-10-21T10:00:00.000Z", noteId: 14, debtCarried: 2_000n * EUR, graceDeadline: 1_815_552_000 },
  ];

  it("joins CPCV rows with live lines and events; active first by escritura date", () => {
    const deals = assembleDeals({
      cpcvs: [
        cpcv({ id: "c12", noteId: 12 }),
        cpcv({ id: "c9", noteId: 9, status: "SETTLED", escrituraDay: PROTOCOL_DAY - 10 }),
        cpcv({ id: "c14", noteId: 14 }), // still MINTED in Postgres; the indexed event says cancelled
        cpcv({ id: "c7", noteId: 7, agentCommissionCents: 200_000n, escrituraDay: PROTOCOL_DAY - 3 }),
        cpcv({ id: "draft", noteId: null, status: "PROVING" }),
      ],
      position: live,
      events,
      protocolDay: PROTOCOL_DAY,
    });

    expect(deals.map((d) => d.noteId)).toEqual([7, 12, 15, 14, 9]);
    const [d7, d12, d15, d14, d9] = deals;
    expect(d7).toMatchObject({ status: "MINTED", overdue: true, used: String(512n * EUR), creditLimit: String(1_000n * EUR), agentCommission: String(2_000n * EUR) });
    expect(d12).toMatchObject({
      cpcvId: "c12",
      status: "MINTED",
      overdue: false,
      agentCommission: String(7_500n * EUR),
      creditLimit: String(3_750n * EUR),
      used: "262518000000",
      escrituraDay: PROTOCOL_DAY + 45,
      mintTxHash: "mint-c12",
      agentPayout: null,
      debtCarried: null,
    });
    // a line without a CPCV row (e.g. minted by a script) still shows, from chain data
    expect(d15).toMatchObject({ cpcvId: "note-15", status: "MINTED", creditLimit: String(2_000n * EUR), agentCommission: String(4_000n * EUR), used: "0", mintTxHash: null });
    expect(d14).toMatchObject({ status: "CANCELLED", used: "0", overdue: false, debtCarried: String(2_000n * EUR), creditLimit: String(3_750n * EUR) });
    expect(d9).toMatchObject({ status: "SETTLED", used: "0", overdue: false, agentPayout: "44112300000" });
  });

  it("is due, not overdue, on the escritura day itself; credit limit falls back to agent commission × LTV", () => {
    const [deal] = assembleDeals({ cpcvs: [cpcv({ id: "c1", noteId: 1, escrituraDay: PROTOCOL_DAY })], position: null, events: [], protocolDay: PROTOCOL_DAY });
    expect(deal).toMatchObject({ overdue: false, used: "0", creditLimit: String(3_750n * EUR) });
    const [late] = assembleDeals({ cpcvs: [cpcv({ id: "c1", noteId: 1, escrituraDay: PROTOCOL_DAY })], position: null, events: [], protocolDay: PROTOCOL_DAY + 1 });
    expect(late.overdue).toBe(true);
  });

  it("marks a cancelled deal written off when a write-off of the agent's carried debt follows", () => {
    const writeOff: AgentEvent = { kind: "written_off", id: "w:0", ledger: 120, eventIdx: 0, txHash: "w", at: "2026-10-24T10:00:00.000Z", amount: 2_100n * EUR };
    const earlier: AgentEvent = { ...writeOff, id: "w0:0", ledger: 10 };
    const deals = assembleDeals({ cpcvs: [cpcv({ id: "c14", noteId: 14, status: "CANCELLED" })], position: null, events: [writeOff, ...events], protocolDay: PROTOCOL_DAY });
    expect(deals[0].status).toBe("WRITTEN_OFF");
    // a write-off before the cancellation is about older debt
    const before = assembleDeals({ cpcvs: [cpcv({ id: "c14", noteId: 14, status: "CANCELLED" })], position: null, events: [earlier, ...events], protocolDay: PROTOCOL_DAY });
    expect(before[0].status).toBe("CANCELLED");
  });
});

describe("assembleActivity", () => {
  const auth = (over: Partial<AuthorizationSource> & Pick<AuthorizationSource, "id" | "createdAt">): AuthorizationSource => ({
    merchant: "Pastelaria Aloma",
    amountCents: 480n,
    decision: "APPROVED",
    declineReason: null,
    fromBalanceStroops: 0n,
    fromCreditStroops: 48_000_000n,
    chainStatus: "CONFIRMED",
    txHash: "draw-1",
    ...over,
  });

  it("merges card rows and chain events newest first", () => {
    const items = assembleActivity({
      authorizations: [
        auth({ id: "a1", createdAt: new Date("2026-10-25T11:00:00Z") }),
        auth({ id: "a2", createdAt: new Date("2026-10-23T09:00:00Z"), merchant: "Worten", amountCents: 349_00n, decision: "DECLINED", declineReason: "INSUFFICIENT_FUNDS", fromBalanceStroops: null, fromCreditStroops: null, chainStatus: "PENDING", txHash: null }),
      ],
      events: [
        { kind: "settled", id: "s:0", ledger: 90, eventIdx: 0, txHash: "s", at: "2026-10-24T10:00:00.000Z", noteId: 9, agentPayout: 44_112_300_000n, debtRepaid: 30_887_700_000n },
        { kind: "withdrawn", id: "w:0", ledger: 99, eventIdx: 0, txHash: "w", at: "2026-10-25T12:00:00.000Z", amount: 500n * EUR, to: SA },
        { kind: "cancelled", id: "c:0", ledger: 80, eventIdx: 0, txHash: "c", at: "2026-10-22T10:00:00.000Z", noteId: 14, debtCarried: 2_000n * EUR, graceDeadline: null },
        { kind: "card_enabled", id: "e:0", ledger: 70, eventIdx: 0, txHash: "e", at: "2026-10-21T10:00:00.000Z", enabled: true },
      ],
    });

    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["withdrawal:w:0", "card:a1", "settlement:s:0", "card:a2", "cancellation:c:0"]);
    expect(items[1]).toEqual({
      kind: "card",
      id: "a1",
      at: "2026-10-25T11:00:00.000Z",
      merchant: "Pastelaria Aloma",
      amount: "48000000",
      decision: "APPROVED",
      declineReason: null,
      fromBalance: "0",
      fromCredit: "48000000",
      chainStatus: "CONFIRMED",
      txHash: "draw-1",
    });
    expect(items[2]).toEqual({ kind: "settlement", id: "s:0", at: "2026-10-24T10:00:00.000Z", noteId: 9, agentPayout: "44112300000", debtRepaid: "30887700000", txHash: "s" });
    expect(items[3]).toMatchObject({ decision: "DECLINED", declineReason: "INSUFFICIENT_FUNDS", fromBalance: null, txHash: null, amount: "3490000000" });
    expect(items[4]).toEqual({ kind: "cancellation", id: "c:0", at: "2026-10-22T10:00:00.000Z", noteId: 14, debtCarried: "20000000000", graceDeadline: null, txHash: "c" });
  });

  it("keeps the newest items only", () => {
    const authorizations = Array.from({ length: 8 }, (_, i) => auth({ id: `a${i}`, createdAt: new Date(Date.UTC(2026, 9, 1 + i)) }));
    expect(assembleActivity({ authorizations, events: [], limit: 3 }).map((i) => i.id)).toEqual(["a7", "a6", "a5"]);
  });
});

describe("parseCachedAgentPosition", () => {
  it("round-trips a jsonified AgentPosition and rejects garbage", () => {
    const cached = jsonify(position([lineView(12, PROTOCOL_DAY + 45, 3_750n * EUR, 3_000n * EUR, 3_000n * EUR)], { graceDeadline: 1_815_552_000n, carriedDebt: 5n }));
    expect(parseCachedAgentPosition(cached)).toEqual(cached);
    expect(parseCachedAgentPosition(null)).toBeNull();
    expect(parseCachedAgentPosition({ cardBalance: "x" })).toBeNull();
    // older cache shapes without the optional parts still parse
    const minimal = { cardBalance: "1", cardEnabled: true, totalDebt: "0", totalPrincipal: "0", availableCredit: "0", borrowableNow: "0" };
    expect(parseCachedAgentPosition(minimal)).toMatchObject({ blocked: false, lines: [], carriedDebt: "0", graceDeadline: null });
  });
});
