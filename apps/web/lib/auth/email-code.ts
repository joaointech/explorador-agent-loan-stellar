// Email sign-in codes (spec §9.2): 6 digits, 10-minute expiry, 5 attempts.
//
// Only a keyed hash of each code is stored. A new code supersedes the
// previous live one, so there is at most one usable code per email. Account
// security rests on three limits kept in Postgres (so they hold across
// serverless instances): attempts per code, a resend cooldown, and a cap on
// codes per email per hour. Together they bound guessing to a handful of
// tries per hour against a 1-in-a-million code.

import { formatWait, tooManyRequests } from "@/lib/auth/rate-limit";
import { hashEmailCode, randomDigits, safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/http";

export const EMAIL_CODE = {
  digits: 6,
  ttlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  resendCooldownMs: 30 * 1000,
  maxPerHour: 5,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface IssuedCode {
  id: string;
  code: string;
  expiresAt: Date;
}

/**
 * Creates a new code for a normalized `email`, superseding any live one.
 * Throws a 429 HttpError inside the resend cooldown or over the hourly cap.
 */
export async function issueEmailCode(
  email: string,
  opts: { now?: Date; maxPerHour?: number } = {},
): Promise<IssuedCode> {
  const now = opts.now ?? new Date();
  const maxPerHour = opts.maxPerHour ?? EMAIL_CODE.maxPerHour;

  const recent = await db.emailCode.findMany({
    where: { email, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const latest = recent[0];
  if (latest) {
    const waitMs = latest.createdAt.getTime() + EMAIL_CODE.resendCooldownMs - now.getTime();
    if (waitMs > 0) {
      throw tooManyRequests(
        `Please wait ${formatWait(Math.ceil(waitMs / 1000))} before requesting another code.`,
        "RESEND_COOLDOWN",
      );
    }
  }
  if (recent.length >= maxPerHour) {
    // A slot frees up when the maxPerHour-th most recent code leaves the one-hour window.
    const pivot = recent[maxPerHour - 1]!;
    const waitMs = pivot.createdAt.getTime() + HOUR_MS - now.getTime();
    throw tooManyRequests(
      `Too many codes requested for this email. Try again in ${formatWait(Math.ceil(waitMs / 1000))}.`,
    );
  }

  const code = randomDigits(EMAIL_CODE.digits);
  const expiresAt = new Date(now.getTime() + EMAIL_CODE.ttlMs);
  const [, , created] = await db.$transaction([
    // Housekeeping: drop codes that expired more than a day ago.
    db.emailCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } } }),
    // Supersede the previous live code: only the newest one can be used.
    db.emailCode.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: now } }),
    db.emailCode.create({
      data: { email, codeHash: hashEmailCode(email, code), expiresAt, createdAt: now },
      select: { id: true },
    }),
  ]);
  return { id: created.id, code, expiresAt };
}

/** Deletes a code that couldn't be delivered, so the cooldown doesn't block an immediate retry. */
export async function discardEmailCode(id: string): Promise<void> {
  await db.emailCode.deleteMany({ where: { id } });
}

const tooManyAttempts = () =>
  tooManyRequests("Too many incorrect attempts. Request a new code.", "TOO_MANY_ATTEMPTS");

/**
 * Checks `code` against the live code for a normalized `email` and consumes
 * it. Every check counts as an attempt; throws a 400/429 HttpError with a
 * specific code (CODE_NOT_FOUND, CODE_EXPIRED, INVALID_CODE,
 * TOO_MANY_ATTEMPTS, CODE_USED) on failure.
 */
export async function verifyEmailCode(email: string, code: string, opts: { now?: Date } = {}): Promise<void> {
  const now = opts.now ?? new Date();

  const live = await db.emailCode.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!live) throw badRequest("There's no active code for this email. Request a new one.", "CODE_NOT_FOUND");
  if (live.expiresAt.getTime() <= now.getTime()) {
    throw badRequest("This code has expired. Request a new one.", "CODE_EXPIRED");
  }
  if (live.attempts >= EMAIL_CODE.maxAttempts) throw tooManyAttempts();

  // Count the attempt before comparing, atomically, so parallel guesses can't exceed the cap.
  const reserved = await db.emailCode.updateMany({
    where: { id: live.id, consumedAt: null, attempts: { lt: EMAIL_CODE.maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) throw tooManyAttempts();

  if (!safeEqual(hashEmailCode(email, code), live.codeHash)) {
    const left = EMAIL_CODE.maxAttempts - (live.attempts + 1);
    if (left <= 0) throw tooManyAttempts();
    throw badRequest(`That code isn't right. ${left} ${left === 1 ? "attempt" : "attempts"} left.`, "INVALID_CODE");
  }

  // Single use: only one concurrent verify can flip consumedAt.
  const consumed = await db.emailCode.updateMany({
    where: { id: live.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count === 0) throw badRequest("This code has already been used. Request a new one.", "CODE_USED");

  // Retire any sibling left live by two near-simultaneous requests for a code.
  await db.emailCode.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: now } });
}
