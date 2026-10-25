// The signed-CPCV upload and download routes without Postgres: the real
// session guard (in-memory database and cookie jar), the cross-site header,
// and every check that runs before the PDF is stored (multipart, PDF magic
// bytes, size). Storage, encryption at rest and the pipeline link are covered
// by cpcv-documents.db.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
  process.env.ANTHROPIC_API_KEY = "";
});

const state = vi.hoisted(() => ({ jar: undefined as import("@/lib/auth/testing/fake-cookies").FakeCookieJar | undefined }));

vi.mock("next/headers", async () => {
  const { createCookieJar } = await import("@/lib/auth/testing/fake-cookies");
  state.jar = createCookieJar();
  return { cookies: async () => state.jar };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: (await import("@/lib/auth/testing/fake-db")).fakeDb,
}));

import { GET as download } from "@/app/api/admin/cpcv/[id]/document/route";
import { GET as config, POST as upload } from "@/app/api/admin/cpcv/documents/route";
import { signIn } from "@/lib/auth/session";
import { fakeDb } from "@/lib/auth/testing/fake-db";

import { formatFileSize, hasPdfMagic, isPdfMimeType, MAX_CPCV_PDF_BYTES, sanitizePdfFileName, UPLOAD_HEADER } from "./document-upload";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

function uploadRequest(file: Blob | string | null, init: { header?: boolean; fileName?: string; headers?: Record<string, string> } = {}) {
  const form = new FormData();
  if (file instanceof Blob) form.append("file", file, init.fileName ?? "contrato.pdf");
  else if (typeof file === "string") form.append("file", file);
  return new Request("http://localhost/api/admin/cpcv/documents", {
    method: "POST",
    headers: { ...(init.header === false ? {} : { [UPLOAD_HEADER]: "1" }), ...init.headers },
    body: form,
  });
}

const pdfFile = (bytes: Uint8Array = PDF_BYTES, type = "application/pdf") => new File([new Uint8Array(bytes)], "contrato.pdf", { type });

const ctx = { params: Promise.resolve({ id: "some-cpcv" }) };

async function signInAs(role: "AGENT" | "ADMIN") {
  const user = (await fakeDb.user.create({ data: { email: `${role.toLowerCase()}@example.com`, role } })) as { id: string; email: string; role: typeof role };
  await signIn(user, { passkeyVerified: true });
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

beforeEach(() => {
  fakeDb.reset();
  state.jar!.clear();
});

describe("signed CPCV routes: admin only", () => {
  const ROUTES: [string, () => Promise<Response>][] = [
    ["POST /api/admin/cpcv/documents", () => upload(uploadRequest(pdfFile()))],
    ["GET /api/admin/cpcv/documents", () => config()],
    ["GET /api/admin/cpcv/[id]/document", () => download(new Request("http://localhost/api/admin/cpcv/some-cpcv/document"), ctx)],
  ];

  it.each(ROUTES)("%s → 401 when signed out", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("UNAUTHORIZED");
  });

  it.each(ROUTES)("%s → 403 for agents", async (_name, call) => {
    await signInAs("AGENT");
    const res = await call();
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toEqual({ code: "FORBIDDEN", message: "This is only available to admins" });
  });

  it("tells the admin whether the AI prefill is on", async () => {
    await signInAs("ADMIN");
    const res = await config();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ aiPrefill: false, maxBytes: MAX_CPCV_PDF_BYTES, model: "claude-opus-5-5" });
  });
});

describe("POST /api/admin/cpcv/documents: checks before anything is stored", () => {
  beforeEach(() => signInAs("ADMIN"));

  it("refuses an upload without the X-Advance-Upload header (another site's form)", async () => {
    const res = await upload(uploadRequest(pdfFile(), { header: false }));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("CROSS_SITE_UPLOAD");
  });

  it("only takes multipart/form-data", async () => {
    const res = await upload(
      new Request("http://localhost/api/admin/cpcv/documents", {
        method: "POST",
        headers: { [UPLOAD_HEADER]: "1", "content-type": "application/pdf" },
        body: PDF_BYTES,
      }),
    );
    expect(res.status).toBe(415);
    expect((await errorOf(res)).code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("needs a file in the `file` field", async () => {
    const missing = await upload(uploadRequest(null));
    expect(missing.status).toBe(400);
    expect((await errorOf(missing)).code).toBe("MISSING_FILE");

    const text = await upload(uploadRequest("not a file"));
    expect((await errorOf(text)).code).toBe("MISSING_FILE");

    const empty = await upload(uploadRequest(pdfFile(new Uint8Array(0))));
    expect(empty.status).toBe(400);
    expect((await errorOf(empty)).code).toBe("EMPTY_FILE");
  });

  it("rejects files that aren't PDFs, whatever their name or declared type", async () => {
    const renamed = await upload(uploadRequest(new File(["<html>not a pdf</html>"], "contrato.pdf", { type: "application/pdf" })));
    expect(renamed.status).toBe(415);
    expect(await errorOf(renamed)).toEqual({ code: "NOT_A_PDF", message: "Only PDF files are accepted, and this file isn't a PDF" });

    const png = await upload(uploadRequest(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], "scan.pdf", { type: "image/png" })));
    expect((await errorOf(png)).code).toBe("NOT_A_PDF");

    // PDF bytes declared as HTML: refused too (served back as application/pdf only when both agree).
    const html = await upload(uploadRequest(pdfFile(PDF_BYTES, "text/html")));
    expect((await errorOf(html)).code).toBe("NOT_A_PDF");
  });

  it("enforces the 4 MB limit on the file and on the whole body", async () => {
    const big = new Uint8Array(MAX_CPCV_PDF_BYTES + 1);
    big.set(PDF_BYTES);
    const tooBig = await upload(uploadRequest(pdfFile(big)));
    expect(tooBig.status).toBe(413);
    expect(await errorOf(tooBig)).toEqual({ code: "FILE_TOO_LARGE", message: "The PDF is too large: the limit is 4.0 MB" });

    const huge = new Uint8Array(MAX_CPCV_PDF_BYTES + 512 * 1024);
    huge.set(PDF_BYTES);
    const body = await upload(uploadRequest(pdfFile(huge)));
    expect(body.status).toBe(413);

    const declared = await upload(uploadRequest(pdfFile(), { headers: { "content-length": String(10 * 1024 * 1024) } }));
    expect(declared.status).toBe(413);
  });
});

describe("upload helpers", () => {
  it("recognises PDFs by their header", () => {
    expect(hasPdfMagic(PDF_BYTES)).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode("%PDF"))).toBe(false);
    expect(hasPdfMagic(new TextEncoder().encode(" %PDF-1.4"))).toBe(false);
    expect(isPdfMimeType("application/pdf")).toBe(true);
    expect(isPdfMimeType("")).toBe(true);
    expect(isPdfMimeType("application/octet-stream")).toBe(true);
    expect(isPdfMimeType("text/html")).toBe(false);
  });

  it("sanitizes file names for storage and Content-Disposition", () => {
    expect(sanitizePdfFileName("CPCV Rua Augusta.pdf")).toBe("CPCV Rua Augusta.pdf");
    expect(sanitizePdfFileName("C:\\Users\\ana\\Contrato \"final\".PDF")).toBe("Contrato final.pdf");
    expect(sanitizePdfFileName("../../etc/passwd")).toBe("passwd.pdf");
    expect(sanitizePdfFileName("line\nbreak\u0000.pdf")).toBe("linebreak.pdf");
    expect(sanitizePdfFileName("")).toBe("cpcv.pdf");
    expect(sanitizePdfFileName(".pdf")).toBe("cpcv.pdf");
    expect(sanitizePdfFileName(`${"a".repeat(300)}.pdf`)).toHaveLength(120);
    expect(sanitizePdfFileName("contrato-promessa-ção.pdf")).toBe("contrato-promessa-ção.pdf");
  });

  it("formats sizes", () => {
    expect(formatFileSize(MAX_CPCV_PDF_BYTES)).toBe("4.0 MB");
    expect(formatFileSize(850 * 1024)).toBe("850 KB");
    expect(formatFileSize(10)).toBe("1 KB");
  });
});
