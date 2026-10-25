// Limits and checks for the signed-CPCV PDF upload, shared by the New CPCV
// form (instant feedback) and POST /api/admin/cpcv/documents (the real
// checks). Pure: no server imports.

/** 4 MB: Vercel functions accept request bodies up to ~4.5 MB, and the multipart envelope needs some room. */
export const MAX_CPCV_PDF_BYTES = 4 * 1024 * 1024;

/**
 * Header the upload must carry (value "1"). An HTML form on another site can
 * post multipart/form-data, but it can't set a custom header, and a
 * cross-origin fetch that sets one needs a CORS preflight we never grant: the
 * multipart counterpart of the JSON-only rule for admin mutations.
 */
export const UPLOAD_HEADER = "x-advance-upload";

/** Declared MIME types accepted alongside the magic-bytes check (some browsers send no type, or a generic one). */
const PDF_TYPES = new Set(["", "application/pdf", "application/x-pdf", "application/octet-stream"]);

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True when the bytes start with the PDF header `%PDF-` (the real check: a renamed file fails it). */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** True when the browser-declared type is compatible with a PDF (not enough on its own: see hasPdfMagic). */
export const isPdfMimeType = (type: string): boolean => PDF_TYPES.has(type.trim().toLowerCase());

/**
 * The uploaded file's name made safe to store and to echo in
 * Content-Disposition: no path, no control characters or quotes, at most 120
 * characters, always ending in ".pdf".
 */
export function sanitizePdfFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // Control characters (C0, DEL, C1) and characters that break a quoted header value.
  let clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f"<>|]/g, "").replace(/\s+/g, " ").trim();
  clean = clean.replace(/\.pdf$/i, "").replace(/^\.+/, "").trim();
  if (clean === "") clean = "cpcv";
  return `${clean.slice(0, 116)}.pdf`;
}

/** "2.4 MB" / "830 KB" for file sizes. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
