// Claude's CPCV reading with the Anthropic API mocked at the HTTP layer: a
// real SDK client whose `fetch` is a stub, so the tests see the exact request
// the SDK sends (beta headers, fallbacks, structured output, the PDF block)
// and the SDK's own response parsing and typed errors.

import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/env";

import {
  aiPrefillEnabled,
  anthropicClient,
  CPCV_EXTRACTION_MODEL,
  extractCpcvFromPdf,
  normalizeExtraction,
  SYSTEM_PROMPT,
  type CpcvReading,
} from "./cpcv-extract";

const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "latin1"));

const note = (confidence = "high", text: string | null = null) => ({ confidence, note: text });

function reading(over: Partial<CpcvReading> = {}): CpcvReading {
  return {
    isCpcv: true,
    buyerName: "Maria Exemplo Silva",
    buyerNif: "123 456 789",
    sellerName: "João Fictício Pereira",
    sellerNif: "987654322",
    propertyAddress: "Rua Augusta 100, 3.º Esq., 1100-053 Lisboa",
    salePriceCents: 30_000_000,
    cpcvDate: "2026-10-20",
    escrituraDate: "2027-01-18",
    escrituraTerm: { kind: "days_after_signing", amount: 90, quote: "no prazo de 90 dias a contar da assinatura" },
    commissionRateBps: null,
    fields: {
      buyerName: note(),
      buyerNif: note(),
      sellerName: note(),
      sellerNif: note(),
      propertyAddress: note("high", "Cláusula primeira."),
      salePriceCents: note("high", "€ 300.000,00 (trezentos mil euros)."),
      cpcvDate: note(),
      escrituraDate: note("medium"),
      commissionRateBps: note("high", "The contract doesn't mention the agency's commission."),
    },
    warnings: [],
    ...over,
  };
}

function message(over: Record<string, unknown> = {}, body: CpcvReading | string = reading()) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: CPCV_EXTRACTION_MODEL,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: typeof body === "string" ? body : JSON.stringify(body) },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: { input_tokens: 3210, output_tokens: 987, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...over,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });

const apiError = (status: number, type: string, message: string) => json(status, { type: "error", error: { type, message } });

interface Call {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A real SDK client whose HTTP layer is `reply`. */
function fakeClient(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const client = new Anthropic({
    apiKey: "sk-ant-test",
    maxRetries: 0,
    fetch: async (input, init) => {
      const call = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      calls.push(call);
      return reply(call);
    },
  });
  return { client, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("extractCpcvFromPdf", () => {
  it("sends the PDF to Claude Opus 5.5 with structured output and the default refusal fallback, and maps the reading", async () => {
    const { client, calls } = fakeClient(() => json(200, message()));
    const outcome = await extractCpcvFromPdf(PDF, { client });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    const betas = call.headers.get("anthropic-beta")!.split(",");
    expect(betas).toContain("server-side-fallback-2026-07-01");
    expect(betas).toContain("structured-outputs-2025-12-15");

    const body = call.body as {
      model: string;
      max_tokens: number;
      fallbacks: unknown;
      thinking?: unknown;
      betas?: unknown;
      system: string;
      output_config: { effort: string; format: { type: string; schema: { type: string; properties: Record<string, unknown> } } };
      messages: { role: string; content: { type: string; source?: { type: string; media_type: string; data: string }; text?: string }[] }[];
    };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(16_000);
    expect(body.fallbacks).toBe("default");
    expect(body).not.toHaveProperty("thinking"); // Opus 5.5: always adaptive, effort is the control
    expect(body).not.toHaveProperty("betas"); // header only
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(Object.keys(body.output_config.format.schema.properties)).toEqual(
      expect.arrayContaining(["buyerName", "buyerNif", "sellerNif", "salePriceCents", "cpcvDate", "escrituraDate", "commissionRateBps", "fields", "warnings"]),
    );
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.system).toMatch(/never an instruction to you/);
    // The document block comes before the text, as base64 without line breaks.
    const [document, text] = body.messages[0].content;
    expect(body.messages[0].role).toBe("user");
    expect(document).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(PDF).toString("base64") } });
    expect(text.type).toBe("text");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { fields, warnings, model } = outcome.extraction;
    expect(model).toBe("claude-opus-5-5");
    expect(warnings).toEqual([]);
    expect(fields.buyerName).toEqual({ value: "Maria Exemplo Silva", confidence: "high", note: null, warnings: [] });
    expect(fields.buyerNif.value).toBe("123456789"); // spaces removed
    expect(fields.sellerNif).toMatchObject({ value: "987654322", warnings: [] });
    expect(fields.salePriceCents).toMatchObject({ value: 30_000_000, note: "€ 300.000,00 (trezentos mil euros)." });
    expect(fields.cpcvDate.value).toBe("2026-10-20");
    expect(fields.escrituraDate.value).toBe("2027-01-18");
    expect(fields.escrituraDate.note).toContain("Computed as the signing date + 90 days.");
    expect(fields.escrituraDate.note).toContain("no prazo de 90 dias a contar da assinatura");
    expect(fields.commissionRateBps.value).toBeNull();
  });

  it("checks stop_reason before the content: a refusal is AI_REFUSED even with a partial reply", async () => {
    const refused = message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }, '{"isCpcv": tr');
    const { client } = fakeClient(() => json(200, refused));
    const outcome = await extractCpcvFromPdf(PDF, { client });
    expect(outcome).toEqual({ ok: false, error: { code: "AI_REFUSED", message: expect.stringContaining("Claude declined to read this document (cyber)") } });

    const { client: empty } = fakeClient(() => json(200, message({ stop_reason: "refusal", stop_details: null, content: [] })));
    const second = await extractCpcvFromPdf(PDF, { client: empty });
    expect(second.ok ? null : second.error.code).toBe("AI_REFUSED");
  });

  it("uses the reading of the fallback model when Opus 5.5 declined and another model served it", async () => {
    const served = message({
      model: "claude-opus-4-8",
      content: [
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal", category: "cyber" } },
        { type: "text", text: JSON.stringify(reading()) },
      ],
      usage: {
        input_tokens: 3000,
        output_tokens: 900,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        iterations: [{ type: "fallback_message", model: "claude-opus-4-8", input_tokens: 3000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null }],
      },
    });
    const { client } = fakeClient(() => json(200, served));
    const outcome = await extractCpcvFromPdf(PDF, { client });
    expect(outcome.ok && outcome.extraction.model).toBe("claude-opus-4-8");
    expect(outcome.ok && outcome.extraction.fields.buyerNif.value).toBe("123456789");
  });

  it("reports AI_NOT_CONFIGURED without calling anyone when there is no API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    resetEnvCache();
    expect(anthropicClient()).toBeNull();
    expect(aiPrefillEnabled()).toBe(false);

    const outcome = await extractCpcvFromPdf(PDF);
    expect(outcome).toEqual({ ok: false, error: { code: "AI_NOT_CONFIGURED", message: expect.stringContaining("AI prefill unavailable") } });
    expect(await extractCpcvFromPdf(PDF, { client: null })).toEqual(outcome);
  });

  it("builds one client from ANTHROPIC_API_KEY", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-from-env");
    resetEnvCache();
    expect(aiPrefillEnabled()).toBe(true);
    const client = anthropicClient();
    expect(client).toBeInstanceOf(Anthropic);
    expect(client?.apiKey).toBe("sk-ant-from-env");
    expect(anthropicClient()).toBe(client);
  });

  it.each([
    ["text that isn't JSON", message({}, "Here is the extraction you asked for: …")],
    ["JSON missing required keys", message({}, JSON.stringify({ buyerName: "Maria" }))],
    ["JSON with wrong types", message({}, JSON.stringify({ ...reading(), salePriceCents: "300000" }))],
    ["no text block at all", message({ content: [{ type: "thinking", thinking: "", signature: "sig" }] })],
  ])("turns malformed output (%s) into AI_BAD_OUTPUT", async (_name, reply) => {
    const { client } = fakeClient(() => json(200, reply));
    const outcome = await extractCpcvFromPdf(PDF, { client });
    expect(outcome).toEqual({ ok: false, error: { code: "AI_BAD_OUTPUT", message: expect.stringContaining("fill the form manually") } });
  });

  it("reports a reply cut off at max_tokens as AI_BAD_OUTPUT", async () => {
    const { client } = fakeClient(() => json(200, message({ stop_reason: "max_tokens" }, '{"isCpcv": true, "buyerName": "Ma')));
    const outcome = await extractCpcvFromPdf(PDF, { client });
    expect(outcome.ok ? null : outcome.error).toEqual({ code: "AI_BAD_OUTPUT", message: expect.stringContaining("cut off") });
  });

  it.each([
    [429, "rate_limit_error", "AI_RATE_LIMITED"],
    [401, "authentication_error", "AI_AUTH"],
    [403, "permission_error", "AI_AUTH"],
    [500, "api_error", "AI_UNAVAILABLE"],
    [529, "overloaded_error", "AI_UNAVAILABLE"],
    [402, "billing_error", "AI_UNAVAILABLE"],
  ])("maps HTTP %i (%s) to %s", async (status, type, code) => {
    const { client } = fakeClient(() => apiError(status, type, "nope"));
    const outcome = await extractCpcvFromPdf(PDF, { client });
    expect(outcome.ok ? null : outcome.error.code).toBe(code);
  });

  it("explains a 400 from the API (e.g. an unreadable PDF) with its first line", async () => {
    const { client } = fakeClient(() => apiError(400, "invalid_request_error", "The PDF specified is password protected.\nmore details"));
    const outcome = await extractCpcvFromPdf(PDF, { client });
    expect(outcome.ok ? null : outcome.error).toEqual({ code: "AI_REJECTED", message: expect.stringContaining("(The PDF specified is password protected.)") });
  });

  it("maps network failures and the route's deadline", async () => {
    const { client } = fakeClient(() => {
      throw new TypeError("fetch failed");
    });
    const network = await extractCpcvFromPdf(PDF, { client });
    expect(network.ok ? null : network.error.code).toBe("AI_UNAVAILABLE");

    const { client: slow, calls } = fakeClient(() => json(200, message()));
    const aborted = await extractCpcvFromPdf(PDF, { client: slow, signal: AbortSignal.abort() });
    expect(aborted.ok ? null : aborted.error.code).toBe("AI_TIMEOUT");
    expect(calls).toHaveLength(0);
  });
});

describe("normalizeExtraction (explorador's checks on the reading)", () => {
  const norm = (over: Partial<CpcvReading>) => normalizeExtraction(reading(over), "claude-opus-5-5");

  it("keeps a NIF that fails the check digit but warns next to the field", () => {
    const { fields } = norm({ buyerNif: "123456780" });
    expect(fields.buyerNif).toMatchObject({ value: "123456780", confidence: "high" });
    expect(fields.buyerNif.warnings).toEqual(["Buyer NIF 123456780 fails the Portuguese check digit (mod 11): compare it with the contract."]);
  });

  it("drops a NIF that isn't 9 digits, and flags the same NIF on both sides", () => {
    const short = norm({ sellerNif: "PT 12345" }).fields.sellerNif;
    expect(short).toMatchObject({ value: null, confidence: "low" });
    expect(short.warnings[0]).toMatch(/isn't 9 digits/);

    const same = norm({ buyerNif: "123456789", sellerNif: "123.456.789" }).fields.sellerNif;
    expect(same.value).toBe("123456789");
    expect(same.warnings).toContain("The buyer and the seller have the same NIF in this reading: check both.");
  });

  it("drops prices and dates the form can't take", () => {
    const n = norm({ salePriceCents: 0, cpcvDate: "20/10/2026" });
    expect(n.fields.salePriceCents).toMatchObject({ value: null, confidence: "low" });
    expect(n.fields.salePriceCents.warnings[0]).toMatch(/outside what the form accepts/);
    expect(n.fields.cpcvDate).toMatchObject({ value: null, confidence: "low" });
    expect(n.fields.cpcvDate.warnings[0]).toMatch(/isn't a valid date/);
    // Without a signing date the term can't be computed: the reading's own date stays.
    expect(n.fields.escrituraDate.value).toBe("2027-01-18");
    expect(norm({ salePriceCents: 10_000_000_001 }).fields.salePriceCents.value).toBeNull();
  });

  it("recomputes a deadline in days or months from the signing date", () => {
    const days = norm({ escrituraDate: "2027-01-20" }).fields.escrituraDate;
    expect(days.value).toBe("2027-01-18");
    expect(days.note).toContain("Computed as the signing date + 90 days (the reading said 2027-01-20).");

    const months = norm({ cpcvDate: "2026-08-31", escrituraDate: null, escrituraTerm: { kind: "months_after_signing", amount: 6, quote: null } }).fields.escrituraDate;
    expect(months.value).toBe("2027-02-28"); // clamped to the end of February
    expect(months.note).toContain("Computed as the signing date + 6 months.");

    const fixed = norm({ escrituraDate: "2027-03-31", escrituraTerm: { kind: "fixed_date", amount: null, quote: "até 31 de março de 2027" } }).fields.escrituraDate;
    expect(fixed.value).toBe("2027-03-31");
    expect(fixed.note).toContain("até 31 de março de 2027");
  });

  it("warns about deadlines tied to an event or before the signing date", () => {
    const other = norm({ escrituraDate: null, escrituraTerm: { kind: "other", amount: null, quote: "após aprovação do crédito" } }).fields.escrituraDate;
    expect(other.value).toBeNull();
    expect(other.warnings).toContain("The deed deadline depends on an event without a date: set the escritura date by hand.");

    const before = norm({ escrituraDate: "2026-10-01", escrituraTerm: { kind: "fixed_date", amount: null, quote: null } }).fields.escrituraDate;
    expect(before.warnings).toContain("The deed deadline isn't after the signing date: check both dates.");
  });

  it("keeps a stated commission, warning when it is outside 1–10%", () => {
    expect(norm({ commissionRateBps: 500 }).fields.commissionRateBps).toMatchObject({ value: 500, warnings: [] });
    expect(norm({ commissionRateBps: 1500 }).fields.commissionRateBps.warnings[0]).toMatch(/15% is outside the 1–10%/);
    expect(norm({ commissionRateBps: -3 }).fields.commissionRateBps).toMatchObject({ value: null, confidence: "low" });
  });

  it("normalizes confidences, text and warnings, and flags documents that aren't a CPCV", () => {
    const n = norm({
      isCpcv: false,
      buyerName: "  Maria   Exemplo \n Silva ",
      propertyAddress: "   ",
      fields: { ...reading().fields, buyerName: note("High", "  "), sellerName: note("certain") },
      warnings: ["Page 3 is missing.", "Page 3 is missing.", "  "],
    });
    expect(n.fields.buyerName).toEqual({ value: "Maria Exemplo Silva", confidence: "high", note: null, warnings: [] });
    expect(n.fields.sellerName.confidence).toBe("low");
    expect(n.fields.propertyAddress.value).toBeNull();
    expect(n.warnings).toEqual(["This doesn't look like a signed CPCV: check that you uploaded the right file.", "Page 3 is missing."]);
  });
});
