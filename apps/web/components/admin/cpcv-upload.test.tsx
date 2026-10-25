// The signed-CPCV upload card and the "from the PDF" field marks, rendered to
// HTML, plus the reading → form value mapping and the browser-side prechecks.

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MAX_CPCV_PDF_BYTES } from "@/lib/admin/document-upload";
import type { AdminCpcvDocumentResponse, CpcvExtractedValue, CpcvExtraction } from "@/lib/types/api";

import { CpcvUploadCard, filledCount, pdfHint, PdfFieldMark, precheckPdf, prefillMarks, ViewPdfButton, type CpcvUploadState } from "./cpcv-upload";

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const v = <T,>(value: T | null, over: Partial<CpcvExtractedValue<T>> = {}): CpcvExtractedValue<T> => ({ value, confidence: "high", note: null, warnings: [], ...over });

const extraction: CpcvExtraction = {
  fields: {
    buyerName: v("Maria Exemplo Silva e Rui Teste Costa", { note: "Two buyers; Rui Teste Costa's NIF is 211111112." }),
    buyerNif: v("234567899"),
    sellerName: v("João Fictício Pereira"),
    sellerNif: v("123456780", { warnings: ["Seller NIF 123456780 fails the Portuguese check digit (mod 11): compare it with the contract."] }),
    propertyAddress: v("Rua dos Testes Fictícios 42, 3.º Esq., 1100-999 Lisboa"),
    salePriceCents: v(30_000_050),
    cpcvDate: v("2026-10-20"),
    escrituraDate: v("2027-04-18", { confidence: "medium", note: "Computed as the signing date + 180 days." }),
    commissionRateBps: v<number>(null, { note: "The contract doesn't state the agency's commission." }),
  },
  warnings: ["Page 2 has handwritten initials only."],
  model: "claude-opus-5-5",
};

const response = (over: Partial<AdminCpcvDocumentResponse> = {}): AdminCpcvDocumentResponse => ({
  documentId: "doc_1",
  fileName: "cpcv-exemplo.pdf",
  sizeBytes: 7_738,
  sha256: "ab".repeat(32),
  extraction,
  ...over,
});

const card = (state: CpcvUploadState, aiPrefill: boolean | null = true) =>
  textOf(renderToStaticMarkup(<CpcvUploadCard state={state} aiPrefill={aiPrefill} onFile={() => undefined} onRemove={() => undefined} />));

describe("reading → form values", () => {
  const marks = prefillMarks(extraction);

  it("converts cents, basis points and keeps text, dates and NIFs as typed", () => {
    expect(marks.salePrice.value).toBe("300000.50");
    expect(prefillMarks({ ...extraction, fields: { ...extraction.fields, salePriceCents: v(30_000_000) } }).salePrice.value).toBe("300000");
    expect(prefillMarks({ ...extraction, fields: { ...extraction.fields, commissionRateBps: v(475) } }).ratePct.value).toBe("4.75");
    expect(marks.ratePct).toEqual({ value: null, confidence: "high", note: "The contract doesn't state the agency's commission.", warnings: [] });
    expect(marks.buyerNif.value).toBe("234567899");
    expect(marks.escrituraDate).toMatchObject({ value: "2027-04-18", confidence: "medium" });
    expect(filledCount(marks)).toBe(8);
  });

  it("marks a field from the PDF, edited, or not in the PDF", () => {
    const render = (el: ReactElement) => textOf(renderToStaticMarkup(el));
    expect(render(<PdfFieldMark mark={marks.buyerName} current="Maria Exemplo Silva e Rui Teste Costa" />)).toContain("from the PDF");
    expect(render(<PdfFieldMark mark={marks.escrituraDate} current="2027-04-18" />)).toContain("from the PDF · medium");
    expect(render(<PdfFieldMark mark={marks.buyerName} current="Maria Silva" />)).toContain("edited");
    expect(render(<PdfFieldMark mark={marks.ratePct} current="5" />)).toContain("not in the PDF");
    expect(render(<PdfFieldMark mark={undefined} current="x" />)).toBe("");
  });

  it("shows Claude's note and warnings only while the field holds the PDF's value, without repeating a live NIF warning", () => {
    const sellerWarning = extraction.fields.sellerNif.warnings[0];
    const html = textOf(renderToStaticMarkup(<p>{pdfHint({ mark: marks.sellerNif, current: "123456780", extraWarnings: [sellerWarning] })}</p>));
    expect(html.match(/fails the Portuguese check digit/g)).toHaveLength(1);

    const note = textOf(renderToStaticMarkup(<p>{pdfHint({ mark: marks.buyerName, current: marks.buyerName.value!, base: "Base hint" })}</p>));
    expect(note).toContain("From the PDF: Two buyers; Rui Teste Costa's NIF is 211111112.");
    expect(note).toContain("Base hint");

    expect(pdfHint({ mark: marks.buyerName, current: "Someone else", base: "Base hint" })).toBe("Base hint");
    expect(pdfHint({ current: "", base: "Between 1% and 10%." })).toBe("Between 1% and 10%.");
  });
});

describe("upload card states", () => {
  it("invites a drop when idle, and says whether Claude will read it", () => {
    expect(card({ phase: "idle" })).toContain("Upload the signed CPCV (PDF)");
    expect(card({ phase: "idle" })).toContain("Claude reads the contract and fills in the form below");
    expect(card({ phase: "idle" })).toContain("AI prefill on");
    expect(card({ phase: "idle" }, false)).toContain("AI prefill is off on this server");
    expect(card({ phase: "idle" }, false)).toContain("PDF only, up to 4.0 MB");
  });

  it("shows the upload, then Claude reading", () => {
    expect(card({ phase: "uploading", fileName: "contrato.pdf", progress: 0.42 })).toContain("Uploading contrato.pdf…");
    expect(card({ phase: "reading", fileName: "contrato.pdf" })).toContain("Claude is reading the contract…");
    expect(card({ phase: "reading", fileName: "contrato.pdf" }, false)).toContain("Storing the PDF…");
  });

  it("summarizes what Claude pre-filled, with the document's warnings", () => {
    const text = card({ phase: "done", result: response() });
    expect(text).toContain("cpcv-exemplo.pdf");
    expect(text).toContain("Claude pre-filled 8 of 9 fields; 1 needs a closer look");
    expect(text).toContain("Page 2 has handwritten initials only.");
    expect(text).toContain("Replace PDF");
    expect(text).toContain("Don't attach it");
  });

  it("degrades to manual entry when the AI prefill is unavailable", () => {
    const text = card({
      phase: "done",
      result: response({ extraction: null, extractionError: { code: "AI_NOT_CONFIGURED", message: "AI prefill unavailable: ANTHROPIC_API_KEY is not set on this server." } }),
    });
    expect(text).toContain("AI prefill unavailable — fill the form manually.");
    expect(text).toContain("The PDF is attached and will be stored with the deal.");
    expect(text).toContain("ANTHROPIC_API_KEY is not set");
  });

  it("shows upload errors next to the drop zone", () => {
    expect(card({ phase: "error", message: "Only PDF files are accepted, and this file isn't a PDF" })).toContain("Only PDF files are accepted");
  });

  it("links View PDF to the admin document route in a new tab", () => {
    const html = renderToStaticMarkup(<ViewPdfButton cpcvId="cpcv_1" fileName="cpcv-exemplo.pdf" />);
    expect(html).toContain('href="/api/admin/cpcv/cpcv_1/document"');
    expect(html).toContain('target="_blank"');
    expect(textOf(html)).toContain("View PDF");
  });
});

describe("precheckPdf (before uploading)", () => {
  const pdf = (bytes: Uint8Array, type = "application/pdf") => new File([new Uint8Array(bytes)], "x.pdf", { type });
  const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

  it("accepts a PDF and rejects empty, oversized or non-PDF files", async () => {
    expect(await precheckPdf(pdf(PDF))).toBeNull();
    expect(await precheckPdf(pdf(PDF, ""))).toBeNull();
    expect(await precheckPdf(pdf(new Uint8Array(0)))).toBe("This file is empty.");
    const big = new Uint8Array(MAX_CPCV_PDF_BYTES + 1);
    big.set(PDF);
    expect(await precheckPdf(pdf(big))).toMatch(/the limit is 4.0 MB/);
    expect(await precheckPdf(pdf(new TextEncoder().encode("<html></html>")))).toMatch(/isn't a PDF/);
    expect(await precheckPdf(pdf(PDF, "image/png"))).toMatch(/isn't a PDF/);
  });
});
