// POST /api/admin/cpcv/documents (admin): upload the signed CPCV, a PDF of at
//      most 4 MB in the multipart field `file` (plus the X-Advance-Upload: 1
//      header). The PDF is stored encrypted first; then, when ANTHROPIC_API_KEY
//      is set, Claude reads it to pre-fill New CPCV (the admin reviews every
//      value). The response carries the document id that POST /api/admin/cpcv
//      links to the deal; `extraction` is null when the AI prefill is off or
//      failed (`extractionError` says why).
// GET  /api/admin/cpcv/documents (admin): whether uploads are read by Claude
//      here, and the size limit.

import { requireAdmin } from "@/lib/auth/session";
import { afterResponse } from "@/lib/admin/background";
import { purgeStaleCpcvDocuments, readUploadedPdf, recordExtraction, storeCpcvDocument } from "@/lib/admin/cpcv-documents";
import { aiPrefillEnabled, CPCV_EXTRACTION_MODEL, extractCpcvFromPdf } from "@/lib/admin/cpcv-extract";
import { MAX_CPCV_PDF_BYTES } from "@/lib/admin/document-upload";
import { requireAdminUpload } from "@/lib/admin/guard";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminCpcvDocumentConfigResponse, AdminCpcvDocumentResponse } from "@/lib/types/api";

// Node: crypto, Buffer and the Anthropic SDK.
export const runtime = "nodejs";
// Claude reads the contract within the request (usually 10–40 s).
export const maxDuration = 60;

/** Budget for reading the PDF, so the response (and its document id) always arrives before maxDuration. */
const READ_BUDGET_MS = 50_000;

export const GET = route(async () => {
  await requireAdmin();
  return jsonResponse<AdminCpcvDocumentConfigResponse>(
    { aiPrefill: aiPrefillEnabled(), maxBytes: MAX_CPCV_PDF_BYTES, model: CPCV_EXTRACTION_MODEL },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const POST = route(async (req: Request) => {
  const admin = await requireAdminUpload(req);
  const deadline = AbortSignal.timeout(READ_BUDGET_MS);
  const pdf = await readUploadedPdf(req);
  const doc = await storeCpcvDocument({ uploadedById: admin.userId, fileName: pdf.fileName, bytes: pdf.bytes });
  afterResponse("purging unused CPCV uploads", () => purgeStaleCpcvDocuments());

  const outcome = await extractCpcvFromPdf(pdf.bytes, { signal: deadline });
  await recordExtraction(doc.id, outcome).catch((err: unknown) =>
    console.warn(`[admin] could not record the reading of CPCV document ${doc.id}: ${err instanceof Error ? err.message : String(err)}`),
  );

  return jsonResponse<AdminCpcvDocumentResponse>(
    {
      documentId: doc.id,
      fileName: pdf.fileName,
      sizeBytes: pdf.bytes.byteLength,
      sha256: doc.sha256,
      extraction: outcome.ok ? outcome.extraction : null,
      ...(outcome.ok ? {} : { extractionError: outcome.error }),
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
});
