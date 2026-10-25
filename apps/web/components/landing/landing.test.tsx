// The landing page rendered to HTML (no browser): copy, links and every
// worked-example figure from spec §5.6, plus the stat pills' loading state.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

const html = renderToStaticMarkup(<Home />);
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("landing page", () => {
  it("has the hero copy and calls to action", () => {
    expect(text).toContain("explorador advance");
    expect(html).toMatch(/<h1[^>]*>.*Close the deal\..*Get paid today\..*<\/h1>/s);
    expect(html).toMatch(/href="\/agent"[^>]*>I&#x27;m an agent/);
    expect(html).toMatch(/href="\/invest"[^>]*>Invest/);
    expect(html).toMatch(/href="\/registry"[^>]*>See every deal on-chain/);
  });

  it("shows the live stat pills loading until /api/pool/stats answers", () => {
    for (const label of ["Pool TVL", "Senior APY", "Active notes", "Total advanced"]) expect(text).toContain(label);
    expect(html).toContain('aria-busy="true"');
  });

  it("walks through the spec §5.6 worked example", () => {
    for (const figure of [
      "A €300,000 sale,",
      "€15,000.00",
      "€7,500.00",
      "€3,750.00",
      "€3,000.00",
      "€88.77",
      "€4,411.23",
      "€8.88",
      "€79.89",
      "€3,088.77",
      "6.48%",
      "8.00%",
      "17.2%",
      "€6,480 net a year",
      "€9,720 net a year",
    ]) {
      expect(text).toContain(figure);
    }
  });

  it("explains privacy, first-loss protection and the Stellar standards", () => {
    expect(text).toContain("Zero-knowledge privacy");
    expect(text).toContain("Property address");
    expect(text).toContain("A buyer walks away and leaves €2,000.00 of carried debt");
    expect(text).toContain("€10,000 → €8,000");
    expect(text).toContain("€100,000 → €100,000");
    for (const standard of ["SEP-41", "SEP-50", "SEP-56", "Passkeys", "Protocol 25", "BN254 + Poseidon"]) expect(text).toContain(standard);
  });

  it("renders no placeholder values", () => {
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
  });
});
