import { describe, expect, it } from "vitest";

import { detailResponse, fixtureNotes } from "./__tests__/fixtures";
import { describePublicSignals, signalHex } from "./public-signals";
import { describeTimeline, describeTimelineEvent, humanizeType } from "./timeline";

describe("public signal labels", () => {
  it("labels the 9 signals and reads amounts and dates", () => {
    const rows = describePublicSignals(fixtureNotes()[0].publicInputs);
    expect(rows.map((r) => r.name)).toEqual([
      "agent_field",
      "total_commission_cents",
      "agent_commission_cents",
      "escritura_day",
      "commitment",
      "nullifier",
      "attester_ax",
      "attester_ay",
      "nullifier_secret_commitment",
    ]);
    expect(rows[1].reading).toBe("€15,000.00");
    expect(rows[2].reading).toBe("€7,500.00");
    expect(rows[3].reading).toBe("23 Jan 2027");
    expect(rows[4].reading).toBe(`0x${fixtureNotes()[0].commitment}`);
    expect(rows[6].reading).toBe("0x11be77cc7c3f4e6937c5d8b8cdc8d8a64b044b8bc8816346c38e018c7459013b");
  });

  it("returns nothing for an incomplete list", () => {
    expect(describePublicSignals([])).toEqual([]);
    expect(describePublicSignals(["1", "2"])).toEqual([]);
  });

  it("pads field elements to 32 bytes", () => {
    expect(signalHex("255")).toBe("0".repeat(62) + "ff");
  });
});

describe("timeline", () => {
  it("describes the fixture timeline in plain English", () => {
    const items = describeTimeline(detailResponse(0).timeline);
    expect(items.map((i) => i.title)).toEqual(["Note minted", "Credit line opened", "Card purchase on credit", "Card purchase on credit"]);
    expect(items[1].description).toBe("€3,750.00 of credit for the agent's card (50% of their commission).");
    expect(items[2].description).toBe("€349.00 borrowed against this note");
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it("spells out a settlement, a cancellation and a write-off", () => {
    const settled = describeTimelineEvent({
      type: "NoteSettled",
      at: 1_808_438_400,
      ledger: 9,
      txHash: "ab",
      data: {
        noteId: 1,
        totalCommission: "150000000000",
        debtRepaid: "30887671233",
        interestPaid: "887671233",
        carriedRepaid: "0",
        agentPayout: "44112328767",
        juniorDeposit: "75000000000",
      },
    });
    expect(settled.title).toBe("Escritura confirmed");
    expect(settled.description).toBe(
      "€15,000.00 paid in · €3,088.77 debt repaid (incl. €88.77 interest) · €4,411.23 to the agent's card balance · €7,500.00 to the first-loss tranche",
    );
    expect(settled.tone).toBe("emerald");

    const cancelled = describeTimelineEvent({
      type: "NoteCancelled",
      at: null,
      ledger: 10,
      txHash: "cd",
      data: { noteId: 4, debtCarried: "20000000000", graceDeadline: 1_815_350_400 },
    });
    expect(cancelled.description).toBe("€2,000.00 of debt carried to the agent's next deals · grace period until 12 Jul 2027");

    const writtenOff = describeTimelineEvent({
      type: "DebtWrittenOff",
      at: null,
      ledger: 11,
      txHash: "ef",
      data: { amount: "20000000000", juniorLoss: "20000000000", seniorLoss: "0" },
    });
    expect(writtenOff.description).toBe("€2,000.00 written off · €2,000.00 from the first-loss tranche · €0.00 from senior");
  });

  it("falls back to the event name for unknown types and malformed data", () => {
    expect(humanizeType("NoteStatusChanged")).toBe("Note status changed");
    const item = describeTimelineEvent({ type: "ClockAdvanced", at: null, ledger: 1, txHash: "x", data: {} });
    expect(item).toMatchObject({ title: "Clock advanced", description: null, icon: "event" });
    expect(describeTimelineEvent({ type: "LineOpened", at: null, ledger: 1, txHash: "x", data: { creditLimit: "n/a" } }).description).toBe(
      "Credit for the agent's card (50% of their commission).",
    );
  });
});
