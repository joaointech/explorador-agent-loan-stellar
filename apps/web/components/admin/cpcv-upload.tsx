"use client";

// New CPCV: "Upload the signed CPCV (PDF)". The PDF goes to
// POST /api/admin/cpcv/documents (stored encrypted, then read by Claude when
// the server has an API key); the reading pre-fills the form, and each
// pre-filled field is marked "from the PDF" with Claude's confidence, note and
// explorador's warnings until the admin edits it.

import { CircleCheck, CircleX, FileText, FileUp, LoaderCircle, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatFileSize, hasPdfMagic, isPdfMimeType, MAX_CPCV_PDF_BYTES, UPLOAD_HEADER } from "@/lib/admin/document-upload";
import type { AdminCpcvDocumentResponse, ApiError, CpcvExtraction, ExtractionConfidence } from "@/lib/types/api";

import { AdminApiError, redirectToLogin } from "./api";

export type CpcvUploadState =
  | { phase: "idle" }
  | { phase: "uploading"; fileName: string; progress: number }
  | { phase: "reading"; fileName: string }
  | { phase: "done"; result: AdminCpcvDocumentResponse }
  | { phase: "error"; message: string };

// ---------- upload ----------

/**
 * Sends the PDF with XMLHttpRequest (fetch can't report upload progress), so
 * the card can switch from "Uploading…" to "Claude is reading…" once the
 * bytes are sent. Rejects with AdminApiError; a 401 goes back to sign-in.
 */
export function uploadCpcvPdf(file: File, on: { progress: (fraction: number) => void; sent: () => void }): Promise<AdminCpcvDocumentResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/cpcv/documents");
    xhr.setRequestHeader(UPLOAD_HEADER, "1");
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) on.progress(e.loaded / e.total);
    };
    xhr.upload.onload = () => on.sent();
    xhr.onload = () => {
      if (xhr.status === 401) {
        redirectToLogin();
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // handled below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as AdminCpcvDocumentResponse);
      else {
        const error = (body as Partial<ApiError> | null)?.error;
        reject(new AdminApiError(xhr.status, error?.code ?? `HTTP_${xhr.status}`, error?.message ?? `The upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new AdminApiError(0, "NETWORK_ERROR", "The upload failed: check the connection and try again"));
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

/** Instant checks before uploading (the server repeats them): size, declared type, the %PDF- header. */
export async function precheckPdf(file: File): Promise<string | null> {
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_CPCV_PDF_BYTES) return `This file is ${formatFileSize(file.size)}: the limit is ${formatFileSize(MAX_CPCV_PDF_BYTES)}.`;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (!isPdfMimeType(file.type) || !hasPdfMagic(head)) return "Only PDF files are accepted, and this file isn't a PDF.";
  return null;
}

// ---------- the reading → form values ----------

/** Form inputs Claude can fill (raw values, as the inputs hold them). */
export type PrefillKey = "buyerName" | "buyerNif" | "sellerName" | "sellerNif" | "propertyAddress" | "salePrice" | "ratePct" | "cpcvDate" | "escrituraDate";

export interface PrefillMark {
  /** The input value from the PDF; null when the contract doesn't state it (or it failed a check). */
  value: string | null;
  confidence: ExtractionConfidence;
  note: string | null;
  warnings: string[];
}

/** Cents → the raw euros the sale price input holds ("300000", "300000.50"). */
const centsToInput = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** The reading as raw input values, with Claude's confidence and notes per input. */
export function prefillMarks(extraction: CpcvExtraction): Record<PrefillKey, PrefillMark> {
  const f = extraction.fields;
  const mark = <T,>(field: { value: T | null; confidence: ExtractionConfidence; note: string | null; warnings: string[] }, toInput: (v: T) => string): PrefillMark => ({
    value: field.value === null ? null : toInput(field.value),
    confidence: field.confidence,
    note: field.note,
    warnings: field.warnings,
  });
  const text = (v: string) => v;
  return {
    buyerName: mark(f.buyerName, text),
    buyerNif: mark(f.buyerNif, text),
    sellerName: mark(f.sellerName, text),
    sellerNif: mark(f.sellerNif, text),
    propertyAddress: mark(f.propertyAddress, text),
    salePrice: mark(f.salePriceCents, centsToInput),
    ratePct: mark(f.commissionRateBps, (bps) => String(bps / 100)),
    cpcvDate: mark(f.cpcvDate, text),
    escrituraDate: mark(f.escrituraDate, text),
  };
}

/** How many inputs the reading fills. */
export const filledCount = (marks: Record<PrefillKey, PrefillMark>) => Object.values(marks).filter((m) => m.value !== null).length;

// ---------- field marks ----------

const CONFIDENCE_LABEL: Record<ExtractionConfidence, string> = { high: "high confidence", medium: "medium confidence", low: "low confidence" };

/**
 * Badge after a field label: "from the PDF" (with Claude's confidence) while
 * the input still holds the PDF's value, "edited" after the admin changes it,
 * "not in the PDF" when the contract doesn't state it.
 */
export function PdfFieldMark({ mark, current }: { mark: PrefillMark | undefined; current: string }) {
  if (!mark) return null;
  if (mark.value === null) {
    return (
      <Badge tone="neutral" className="ml-2 align-middle font-medium" title="Claude didn't find this in the PDF">
        not in the PDF
      </Badge>
    );
  }
  if (current !== mark.value) {
    return (
      <Badge tone="neutral" variant="outline" className="ml-2 align-middle font-medium" title={`The PDF reads “${mark.value}”`}>
        edited
      </Badge>
    );
  }
  const tone = mark.warnings.length > 0 || mark.confidence === "low" ? "amber" : mark.confidence === "medium" ? "violet" : "blue";
  return (
    <Badge tone={tone} className="ml-2 align-middle font-medium" icon={<Sparkles aria-hidden />} title={`Read by Claude from the signed PDF (${CONFIDENCE_LABEL[mark.confidence]})`}>
      from the PDF{mark.confidence !== "high" ? ` · ${mark.confidence}` : ""}
    </Badge>
  );
}

/**
 * Hint under a field: Claude's note and the warnings while the value is the
 * PDF's (or missing from it), plus `extra` warnings (e.g. a live NIF check)
 * and the field's usual hint. Inline elements only: Field renders it in a <p>.
 */
export function pdfHint({ mark, current, base, extraWarnings = [] }: { mark?: PrefillMark; current: string; base?: ReactNode; extraWarnings?: (string | null)[] }): ReactNode {
  const showPdf = mark !== undefined && (mark.value === null || mark.value === current);
  const warnings = [...new Set([...(showPdf ? mark.warnings : []), ...extraWarnings.filter((w): w is string => Boolean(w))])];
  const note = showPdf ? mark.note : null;
  if (!note && warnings.length === 0) return base;
  return (
    <>
      {warnings.map((w) => (
        <span key={w} className="flex items-start gap-1 font-medium text-amber-700 dark:text-amber-300">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {w}
        </span>
      ))}
      {note && (
        <span className="block">
          <span className="font-semibold text-heading">From the PDF:</span> {note}
        </span>
      )}
      {base && <span className="block">{base}</span>}
    </>
  );
}

// ---------- "View PDF" ----------

/** URL of the signed PDF linked to a CPCV (decrypted by the admin API; opened in a new tab). */
export const cpcvPdfUrl = (cpcvId: string) => `/api/admin/cpcv/${encodeURIComponent(cpcvId)}/document`;

/** Opens the signed CPCV PDF of a deal in a new tab. */
export function ViewPdfButton({ cpcvId, fileName, className }: { cpcvId: string; fileName: string; className?: string }) {
  return (
    <Button
      href={cpcvPdfUrl(cpcvId)}
      external
      size="sm"
      variant="ghost"
      className={cn("px-3 text-[13px]", className)}
      icon={<FileText aria-hidden className="size-4" />}
      title={`Open ${fileName} (signed CPCV)`}
    >
      View PDF
    </Button>
  );
}

// ---------- the card ----------

function FileChip({ name, detail }: { name: string; detail?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 rounded-xl bg-card-muted px-3 py-2 text-sm ring-1 ring-line">
      <FileText aria-hidden className="size-4 shrink-0 text-primary-text" />
      <span className="min-w-0 truncate font-medium text-heading" title={name}>
        {name}
      </span>
      {detail && <span className="shrink-0 text-xs text-muted tabular-nums">{detail}</span>}
    </span>
  );
}

/** "Upload the signed CPCV (PDF)": drop zone, progress, and what Claude read. */
export function CpcvUploadCard({
  state,
  aiPrefill,
  disabled,
  onFile,
  onRemove,
}: {
  state: CpcvUploadState;
  /** null while unknown (the config request hasn't answered). */
  aiPrefill: boolean | null;
  disabled?: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = state.phase === "uploading" || state.phase === "reading";
  const choose = () => input.current?.click();

  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && !disabled && !busy) onFile(file);
  };

  const result = state.phase === "done" ? state.result : null;
  const marks = result?.extraction ? prefillMarks(result.extraction) : null;
  const fieldWarnings = marks ? Object.values(marks).reduce((n, m) => n + m.warnings.length, 0) : 0;

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-heading sm:text-lg">
          <FileUp aria-hidden className="size-5 text-primary-text" />
          Upload the signed CPCV (PDF)
        </h2>
        {aiPrefill !== null && (
          <Badge tone={aiPrefill ? "blue" : "neutral"} icon={aiPrefill ? <Sparkles aria-hidden /> : undefined}>
            {aiPrefill ? "AI prefill on" : "AI prefill off"}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {aiPrefill === false
          ? "The PDF is stored encrypted with the deal. AI prefill is off on this server: fill the form by hand."
          : "Claude reads the contract and fills in the form below. You review every field before minting; the PDF is stored encrypted with the deal."}
      </p>

      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />

      <div className="mt-4">
        {(state.phase === "idle" || state.phase === "error") && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={cn(
              "flex flex-col items-center gap-3 rounded-card border border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-primary bg-primary-tint" : "border-slate-300 bg-card-muted/60 dark:border-slate-700",
              disabled && "opacity-60",
            )}
          >
            <p className="text-sm text-muted">
              Drop the PDF here, or{" "}
              <button type="button" onClick={choose} disabled={disabled} className="font-semibold text-primary-text underline-offset-4 hover:underline disabled:no-underline">
                choose a file
              </button>
              <span className="block text-xs">PDF only, up to {formatFileSize(MAX_CPCV_PDF_BYTES)}. Optional: you can also fill the form by hand.</span>
            </p>
            {state.phase === "error" && (
              <p role="alert" className="flex items-start gap-1.5 text-left text-sm font-medium text-red-700 dark:text-red-300">
                <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
                {state.message}
              </p>
            )}
          </div>
        )}

        {state.phase === "uploading" && (
          <div aria-live="polite" className="flex flex-col gap-3">
            <FileChip name={state.fileName} />
            <ProgressBar value={Math.round(state.progress * 100)} max={100} size="sm" label={`Uploading ${state.fileName}…`} showValue />
          </div>
        )}

        {state.phase === "reading" && (
          <div aria-live="polite" className="flex flex-col gap-3">
            <FileChip name={state.fileName} />
            <p className="flex items-center gap-2 text-sm font-semibold text-heading">
              <LoaderCircle aria-hidden className="size-4 animate-spin text-primary-text" />
              {aiPrefill === false ? "Storing the PDF…" : "Claude is reading the contract…"}
            </p>
            {aiPrefill !== false && <p className="text-xs text-muted">This usually takes 10 to 40 seconds; the fields it finds replace what the form holds.</p>}
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-3" aria-live="polite">
            <FileChip name={result.fileName} detail={`${formatFileSize(result.sizeBytes)} · SHA-256 ${result.sha256.slice(0, 8)}…`} />
            {marks ? (
              <div className="flex flex-col gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
                <p className="flex items-start gap-2 font-semibold">
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Claude pre-filled {filledCount(marks)} of 9 fields
                    {fieldWarnings > 0 ? `; ${fieldWarnings} need${fieldWarnings === 1 ? "s" : ""} a closer look` : ""}. Check each one against the contract before
                    minting.
                  </span>
                </p>
                <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                  Fields marked “from the PDF” hold Claude&apos;s reading ({result.extraction!.model}); the agent is yours to choose.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-semibold">AI prefill unavailable — fill the form manually.</span> The PDF is attached and will be stored with the deal.
                  {result.extractionError && <span className="mt-1 block text-xs opacity-80">{result.extractionError.message}</span>}
                </span>
              </div>
            )}
            {result.extraction && result.extraction.warnings.length > 0 && (
              <ul className="flex flex-col gap-1.5 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
                {result.extraction.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-1.5">
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {(result || state.phase === "error") && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={choose} disabled={disabled}>
            {result ? "Replace PDF" : "Try another file"}
          </Button>
          {result && (
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={onRemove} disabled={disabled}>
              Don&apos;t attach it
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
