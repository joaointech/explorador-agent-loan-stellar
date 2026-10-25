import { describe, expect, it } from "vitest";

import {
  classifyStatus,
  computeSpendable,
  decideAuthorization,
  isPendingHold,
  sumPendingHolds,
  type DecisionInput,
  type HoldCandidate,
  type PositionSnapshot,
} from "./decision";

const EUR = 10_000_000n; // stroops per euro

function position(over: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    cardBalance: 0n,
    cardEnabled: true,
    availableCredit: 3_750n * EUR, // worked example credit limit (spec §5.6)
    borrowableNow: 3_750n * EUR,
    source: "chain",
    cachedAt: null,
    ...over,
  };
}

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    kind: "purchase",
    amountCents: 480n, // Pastelaria Aloma €4.80
    agent: { cardEnabledOnChain: true },
    position: position(),
    stats: { lendable: 100_000n * EUR, leverageHeadroom: 90_000n * EUR },
    pendingHolds: 0n,
    ...over,
  };
}

describe("classifyStatus", () => {
  it("maps Lithic ASA statuses", () => {
    expect(classifyStatus("AUTHORIZATION")).toBe("purchase");
    expect(classifyStatus("FINANCIAL_AUTHORIZATION")).toBe("purchase");
    expect(classifyStatus("BALANCE_INQUIRY")).toBe("balance_inquiry");
    expect(classifyStatus("CREDIT_AUTHORIZATION")).toBe("other");
    expect(classifyStatus("FINANCIAL_CREDIT_AUTHORIZATION")).toBe("other");
    expect(classifyStatus("SOMETHING_NEW")).toBe("other");
  });
});

describe("decideAuthorization", () => {
  it("approves a purchase within spendable and schedules a draw", () => {
    const d = decideAuthorization(input());
    expect(d).toMatchObject({ result: "APPROVED", record: true, draw: true });
    expect(d.spendable).toBe(3_750n * EUR);
  });

  it("approves exactly at the limit (amount × 100_000 ≤ spendable)", () => {
    const d = decideAuthorization(input({ amountCents: 375_000n }));
    expect(d.result).toBe("APPROVED");
  });

  it("declines with INSUFFICIENT_FUNDS one cent above spendable", () => {
    const d = decideAuthorization(input({ amountCents: 375_001n }));
    expect(d).toMatchObject({ result: "INSUFFICIENT_FUNDS", record: true, draw: false });
  });

  it("spends card balance first: balance + credit is spendable", () => {
    const d = decideAuthorization(input({ amountCents: 500_000n, position: position({ cardBalance: 1_250n * EUR }) }));
    expect(d.result).toBe("APPROVED");
    expect(d.spendable).toBe(5_000n * EUR);
  });

  it("declines CARD_PAUSED when a live read says the card is not enabled on-chain", () => {
    const d = decideAuthorization(input({ position: position({ cardEnabled: false }) }));
    expect(d).toMatchObject({ result: "CARD_PAUSED", record: true, draw: false });
  });

  it("follows a live read when the Agent.cardEnabledOnChain mirror lags behind", () => {
    const d = decideAuthorization(input({ agent: { cardEnabledOnChain: false }, position: position({ cardEnabled: true }) }));
    expect(d.result).toBe("APPROVED");
  });

  it("without a live read, the mirror decides", () => {
    const cached = position({ cardEnabled: true, source: "cache", cachedAt: new Date() });
    expect(decideAuthorization(input({ agent: { cardEnabledOnChain: false }, position: cached })).result).toBe("CARD_PAUSED");
    expect(decideAuthorization(input({ agent: { cardEnabledOnChain: false }, position: null })).result).toBe("CARD_PAUSED");
    // …and wins over a cached position's own card_enabled.
    const stale = position({ cardEnabled: false, source: "cache", cachedAt: new Date() });
    expect(decideAuthorization(input({ position: stale })).result).toBe("APPROVED");
  });

  it("declines SUSPECTED_FRAUD for an unknown card, without recording", () => {
    const d = decideAuthorization(input({ agent: null }));
    expect(d).toMatchObject({ result: "SUSPECTED_FRAUD", record: false, draw: false });
  });

  it("declines when no position is available at all", () => {
    const d = decideAuthorization(input({ position: null }));
    expect(d).toMatchObject({ result: "INSUFFICIENT_FUNDS", draw: false, spendable: 0n });
  });

  it("answers a balance inquiry with spendable in cents, unrecorded", () => {
    const d = decideAuthorization(
      input({ kind: "balance_inquiry", amountCents: 0n, position: position({ cardBalance: 10n * EUR }), pendingHolds: 480n * 100_000n }),
    );
    expect(d).toMatchObject({ result: "APPROVED", record: false, draw: false });
    // €10 + €3,750 − €4.80 = €3,755.20
    expect(d.balance).toEqual({ amount: 375_520, available: 375_520 });
  });

  it("reports a zero balance for a paused card", () => {
    const d = decideAuthorization(input({ kind: "balance_inquiry", position: position({ cardEnabled: false }) }));
    expect(d.balance).toEqual({ amount: 0, available: 0 });
  });

  it("approves and records credits with no on-chain action", () => {
    const d = decideAuthorization(input({ kind: "other", amountCents: -500n }));
    expect(d).toMatchObject({ result: "APPROVED", record: true, draw: false });
  });

  it("approves zero-amount verifications without a draw", () => {
    const d = decideAuthorization(input({ amountCents: 0n }));
    expect(d).toMatchObject({ result: "APPROVED", record: true, draw: false });
  });
});

describe("computeSpendable (pending holds math)", () => {
  it("caps credit by lendable and leverage headroom", () => {
    const p = position({ cardBalance: 2n * EUR, borrowableNow: null });
    expect(computeSpendable(p, { lendable: 100n * EUR, leverageHeadroom: 900n * EUR }, 0n)).toBe(102n * EUR);
    expect(computeSpendable(p, { lendable: 900n * EUR, leverageHeadroom: 50n * EUR }, 0n)).toBe(52n * EUR);
  });

  it("falls back to the position's borrowable_now when stats are unavailable", () => {
    const p = position({ availableCredit: 3_750n * EUR, borrowableNow: 1_000n * EUR });
    expect(computeSpendable(p, null, 0n)).toBe(1_000n * EUR);
  });

  it("never lets negative credit eat into the card balance", () => {
    const p = position({ cardBalance: 5n * EUR, availableCredit: 0n, borrowableNow: 0n });
    expect(computeSpendable(p, { lendable: -1n, leverageHeadroom: 0n }, 0n)).toBe(5n * EUR);
  });

  it("subtracts pending holds and can go negative", () => {
    const p = position({ availableCredit: 10n * EUR, borrowableNow: 10n * EUR });
    expect(computeSpendable(p, null, 4n * EUR)).toBe(6n * EUR);
    expect(computeSpendable(p, null, 12n * EUR)).toBe(-2n * EUR);
  });

  it("a second purchase sees the first one's hold", () => {
    const p = position({ availableCredit: 100n * EUR, borrowableNow: 100n * EUR });
    const first = decideAuthorization(input({ amountCents: 6_000n, position: p, stats: null }));
    expect(first.result).toBe("APPROVED");
    const holds = sumPendingHolds([{ decision: "APPROVED", chainStatus: "PENDING", amountCents: 6_000n, createdAt: new Date() }], p);
    const second = decideAuthorization(input({ amountCents: 6_000n, position: p, stats: null, pendingHolds: holds }));
    expect(second.result).toBe("INSUFFICIENT_FUNDS");
    expect(second.spendable).toBe(40n * EUR);
  });
});

describe("isPendingHold / sumPendingHolds", () => {
  const t0 = new Date("2026-10-25T10:00:00Z");
  const before = new Date(t0.getTime() - 60_000);
  const after = new Date(t0.getTime() + 60_000);
  const row = (over: Partial<HoldCandidate>): HoldCandidate => ({
    decision: "APPROVED",
    chainStatus: "PENDING",
    amountCents: 1_000n,
    createdAt: before,
    ...over,
  });
  const live = { source: "chain" as const, cachedAt: null };
  const cached = { source: "cache" as const, cachedAt: t0 };

  it("counts approved draws not yet confirmed", () => {
    expect(isPendingHold(row({ chainStatus: "PENDING" }), live)).toBe(true);
    expect(isPendingHold(row({ chainStatus: "SUBMITTED" }), live)).toBe(true);
  });

  it("ignores confirmed (already on-chain) and failed draws, declines, credits and zero amounts", () => {
    expect(isPendingHold(row({ chainStatus: "CONFIRMED" }), live)).toBe(false);
    expect(isPendingHold(row({ chainStatus: "FAILED" }), live)).toBe(false);
    expect(isPendingHold(row({ decision: "DECLINED" }), live)).toBe(false);
    expect(isPendingHold(row({ amountCents: -500n }), live)).toBe(false);
    expect(isPendingHold(row({ amountCents: 0n }), live)).toBe(false);
  });

  it("with a cached position, also counts draws confirmed after the cached read", () => {
    expect(isPendingHold(row({ chainStatus: "CONFIRMED", createdAt: after }), cached)).toBe(true);
    expect(isPendingHold(row({ chainStatus: "CONFIRMED", createdAt: before }), cached)).toBe(false);
    expect(isPendingHold(row({ chainStatus: "CONFIRMED", createdAt: after }), { source: "cache", cachedAt: null })).toBe(false);
  });

  it("sums holds in stroops (cents × 100_000)", () => {
    const rows = [
      row({ amountCents: 480n }),
      row({ amountCents: 6_200n, chainStatus: "SUBMITTED" }),
      row({ amountCents: 34_900n, chainStatus: "CONFIRMED" }),
      row({ amountCents: 999n, decision: "DECLINED" }),
    ];
    expect(sumPendingHolds(rows, live)).toBe(6_680n * 100_000n);
    expect(sumPendingHolds([], live)).toBe(0n);
  });
});
