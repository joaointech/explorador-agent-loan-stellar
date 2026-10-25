import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT, POOL_ID } from "@/lib/stellar/fixtures";

import { decodeEvent, type DecodedEvent } from "./events";
import { ev } from "./fixtures";

const cpcvUpdateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
const agentUpdateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
const chainEventFindMany = vi.fn(async (_args: unknown): Promise<{ data: unknown }[]> => []);
const authFindMany = vi.fn(async (_args: unknown): Promise<{ id: string; lithicToken: string }[]> => []);
const authUpdate = vi.fn(async (_args: unknown) => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    cpcv: { updateMany: (a: unknown) => cpcvUpdateMany(a) },
    agent: { updateMany: (a: unknown) => agentUpdateMany(a) },
    chainEvent: { findMany: (a: unknown) => chainEventFindMany(a) },
    cardAuthorization: { findMany: (a: unknown) => authFindMany(a), update: (a: unknown) => authUpdate(a) },
  },
}));

const { authRefHex, reconcile } = await import("./reconcile");

const d = (raw: ReturnType<typeof ev.juniorDeposit>): DecodedEvent => decodeEvent(raw)!;

beforeEach(() => vi.clearAllMocks());

describe("reconcile", () => {
  it("NoteMinted links the CPCV by commitment, marks it MINTED and records the mint tx", async () => {
    const e = d(ev.noteMinted(7, AGENT, 1_500_000n, 20_500, 0x11));
    await reconcile([e]);
    const byCommitment = { OR: [{ commitment: { equals: "11".repeat(32), mode: "insensitive" } }, { commitment: { equals: `0x${"11".repeat(32)}`, mode: "insensitive" } }] };
    expect(cpcvUpdateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { ...byCommitment, noteId: null }, data: { noteId: 7 } },
      { where: { ...byCommitment, noteId: 7, status: { in: ["DRAFT", "PROVING", "FAILED"] } }, data: { status: "MINTED", error: null } },
      { where: { ...byCommitment, noteId: 7, mintTxHash: null }, data: { mintTxHash: e.txHash } },
    ]);
  });

  it("NoteSettled / NoteCancelled move open rows forward, scoped to the note's agent", async () => {
    const settled = d(ev.noteSettled(3, AGENT, { total: 1n, debtRepaid: 0n, interestPaid: 0n, agentPayout: 0n, juniorDeposit: 1n }));
    const cancelled = d(ev.noteCancelled(4, AGENT, 5n, 1_800_000_000n));
    await reconcile([settled, cancelled]);
    const open = { in: ["DRAFT", "PROVING", "FAILED", "MINTED"] };
    expect(cpcvUpdateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { noteId: 3, agent: { smartAccount: AGENT }, status: open }, data: { status: "SETTLED" } },
      { where: { noteId: 3, agent: { smartAccount: AGENT }, settleTxHash: null }, data: { settleTxHash: settled.txHash } },
      { where: { noteId: 4, agent: { smartAccount: AGENT }, status: open }, data: { status: "CANCELLED" } },
      { where: { noteId: 4, agent: { smartAccount: AGENT }, cancelTxHash: null }, data: { cancelTxHash: cancelled.txHash } },
    ]);
  });

  it("DebtWrittenOff marks the agent's cancelled CPCVs WRITTEN_OFF, except notes cancelled without debt", async () => {
    chainEventFindMany.mockResolvedValue([{ data: { noteId: 4, debtCarried: "20000000000" } }, { data: { noteId: 6, debtCarried: "0" } }]);
    await reconcile([d(ev.debtWrittenOff(AGENT, 20_000_000_000n, 20_000_000_000n, 0n))]);
    expect(chainEventFindMany.mock.calls[0][0]).toMatchObject({ where: { type: "NoteCancelled", contract: POOL_ID, data: { path: ["agent"], equals: AGENT } } });
    expect(cpcvUpdateMany).toHaveBeenCalledWith({
      where: { status: "CANCELLED", agent: { smartAccount: AGENT }, NOT: { noteId: { in: [6] } } },
      data: { status: "WRITTEN_OFF" },
    });
  });

  it("NoteStatusChanged mirrors the note contract's status", async () => {
    await reconcile([d(ev.noteStatusChanged(2, "Cancelled"))]);
    expect(cpcvUpdateMany).toHaveBeenCalledWith({ where: { noteId: 2, status: { in: ["DRAFT", "PROVING", "FAILED", "MINTED"] } }, data: { status: "CANCELLED" } });
  });

  it("CardEnabled updates the agent flag in chain order", async () => {
    await reconcile([d(ev.cardEnabled(AGENT, true)), d(ev.cardEnabled(AGENT, false))]);
    expect(agentUpdateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { smartAccount: AGENT, cardEnabledOnChain: false }, data: { cardEnabledOnChain: true } },
      { where: { smartAccount: AGENT, cardEnabledOnChain: true }, data: { cardEnabledOnChain: false } },
    ]);
  });

  it("CardDraw confirms the matching authorization (auth_ref = sha256(Lithic token))", async () => {
    const token = "lithic-tx-1234";
    const authRef = createHash("sha256").update(token).digest();
    authFindMany.mockResolvedValue([
      { id: "other", lithicToken: "lithic-tx-9999" },
      { id: "auth1", lithicToken: token },
    ]);
    const e = d(ev.cardDraw(AGENT, 3_490_000_000n, 1_000_000_000n, 2_490_000_000n, authRef));
    await reconcile([e]);
    expect(authRefHex(token)).toBe(authRef.toString("hex"));
    expect(authUpdate).toHaveBeenCalledWith({
      where: { id: "auth1" },
      data: { chainStatus: "CONFIRMED", fromBalanceStroops: 1_000_000_000n, fromCreditStroops: 2_490_000_000n, txHash: e.txHash },
    });
  });

  it("keeps going when one event fails", async () => {
    cpcvUpdateMany.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await reconcile([d(ev.noteStatusChanged(1, "Settled")), d(ev.cardEnabled(AGENT, true))]);
    expect(agentUpdateMany).toHaveBeenCalledTimes(1);
  });
});
