import { describe, expect, it } from "vitest";

import { groupNumeric, normalizeNumeric } from "./number-input";

describe("normalizeNumeric", () => {
  it("strips everything but digits and one dot", () => {
    expect(normalizeNumeric("€300,000", 0)).toBe("300000");
    expect(normalizeNumeric("1.2.3", 2)).toBe("1.23");
    expect(normalizeNumeric("62.005", 2)).toBe("62.00");
    expect(normalizeNumeric("12.5", 0)).toBe("125");
  });

  it("collapses leading zeros but keeps typing state", () => {
    expect(normalizeNumeric("0003", 0)).toBe("3");
    expect(normalizeNumeric("0", 0)).toBe("0");
    expect(normalizeNumeric(".5", 2)).toBe("0.5");
    expect(normalizeNumeric("62.", 2)).toBe("62.");
    expect(normalizeNumeric("", 2)).toBe("");
  });
});

describe("groupNumeric", () => {
  it("groups thousands en-GB style", () => {
    expect(groupNumeric("300000")).toBe("300,000");
    expect(groupNumeric("1234567.89")).toBe("1,234,567.89");
    expect(groupNumeric("62.")).toBe("62.");
    expect(groupNumeric("")).toBe("");
  });
});
