// Interest ticking must match advance_pool's index formula (spec §5.2, §5.6).

import { describe, expect, it } from "vitest";

import { formatEur } from "@/lib/format";
import type { AgentPosition, Jsonify } from "@/lib/types/chain";

import { debtOf, formatEurPrecise, growIndex, indexAt, liveDebt, projectDebt, protocolNowAt, scaledForBorrow, type Rates } from "./interest";

const EUR = 10_000_000n;
const SCALE = 10n ** 18n;
const DAY = 86_400;
const T0 = 1_793_016_000; // protocol day 0 of the example
const FETCHED_AT_MS = 1_761_393_600_000; // wall clock of the read (unrelated to the protocol clock in demo mode)

function rates(over: Partial<Rates> = {}): Rates {
  return { agentAprBps: 1200, borrowIndex: SCALE.toString(), protocolNow: T0, fetchedAtMs: FETCHED_AT_MS, live: true, ...over };
}

/** One line: €3,000 drawn at index `index0` against a €3,750 credit limit. */
function examplePosition(index0 = SCALE, carriedDebt = 0n): Jsonify<AgentPosition> {
  const principal = 3_000n * EUR;
  const scaled = scaledForBorrow(principal, index0);
  const debt = debtOf(scaled, index0);
  return {
    cardBalance: "0",
    cardEnabled: true,
    blocked: false,
    lines: [
      {
        line: { noteId: 12, agent: "CAGENT", creditLimit: String(3_750n * EUR), principal: String(principal), scaledDebt: String(scaled), escrituraDay: Math.floor(T0 / DAY) + 90, status: "Active" },
        debt: String(debt),
        interest: String(debt - principal),
        available: String(3_750n * EUR - debt),
      },
    ],
    carriedDebt: String(carriedDebt),
    graceDeadline: null,
    totalDebt: String(debt + carriedDebt),
    totalPrincipal: String(principal + carriedDebt),
    availableCredit: String(3_750n * EUR - debt),
    borrowableNow: String(3_750n * EUR - debt),
  };
}

describe("borrow index math (advance_pool accrue)", () => {
  it("§5.6 worked example: €3,000 × 12% × 90/365 = €88.77 with a single accrual", () => {
    const index = growIndex(SCALE, 1200, 90 * DAY);
    expect(index).toBe(SCALE + 29_589_041_095_890_410n); // floor(1e18 × 1200 × 7,776,000 / (10,000 × 31,536,000))

    const scaled = scaledForBorrow(3_000n * EUR, SCALE);
    expect(scaled).toBe(3_000n * EUR);
    const debt = debtOf(scaled, index);
    expect(debt).toBe(30_887_671_233n); // ceil: debts round up
    const interest = debt - 3_000n * EUR;
    expect(formatEur(interest)).toBe("€88.77");
    expect(formatEur(debt)).toBe("€3,088.77");

    // Settlement of the €15,000 commission: agent half minus the debt goes to the card balance.
    expect(formatEur(7_500n * EUR - debt)).toBe("€4,411.23");
    // 10% protocol fee and the tranches' share of the interest.
    const fee = (interest * 1_000n) / 10_000n;
    expect(formatEur(fee)).toBe("€8.88");
    expect(formatEur(interest - fee)).toBe("€79.89");
  });

  it("with daily accruals the interest compounds to ≈ €90.08", () => {
    let index = SCALE;
    for (let day = 0; day < 90; day++) index = growIndex(index, 1200, DAY);
    expect(formatEur(debtOf(3_000n * EUR, index) - 3_000n * EUR)).toBe("€90.08");
  });

  it("ignores non-positive and fractional time", () => {
    expect(growIndex(SCALE, 1200, 0)).toBe(SCALE);
    expect(growIndex(SCALE, 1200, -5)).toBe(SCALE);
    expect(growIndex(SCALE, 1200, 1.9)).toBe(growIndex(SCALE, 1200, 1));
    expect(growIndex(SCALE, 1200, Number.NaN)).toBe(SCALE);
  });

  it("projects a debt read at one index to another without a jump at the read", () => {
    const index1 = growIndex(SCALE, 1200, 90 * DAY);
    expect(projectDebt(3_000n * EUR, SCALE, SCALE)).toBe(3_000n * EUR);
    expect(projectDebt(3_000n * EUR, SCALE, index1)).toBe(30_887_671_233n);
    expect(projectDebt(0n, SCALE, index1)).toBe(0n);
    expect(projectDebt(3_000n * EUR, index1, SCALE)).toBe(3_000n * EUR); // never decreases
  });
});

describe("live ticking from the overview's rates", () => {
  it("extrapolates the protocol clock from fetchedAtMs and never runs it backwards", () => {
    expect(protocolNowAt(rates(), FETCHED_AT_MS)).toBe(T0);
    expect(protocolNowAt(rates(), FETCHED_AT_MS + 1_500)).toBe(T0 + 1.5);
    expect(protocolNowAt(rates(), FETCHED_AT_MS - 60_000)).toBe(T0); // client clock behind the server
  });

  it("reaches the worked example's €88.77 after 90 protocol days", () => {
    const r = rates();
    const position = examplePosition();
    const now = protocolNowAt(r, FETCHED_AT_MS + 90 * DAY * 1000);
    const live = liveDebt(position, r, now);
    expect(live.totalDebt).toBe(30_887_671_233n);
    expect(formatEur(live.interest)).toBe("€88.77");
    expect(live.lines[0]).toMatchObject({ noteId: 12, principal: 3_000n * EUR, debt: 30_887_671_233n, interest: 887_671_233n });
    expect(formatEurPrecise(live.interest)).toBe("€88.767123");
  });

  it("ticks every second (≈ €0.0000114 on €3,000) and re-syncs from a refreshed index", () => {
    const r = rates();
    const position = examplePosition();
    const atRead = liveDebt(position, r, T0);
    const oneSecond = liveDebt(position, r, T0 + 1);
    expect(atRead.interest).toBe(0n);
    expect(oneSecond.interest).toBe(115n); // 114.15… stroops, rounded up
    expect(formatEurPrecise(oneSecond.interest, 7)).toBe("€0.0000115");

    // After a refresh the server reports the compounded index and the matching debt: ticking resumes from there.
    const index30 = growIndex(SCALE, 1200, 30 * DAY);
    const refreshed = examplePosition(SCALE);
    refreshed.lines[0].debt = String(debtOf(3_000n * EUR, index30));
    refreshed.totalDebt = refreshed.lines[0].debt;
    const r30 = rates({ borrowIndex: index30.toString(), protocolNow: T0 + 30 * DAY });
    expect(liveDebt(refreshed, r30, T0 + 30 * DAY).totalDebt).toBe(debtOf(3_000n * EUR, index30));
    expect(liveDebt(refreshed, r30, T0 + 90 * DAY).totalDebt).toBe(debtOf(3_000n * EUR, growIndex(index30, 1200, 60 * DAY)));
  });

  it("projects carried debt with the same index and counts it in the totals", () => {
    const position = examplePosition(SCALE, 2_000n * EUR);
    const live = liveDebt(position, rates(), T0 + 90 * DAY);
    expect(live.carriedDebt).toBe(projectDebt(2_000n * EUR, SCALE, growIndex(SCALE, 1200, 90 * DAY)));
    expect(live.totalDebt).toBe(live.carriedDebt + 30_887_671_233n);
    expect(live.interest).toBe(live.totalDebt - 5_000n * EUR);
  });

  it("doesn't tick when the read wasn't live", () => {
    const r = rates({ live: false });
    expect(indexAt(r, T0 + 90 * DAY)).toBe(SCALE);
    expect(liveDebt(examplePosition(), r, T0 + 90 * DAY).interest).toBe(0n);
  });
});
