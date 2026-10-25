import { describe, expect, it } from "vitest";

import { randomNif } from "@/components/admin/demo-data";

import { isValidNif, nifCheckDigit, nifChecksumWarning, normalizeNif } from "./nif";

describe("Portuguese NIF check digit (mod 11)", () => {
  it.each([
    // weights 9…2 over the first eight digits; rest 0 or 1 → check digit 0, else 11 − rest
    ["12345678", 9], // Σ = 156, rest 2
    ["98765432", 2], // Σ = 284, rest 9
    ["11000000", 5], // Σ = 17, rest 6
    ["10000000", 2], // Σ = 9, rest 9
    ["50000000", 0], // Σ = 45, rest 1
    ["10000001", 0], // Σ = 11, rest 0
  ])("check digit of %s is %i", (first8, expected) => {
    expect(nifCheckDigit(first8)).toBe(expected);
  });

  it("accepts valid NIFs and NIPCs, rejects a wrong check digit or length", () => {
    expect(isValidNif("123456789")).toBe(true);
    expect(isValidNif("987654322")).toBe(true);
    expect(isValidNif("500000000")).toBe(true); // company (NIPC) prefix, same rule
    expect(isValidNif("987654321")).toBe(false);
    expect(isValidNif("123456780")).toBe(false);
    expect(isValidNif("12345678")).toBe(false);
    expect(isValidNif("1234567890")).toBe(false);
    expect(isValidNif("12345678a")).toBe(false);
  });

  it("agrees with the demo-data generator", () => {
    for (let i = 0; i < 200; i++) expect(isValidNif(randomNif())).toBe(true);
  });

  it("normalizes NIFs as written in contracts", () => {
    expect(normalizeNif("123 456 789")).toBe("123456789");
    expect(normalizeNif("123.456.789")).toBe("123456789");
    expect(normalizeNif("PT123456789")).toBe("123456789");
    expect(normalizeNif(" pt 123-456-789 ")).toBe("123456789");
    expect(normalizeNif("12345678")).toBeNull();
    expect(normalizeNif("NIF desconhecido")).toBeNull();
  });

  it("words a warning only for a 9-digit NIF that fails the check", () => {
    expect(nifChecksumWarning("123456789", "Buyer")).toBeNull();
    expect(nifChecksumWarning("12345", "Buyer")).toBeNull();
    expect(nifChecksumWarning("123456780", "Seller")).toBe("Seller NIF 123456780 fails the Portuguese check digit (mod 11): compare it with the contract.");
  });

  it("rejects bad input to nifCheckDigit", () => {
    expect(() => nifCheckDigit("1234567")).toThrow(RangeError);
  });
});
