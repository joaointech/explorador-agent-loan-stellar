import { describe, expect, it } from "vitest";

import { decodeEvent, type DecodedEvent } from "./events";
import { BASE_CLOSE, BASE_LEDGER, ev } from "./fixtures";
import { anchorFromClockEvent, assignProtocolTimes, needsCurrentOffset } from "./protocol-time";

const DAY = 86_400;
const d = (raw: ReturnType<typeof ev.juniorDeposit>): DecodedEvent => decodeEvent(raw)!;
const at = (ledger: number) => ({ ledger, closedAt: BASE_CLOSE + (ledger - BASE_LEDGER) * 5 });

describe("assignProtocolTimes", () => {
  it("without any ClockAdvanced uses the current offset", () => {
    const events = [d(ev.juniorDeposit(1n, at(BASE_LEDGER))), d(ev.feesClaimed(1n, at(BASE_LEDGER + 10)))];
    expect(needsCurrentOffset(events, null)).toBe(true);
    expect(assignProtocolTimes(events, null, 3 * DAY)).toEqual([BASE_CLOSE + 3 * DAY, BASE_CLOSE + 50 + 3 * DAY]);
  });

  it("pins offsets around an in-batch ClockAdvanced (before = after − secs)", () => {
    // offset 0 before; at ledger +10 the admin fast-forwards 30 days
    const advanceClose = BASE_CLOSE + 50;
    const events = [
      d(ev.juniorDeposit(1n, at(BASE_LEDGER))),
      d(ev.clockAdvanced(BigInt(30 * DAY), BigInt(advanceClose + 30 * DAY), at(BASE_LEDGER + 10))),
      d(ev.feesClaimed(1n, at(BASE_LEDGER + 20))),
    ];
    expect(needsCurrentOffset(events, null)).toBe(false);
    expect(assignProtocolTimes(events, null, 999)).toEqual([BASE_CLOSE, advanceClose + 30 * DAY, BASE_CLOSE + 100 + 30 * DAY]);
  });

  it("continues from the stored anchor and chains several fast-forwards", () => {
    const prior = { offsetAfter: 10 * DAY };
    const c1 = BASE_CLOSE + 25;
    const c2 = BASE_CLOSE + 75;
    const events = [
      d(ev.feesClaimed(1n, at(BASE_LEDGER))),
      d(ev.clockAdvanced(BigInt(7 * DAY), BigInt(c1 + 17 * DAY), at(BASE_LEDGER + 5))),
      d(ev.feesClaimed(1n, at(BASE_LEDGER + 10))),
      d(ev.clockAdvanced(BigInt(DAY), BigInt(c2 + 18 * DAY), at(BASE_LEDGER + 15))),
      d(ev.feesClaimed(1n, at(BASE_LEDGER + 20))),
    ];
    expect(assignProtocolTimes(events, prior, 0)).toEqual([
      BASE_CLOSE + 10 * DAY,
      c1 + 17 * DAY,
      BASE_CLOSE + 50 + 17 * DAY,
      c2 + 18 * DAY,
      BASE_CLOSE + 100 + 18 * DAY,
    ]);
  });

  it("keeps the input order of the result array", () => {
    const later = d(ev.feesClaimed(1n, at(BASE_LEDGER + 4)));
    const earlier = d(ev.feesClaimed(1n, at(BASE_LEDGER)));
    expect(assignProtocolTimes([later, earlier], { offsetAfter: 0 }, 0)).toEqual([BASE_CLOSE + 20, BASE_CLOSE]);
  });
});

describe("anchorFromClockEvent", () => {
  it("derives the offset after the fast-forward", () => {
    expect(anchorFromClockEvent({ closedAt: 1_000, data: { secs: "86400", protocolNow: String(1_000 + 86_400) } })).toEqual({ offsetAfter: 86_400 });
    expect(anchorFromClockEvent({ closedAt: 0, data: { protocolNow: "5" } })).toBeNull();
  });
});
