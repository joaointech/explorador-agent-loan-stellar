// Registry list pieces rendered to HTML with the mocked GET /api/registry body.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { listResponse } from "./__tests__/fixtures";
import { ApiRequestError } from "./api-client";
import { describeApiError } from "./load-error";
import { resultSummary } from "./registry-explorer";
import { RegistryResults } from "./registry-results";
import { StatusCounts } from "./status-counts";
import { TrustModel } from "./trust-model";

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("registry results", () => {
  const { notes, counts } = listResponse();
  const html = renderToStaticMarkup(<RegistryResults notes={notes} />);
  const text = textOf(html);

  it("lists every note in the table and as phone cards, linking to the detail page", () => {
    for (const n of notes) {
      expect(html).toContain(`href="/registry/${n.id}"`);
      expect(text).toContain(`Note #${n.id}`);
    }
    expect(html).toContain("<table");
    expect(text).toContain("CCI4…WMQR");
  });

  it("shows status badges, Overdue only where the API flags it", () => {
    for (const label of ["Active", "Settled", "Cancelled", "Written off"]) expect(text).toContain(label);
    // One overdue note, shown once in the table and once in its card.
    expect(text.match(/Overdue/g)).toHaveLength(2);
  });

  it("formats amounts, dates and mint transactions", () => {
    expect(text).toContain("€15,000.00");
    expect(text).toContain("€7,500.00");
    expect(text).toContain("€3,750.00");
    expect(text).toContain("23 Jan 2027");
    expect(html).toContain("https://stellar.expert/explorer/testnet/tx/7b1e5f0a9c3d4e2f");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("counts notes by status", () => {
    const countsText = textOf(renderToStaticMarkup(<StatusCounts counts={counts} />));
    expect(countsText).toMatch(/Notes 5/);
    expect(countsText).toMatch(/Written off 1/);
    const loading = renderToStaticMarkup(<StatusCounts counts={null} loading />);
    expect(loading).toContain('aria-busy="true"');
  });

  it("states the trust model of spec §8.1", () => {
    const trust = textOf(renderToStaticMarkup(<TrustModel />));
    expect(trust).toContain("explorador is the attester");
    expect(trust).toContain("between 1% and 10%");
    expect(trust).toContain("financed twice");
    expect(trust).toContain("Their NIFs");
    expect(trust).toContain("auditor");
  });
});

describe("result summary", () => {
  const counts = { Active: 12, Settled: 30, Cancelled: 10, WrittenOff: 5, total: 57 };
  it("says how much of the registry is shown", () => {
    expect(resultSummary({ status: null, q: "" }, 25, counts)).toBe("Showing 25 of 57 notes");
    expect(resultSummary({ status: null, q: "" }, 57, counts)).toBe("57 notes");
    expect(resultSummary({ status: "Active", q: "" }, 12, counts)).toBe("12 active notes");
    expect(resultSummary({ status: "WrittenOff", q: "" }, 1, { ...counts, WrittenOff: 1 })).toBe("1 written off note");
    expect(resultSummary({ status: null, q: "12" }, 1, counts)).toBe("1 note matching “12”");
    expect(resultSummary({ status: "Settled", q: "CCI4" }, 0, counts)).toBe("0 settled notes matching “CCI4”");
  });
});

describe("API errors", () => {
  it("turns failures into one actionable sentence", () => {
    expect(describeApiError(new ApiRequestError(0, "NETWORK", "Couldn't reach the server."))).toBe("Couldn't reach the server.");
    expect(describeApiError(new ApiRequestError(404, "HTTP_404", "Not Found"))).toMatch(/isn't available yet/);
    expect(describeApiError(new ApiRequestError(503, "NO_DEPLOYMENT", "No active deployment"))).toMatch(/No active deployment/);
    expect(describeApiError(new ApiRequestError(400, "VALIDATION_ERROR", "cursor must come from nextCursor"))).toBe("cursor must come from nextCursor");
  });
});
