// AES-256-GCM encryption for CPCV personal data (§9.1). Layout: iv(12) ‖ tag(16) ‖ ciphertext.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CpcvPii } from "@/lib/api-types";
import { env } from "@/lib/env";

export function encryptPii(pii: CpcvPii, key: Buffer = env.piiKey): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(pii), "utf8"), cipher.final()]);
  const out = Buffer.concat([iv, cipher.getAuthTag(), ct]);
  return new Uint8Array(out);
}

export function decryptPii(blob: Uint8Array, key: Buffer = env.piiKey): CpcvPii {
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as CpcvPii;
}
