import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { AGENT, INVESTOR, NOTE_ID, POOL_ID, TEURC_ID } from "@/lib/stellar/fixtures";
import { scAddress, scI128, scStruct, scU32 } from "@/lib/stellar/scval";

import { compareEvents, decodeEvent, decodePayload, ledgerOfCursor, parseCloseTime, pascalCase } from "./events";
import { BASE_CLOSE, BASE_LEDGER, ev, rawEvent } from "./fixtures";

const decode = (raw: ReturnType<typeof rawEvent>) => {
  const d = decodeEvent(raw);
  if (!d) throw new Error("not decoded");
  return d;
};

describe("decodeEvent: explorador advance contract events", () => {
  it("NoteMinted (cpcv_note)", () => {
    const d = decode(ev.noteMinted(1, AGENT, 1_500_000n, 20_500));
    expect(d).toMatchObject({ type: "NoteMinted", contract: NOTE_ID, known: true, ledger: BASE_LEDGER, closedAt: BASE_CLOSE, eventIdx: 0 });
    expect(d.data).toEqual({
      id: 1,
      agent: AGENT,
      totalCommission: "150000000000",
      agentCommission: "75000000000",
      escrituraDay: 20_500,
      commitment: "11".repeat(32),
      nullifier: "22".repeat(32),
    });
  });

  it("NoteStatusChanged decodes the enum variant as a string", () => {
    expect(decode(ev.noteStatusChanged(3, "Settled")).data).toEqual({ id: 3, status: "Settled" });
  });

  it("CardEnabled / CardDraw / LineOpened", () => {
    expect(decode(ev.cardEnabled(AGENT, true))).toMatchObject({ type: "CardEnabled", data: { agent: AGENT, enabled: true } });
    expect(decode(ev.cardDraw(AGENT, 3_490_000_000n, 0n, 3_490_000_000n, new Uint8Array(32).fill(0xab))).data).toEqual({
      agent: AGENT,
      amount: "3490000000",
      fromBalance: "0",
      fromCredit: "3490000000",
      authRef: "ab".repeat(32),
    });
    expect(decode(ev.lineOpened(1, AGENT, 37_500_000_000n)).data).toEqual({ noteId: 1, agent: AGENT, creditLimit: "37500000000" });
  });

  it("NoteSettled with the §5.6 worked example", () => {
    const d = decode(
      ev.noteSettled(1, AGENT, {
        total: 150_000_000_000n,
        debtRepaid: 30_887_700_000n,
        interestPaid: 887_700_000n,
        agentPayout: 44_112_300_000n,
        juniorDeposit: 75_000_000_000n,
      }),
    );
    expect(d.type).toBe("NoteSettled");
    expect(d.data).toEqual({
      noteId: 1,
      agent: AGENT,
      totalCommission: "150000000000",
      debtRepaid: "30887700000",
      interestPaid: "887700000",
      carriedRepaid: "0",
      agentPayout: "44112300000",
      juniorDeposit: "75000000000",
    });
  });

  it("NoteCancelled: Some(grace_deadline) and the sparse-map None", () => {
    expect(decode(ev.noteCancelled(4, AGENT, 20_000_000_000n, 1_807_552_000n)).data).toEqual({
      noteId: 4,
      agent: AGENT,
      debtCarried: "20000000000",
      graceDeadline: "1807552000",
    });
    const none = decode(ev.noteCancelled(5, AGENT, 0n, null)).data;
    expect(none).toEqual({ noteId: 5, agent: AGENT, debtCarried: "0" });
    expect("graceDeadline" in none).toBe(false);
  });

  it("DebtWrittenOff / BalanceWithdrawn / JuniorDeposit / JuniorWithdraw / FeesClaimed / ClockAdvanced", () => {
    expect(decode(ev.debtWrittenOff(AGENT, 20_000_000_000n, 20_000_000_000n, 0n)).data).toEqual({
      agent: AGENT,
      amount: "20000000000",
      juniorLoss: "20000000000",
      seniorLoss: "0",
    });
    expect(decode(ev.balanceWithdrawn(AGENT, 5n, INVESTOR)).data).toEqual({ agent: AGENT, amount: "5", to: INVESTOR });
    expect(decode(ev.juniorDeposit(100_000_000_000n))).toMatchObject({ type: "JuniorDeposit", data: { amount: "100000000000" } });
    expect(decode(ev.juniorWithdraw(1n)).type).toBe("JuniorWithdraw");
    expect(decode(ev.feesClaimed(2n)).type).toBe("FeesClaimed");
    expect(decode(ev.clockAdvanced(2_592_000n, 1_794_592_000n)).data).toEqual({ secs: "2592000", protocolNow: "1794592000" });
  });
});

describe("decodeEvent: standard events", () => {
  it("SEP-56 Deposit/Withdraw take their addresses from the topics", () => {
    expect(decode(ev.deposit(INVESTOR, 50_000_000_000n, 48_000_000_000n))).toMatchObject({
      type: "Deposit",
      contract: POOL_ID,
      data: { operator: INVESTOR, from: INVESTOR, receiver: INVESTOR, assets: "50000000000", shares: "48000000000" },
    });
    expect(decode(ev.withdraw(INVESTOR, 10n, 9n)).data).toEqual({ operator: INVESTOR, receiver: INVESTOR, owner: INVESTOR, assets: "10", shares: "9" });
  });

  it("SEP-41 transfer (single-value data) and the SEP-50 NFT mint (token_id)", () => {
    expect(decode(ev.transfer(INVESTOR, POOL_ID, 7n))).toMatchObject({ type: "Transfer", contract: TEURC_ID, data: { from: INVESTOR, to: POOL_ID, amount: "7" } });
    const nftMint = rawEvent("mint", [scAddress(AGENT)], scStruct({ token_id: scU32(1) }), { contract: NOTE_ID });
    expect(decode(nftMint).data).toEqual({ to: AGENT, tokenId: 1 });
  });

  // Layouts observed on testnet from a Stellar Asset Contract (what real EURC would emit).
  it("Stellar Asset Contract events keep the SEP-11 asset topic apart from the amount", () => {
    const asset = xdr.ScVal.scvString("EURC:GDO7PQZFRPUCZ3PO6YIRDNMY7LGHS4TQ7J54NAEOPUV7RKLBRAAJ5C43");
    const mint = decode(rawEvent("mint", [scAddress(AGENT), asset], scI128(10_000_000_000n), { contract: TEURC_ID }));
    expect(mint.data).toEqual({ to: AGENT, amount: "10000000000", extraTopics: ["EURC:GDO7PQZFRPUCZ3PO6YIRDNMY7LGHS4TQ7J54NAEOPUV7RKLBRAAJ5C43"] });
    const transfer = decode(rawEvent("transfer", [scAddress(INVESTOR), scAddress(POOL_ID), asset], scI128(5n), { contract: TEURC_ID }));
    expect(transfer.data).toMatchObject({ from: INVESTOR, to: POOL_ID, amount: "5" });
    const approve = decode(rawEvent("approve", [scAddress(INVESTOR), scAddress(POOL_ID), asset], xdr.ScVal.scvVec([scI128(9n), scU32(77)]), { contract: TEURC_ID }));
    expect(approve.data).toMatchObject({ owner: INVESTOR, spender: POOL_ID, amount: "9", liveUntilLedger: 77 });
  });
});

describe("robustness", () => {
  it("fills a field the contract moved into the topics (#[topic] agent)", () => {
    const raw = rawEvent(
      "card_draw",
      [scAddress(AGENT)],
      scStruct({ amount: scI128(5n), from_balance: scI128(5n), from_credit: scI128(0n), auth_ref: xdr.ScVal.scvBytes(new Uint8Array(32)) }),
    );
    expect(decode(raw).data).toMatchObject({ agent: AGENT, amount: "5", fromBalance: "5" });
  });

  it("stores unknown events generically", () => {
    const d = decode(rawEvent("pool_paused", [scAddress(AGENT)], scI128(1n)));
    expect(d).toMatchObject({ type: "PoolPaused", known: false, data: { value: "1", topics: [AGENT] } });
    expect(decodePayload([scU32(5)], xdr.ScVal.scvVoid())).toEqual({ type: "Unknown", data: { topics: [5] }, known: false });
  });

  it("skips events from failed calls", () => {
    expect(decodeEvent({ ...ev.juniorDeposit(1n), inSuccessfulContractCall: false })).toBeNull();
  });
});

describe("ids, cursors and times", () => {
  it("reads the ledger from an RPC cursor and orders events", () => {
    expect(ledgerOfCursor("0022645970982404095-4294967295")).toBe(5_272_675);
    const a = decode(ev.juniorDeposit(1n, { ledger: BASE_LEDGER, txOrder: 2, index: 1 }));
    const b = decode(ev.juniorDeposit(1n, { ledger: BASE_LEDGER, txOrder: 2, index: 0 }));
    const c = decode(ev.juniorDeposit(1n, { ledger: BASE_LEDGER - 1, txOrder: 9 }));
    expect([a, b, c].sort(compareEvents).map((e) => [e.ledger, e.eventIdx])).toEqual([
      [BASE_LEDGER - 1, 0],
      [BASE_LEDGER, 0],
      [BASE_LEDGER, 1],
    ]);
  });

  it("parses close times as unix seconds or ISO", () => {
    expect(parseCloseTime("1792941732")).toBe(1_792_941_732);
    expect(parseCloseTime("2026-10-25T15:21:02Z")).toBe(1_792_941_662);
    expect(pascalCase("debt_written_off")).toBe("DebtWrittenOff");
  });
});
