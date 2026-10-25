// Signed CPCV PDFs (CpcvDocument, spec §9.1 addition): reading the multipart
// upload, storing it encrypted, recording Claude's reading, linking it to the
// CPCV the admin submits, serving it back to admins, and purging uploads that
// were never used. The PDF holds personal data: it never goes on-chain and no
// public route reads this table.

import { decryptBytes, encryptBytes, encryptJson, piiKey, sha256Hex } from "@/lib/crypto";
import { db, type Prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/http";

import type { CpcvExtractionOutcome } from "./cpcv-extract";
import { formatFileSize, hasPdfMagic, isPdfMimeType, MAX_CPCV_PDF_BYTES, sanitizePdfFileName } from "./document-upload";

/** Uploads not linked to a CPCV (the admin never submitted) are deleted after this long. */
export const UNLINKED_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Room for the multipart envelope (boundaries, part headers) around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const tooLarge = () => new HttpError(413, "FILE_TOO_LARGE", `The PDF is too large: the limit is ${formatFileSize(MAX_CPCV_PDF_BYTES)}`);

/** The body, refusing (413) to buffer more than `max` bytes whatever Content-Length claims. */
async function readBodyCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface UploadedPdf {
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
}

/**
 * The PDF of a `multipart/form-data` upload (field `file`): a real PDF (the
 * `%PDF-` header, not just the declared type) of at most 4 MB.
 */
export async function readUploadedPdf(req: Request): Promise<UploadedPdf> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType.trim())) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", 'Send the PDF as multipart/form-data, in a field named "file"');
  }
  const body = await readBodyCapped(req, MAX_CPCV_PDF_BYTES + MULTIPART_OVERHEAD_BYTES);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "BAD_MULTIPART", "The upload isn't valid multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "MISSING_FILE", 'Attach the signed CPCV (a PDF) in the "file" field');
  if (file.size === 0) throw new HttpError(400, "EMPTY_FILE", "The file is empty");
  if (file.size > MAX_CPCV_PDF_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfMimeType(file.type) || !hasPdfMagic(bytes)) {
    throw new HttpError(415, "NOT_A_PDF", "Only PDF files are accepted, and this file isn't a PDF");
  }
  return { bytes, fileName: sanitizePdfFileName(file.name) };
}

/** Stores the PDF encrypted (AES-256-GCM, PII_ENCRYPTION_KEY); unlinked until the admin submits the CPCV. */
export async function storeCpcvDocument(input: { uploadedById: string; fileName: string; bytes: Uint8Array }): Promise<{ id: string; sha256: string }> {
  let key: Uint8Array;
  try {
    key = piiKey();
  } catch (err) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", err instanceof Error ? err.message : String(err));
  }
  const sha256 = sha256Hex(input.bytes);
  const row = await db.cpcvDocument.create({
    data: {
      uploadedById: input.uploadedById,
      fileName: input.fileName,
      sizeBytes: input.bytes.byteLength,
      sha256,
      contentEncrypted: encryptBytes(input.bytes, key),
    },
    select: { id: true },
  });
  return { id: row.id, sha256 };
}

/** Keeps Claude's reading with the document (encrypted: it is personal data), or the error code when there is none. */
export async function recordExtraction(documentId: string, outcome: CpcvExtractionOutcome): Promise<void> {
  await db.cpcvDocument.update({
    where: { id: documentId },
    data: outcome.ok ? { extractionEncrypted: encryptJson(outcome.extraction), extractionError: null } : { extractionError: outcome.error.code },
  });
}

/** Deletes uploads older than 24 h that no CPCV uses. Called lazily after each upload. */
export async function purgeStaleCpcvDocuments(now: Date = new Date()): Promise<number> {
  const { count } = await db.cpcvDocument.deleteMany({
    where: { cpcvId: null, createdAt: { lt: new Date(now.getTime() - UNLINKED_UPLOAD_TTL_MS) } },
  });
  return count;
}

const alreadyLinked = (noteId: number | null) =>
  new HttpError(409, "DOCUMENT_ALREADY_LINKED", `This PDF is already attached to another CPCV${noteId !== null ? ` (note #${noteId})` : ""}: upload the signed CPCV of this deal`);

/**
 * Pipeline check for `AdminCpcvInput.documentId`: the upload exists and no
 * other CPCV uses it. One linked to a FAILED CPCV can move to the retry (a
 * FAILED row never changes again). Returns the CPCV it is linked to now, for
 * the compare-and-swap in `linkCpcvDocument`.
 */
export async function checkLinkableDocument(documentId: string): Promise<{ previousCpcvId: string | null }> {
  const doc = await db.cpcvDocument.findUnique({
    where: { id: documentId },
    select: { cpcvId: true, cpcv: { select: { status: true, noteId: true } } },
  });
  if (!doc) throw new HttpError(404, "UNKNOWN_DOCUMENT", "The uploaded PDF wasn't found (unused uploads are deleted after 24 h): upload it again");
  if (doc.cpcvId !== null && doc.cpcv?.status !== "FAILED") throw alreadyLinked(doc.cpcv?.noteId ?? null);
  return { previousCpcvId: doc.cpcvId };
}

/** Links the document to the new CPCV (inside the pipeline's transaction); 409 if another CPCV took it meanwhile. */
export async function linkCpcvDocument(tx: Prisma.TransactionClient, documentId: string, previousCpcvId: string | null, cpcvId: string): Promise<void> {
  const { count } = await tx.cpcvDocument.updateMany({ where: { id: documentId, cpcvId: previousCpcvId }, data: { cpcvId } });
  if (count !== 1) throw alreadyLinked(null);
}

/** The decrypted PDF linked to a CPCV, integrity-checked against its SHA-256. */
export async function readLinkedCpcvPdf(cpcvId: string): Promise<{ fileName: string; bytes: Uint8Array<ArrayBuffer> }> {
  const doc = await db.cpcvDocument.findUnique({ where: { cpcvId }, select: { fileName: true, sha256: true, contentEncrypted: true } });
  if (!doc) throw notFound("This CPCV has no signed PDF");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decryptBytes(doc.contentEncrypted);
  } catch {
    throw new HttpError(500, "DOCUMENT_UNREADABLE", "The signed PDF can't be decrypted with this server's PII_ENCRYPTION_KEY");
  }
  if (sha256Hex(bytes) !== doc.sha256) throw new HttpError(500, "DOCUMENT_CORRUPTED", "The signed PDF doesn't match its recorded SHA-256");
  return { fileName: doc.fileName, bytes };
}

/** RFC 5987 value for `filename*` (encodeURIComponent leaves ' ( ) * as they are). */
const rfc5987 = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The PDF, shown inline by the browser; never cached (personal data). */
export function pdfResponse(fileName: string, bytes: Uint8Array<ArrayBuffer>): Response {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${rfc5987(fileName)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
