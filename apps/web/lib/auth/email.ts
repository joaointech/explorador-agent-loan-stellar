// 6-digit email codes (§9.2): SHA-256(code, SESSION_SECRET), 10-minute expiry, 5 attempts.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${code}:${email}:${env.sessionSecret}`).digest("hex");
}

export async function startEmailCode(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.emailCode.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: new Date() } });
  await db.emailCode.create({
    data: { email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  if (!env.resendApiKey) {
    console.log(`\n[explorador advance] sign-in code for ${email}: ${code}\n`);
    return;
  }
  const resend = new Resend(env.resendApiKey);
  const { error } = await resend.emails.send({
    from: env.emailFrom,
    to: email,
    subject: `Your explorador advance code: ${code}`,
    text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for it, ignore this email.`,
    html: `<div style="font-family:Sora,Arial,sans-serif;color:#0f172a"><p>Your explorador advance sign-in code:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb">${code}</p><p style="color:#64748b">It expires in 10 minutes. If you didn't ask for it, ignore this email.</p></div>`,
  });
  if (error) {
    console.error("Resend error", error);
    console.log(`\n[explorador advance] sign-in code for ${email}: ${code}\n`);
  }
}

export async function verifyEmailCode(rawEmail: string, code: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const row = await db.emailCode.findFirst({
    where: { email, consumedAt: null },
    orderBy: { expiresAt: "desc" },
  });
  if (!row || row.expiresAt < new Date()) throw new HttpError(400, "CODE_EXPIRED", "The code has expired. Request a new one.");
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many attempts. Request a new code.");
  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(hashCode(email, code.trim()), "hex");
  if (!timingSafeEqual(expected, actual)) {
    await db.emailCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new HttpError(400, "CODE_INVALID", "That code is not right.");
  }
  await db.emailCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
}

export function roleForEmail(email: string): "ADMIN" | "AGENT" {
  return env.adminEmails.includes(normalizeEmail(email)) ? "ADMIN" : "AGENT";
}
