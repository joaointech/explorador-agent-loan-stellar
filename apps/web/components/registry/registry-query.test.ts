import { describe, expect, it } from "vitest";

import {
  filtersFromSearchParams,
  normalizeQuery,
  noteHref,
  parseNoteIdParam,
  parseStatusParam,
  registryApiUrl,
  registryPageHref,
} from "./registry-query";

describe("registry URL state", () => {
  it("parses status filters like the API (case and separators ignored)", () => {
    expect(parseStatusParam("Active")).toBe("Active");
    expect(parseStatusParam("settled")).toBe("Settled");
    expect(parseStatusParam("written-off")).toBe("WrittenOff");
    expect(parseStatusParam("WrittenOff")).toBe("WrittenOff");
    expect(parseStatusParam("all")).toBeNull();
    expect(parseStatusParam("Overdue")).toBeNull();
    expect(parseStatusParam(null)).toBeNull();
  });

  it("normalizes searches", () => {
    expect(normalizeQuery("  #12  ")).toBe("#12");
    expect(normalizeQuery("CDLZ   4XQA")).toBe("CDLZ 4XQA");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
    expect(normalizeQuery(undefined)).toBe("");
  });

  it("reads filters from search params", () => {
    expect(filtersFromSearchParams(new URLSearchParams("status=cancelled&q=%20CCI4%20"))).toEqual({ status: "Cancelled", q: "CCI4" });
    expect(filtersFromSearchParams(new URLSearchParams("status=bogus"))).toEqual({ status: null, q: "" });
  });

  it("builds API and page URLs, omitting empty values", () => {
    expect(registryApiUrl({ status: null, q: "" })).toBe("/api/registry?limit=25");
    expect(registryApiUrl({ status: "WrittenOff", q: " #4 ", cursor: "40" })).toBe("/api/registry?status=WrittenOff&q=%234&cursor=40&limit=25");
    expect(registryPageHref({})).toBe("/registry");
    expect(registryPageHref({ status: "Active", q: "CCI4…WMQR" })).toBe("/registry?status=Active&q=CCI4%E2%80%A6WMQR");
    expect(noteHref(12)).toBe("/registry/12");
  });

  it("accepts u32 note ids only", () => {
    expect(parseNoteIdParam("12")).toBe(12);
    expect(parseNoteIdParam("0")).toBe(0);
    expect(parseNoteIdParam("4294967295")).toBe(4_294_967_295);
    expect(parseNoteIdParam("4294967296")).toBeNull();
    expect(parseNoteIdParam("-1")).toBeNull();
    expect(parseNoteIdParam("1e3")).toBeNull();
    expect(parseNoteIdParam("abc")).toBeNull();
  });
});
