import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: (await import("@/lib/auth/testing/fake-db")).fakeDb,
}));

import { EMAIL_CODE, issueEmailCode, verifyEmailCode } from "@/lib/auth/email-code";
import { fakeDb } from "@/lib/auth/testing/fake-db";
import { hashEmailCode } from "@/lib/crypto";
import { HttpError } from "@/lib/http";

const EMAIL = "ana@example.com";
const T0 = new Date("2027-01-14T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const SEC = 1000;
const MIN = 60 * SEC;

/** Asserts that `promise` rejects with an HttpError of this status and code. */
async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect(err).toMatchObject({ status, code });
  return err as HttpError;
}

/** A 6-digit code that is not `code`. */
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

beforeEach(() => fakeDb.reset());

describe("issueEmailCode", () => {
  it("creates a 6-digit code with a 10-minute expiry and stores only its keyed hash", async () => {
    const issued = await issueEmailCode(EMAIL, { now: T0 });
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.expiresAt).toEqual(at(10 * MIN));

    const [row] = fakeDb.emailCode.rows;
    expect(row).toMatchObject({ email: EMAIL, attempts: 0, consumedAt: null, createdAt: T0 });
    expect(row!.codeHash).toBe(hashEmailCode(EMAIL, issued.code));
    expect(JSON.stringify(row)).not.toContain(`"${issued.code}"`);
  });

  it("enforces a 30 s resend cooldown per email", async () => {
    await issueEmailCode(EMAIL, { now: T0 });
    const err = await expectHttpError(issueEmailCode(EMAIL, { now: at(10 * SEC) }), 429, "RESEND_COOLDOWN");
    expect(err.message).toContain("20 s");
    await expect(issueEmailCode("other@example.com", { now: at(10 * SEC) })).resolves.toBeTruthy();
    await expect(issueEmailCode(EMAIL, { now: at(30 * SEC) })).resolves.toBeTruthy();
  });

  it("caps codes per email per hour", async () => {
    for (let i = 0; i < EMAIL_CODE.maxPerHour; i++) await issueEmailCode(EMAIL, { now: at(i * MIN) });
    await expectHttpError(issueEmailCode(EMAIL, { now: at(30 * MIN) }), 429, "RATE_LIMITED");
    // The oldest code leaves the one-hour window at T0 + 60 min.
    await expect(issueEmailCode(EMAIL, { now: at(60 * MIN + SEC) })).resolves.toBeTruthy();
    // A caller can raise the cap (demo accounts).
    await expect(issueEmailCode(EMAIL, { now: at(62 * MIN), maxPerHour: 30 })).resolves.toBeTruthy();
  });

  it("supersedes the previous live code", async () => {
    const first = await issueEmailCode(EMAIL, { now: T0 });
    const second = await issueEmailCode(EMAIL, { now: at(MIN) });
    await expectHttpError(verifyEmailCode(EMAIL, first.code, { now: at(2 * MIN) }), 400, "INVALID_CODE");
    await expect(verifyEmailCode(EMAIL, second.code, { now: at(2 * MIN) })).resolves.toBeUndefined();
  });

  it("drops codes that expired more than a day ago", async () => {
    await issueEmailCode("old@example.com", { now: T0 });
    await issueEmailCode(EMAIL, { now: at(25 * 60 * MIN) });
    expect(fakeDb.emailCode.rows.map((r) => r.email)).toEqual([EMAIL]);
  });
});

describe("verifyEmailCode", () => {
  it("accepts the right code once (single use)", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    await expect(verifyEmailCode(EMAIL, code, { now: at(MIN) })).resolves.toBeUndefined();
    expect(fakeDb.emailCode.rows[0]).toMatchObject({ consumedAt: at(MIN), attempts: 1 });
    await expectHttpError(verifyEmailCode(EMAIL, code, { now: at(MIN) }), 400, "CODE_NOT_FOUND");
  });

  it("rejects a code after its 10-minute expiry", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    await expectHttpError(verifyEmailCode(EMAIL, code, { now: at(10 * MIN) }), 400, "CODE_EXPIRED");
    await expectHttpError(verifyEmailCode(EMAIL, code, { now: at(11 * MIN) }), 400, "CODE_EXPIRED");
  });

  it("accepts a code just before expiry", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    await expect(verifyEmailCode(EMAIL, code, { now: at(10 * MIN - 1) })).resolves.toBeUndefined();
  });

  it("allows 5 attempts, then locks the code even for the right value", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    for (let left = 4; left >= 1; left--) {
      const err = await expectHttpError(verifyEmailCode(EMAIL, wrong(code), { now: at(MIN) }), 400, "INVALID_CODE");
      expect(err.message).toContain(`${left} attempt`);
    }
    await expectHttpError(verifyEmailCode(EMAIL, wrong(code), { now: at(MIN) }), 429, "TOO_MANY_ATTEMPTS");
    expect(fakeDb.emailCode.rows[0]!.attempts).toBe(EMAIL_CODE.maxAttempts);
    await expectHttpError(verifyEmailCode(EMAIL, code, { now: at(MIN) }), 429, "TOO_MANY_ATTEMPTS");
  });

  it("accepts the right code on the fifth attempt", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    for (let i = 0; i < 4; i++) {
      await expectHttpError(verifyEmailCode(EMAIL, wrong(code), { now: at(MIN) }), 400, "INVALID_CODE");
    }
    await expect(verifyEmailCode(EMAIL, code, { now: at(MIN) })).resolves.toBeUndefined();
  });

  it("does not let parallel guesses exceed the attempt cap", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => verifyEmailCode(EMAIL, wrong(code), { now: at(MIN) })),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(fakeDb.emailCode.rows[0]!.attempts).toBe(EMAIL_CODE.maxAttempts);
  });

  it("only accepts a code for the address it was issued to", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    await expectHttpError(verifyEmailCode("bruno@example.com", code, { now: at(MIN) }), 400, "CODE_NOT_FOUND");
    await issueEmailCode("bruno@example.com", { now: T0 });
    await expectHttpError(verifyEmailCode("bruno@example.com", code, { now: at(MIN) }), 400, "INVALID_CODE");
  });

  it("retires every live code for the email on success (two codes raced into existence)", async () => {
    const { code } = await issueEmailCode(EMAIL, { now: T0 });
    // Simulate a concurrent request whose supersede step didn't see the first code.
    fakeDb.emailCode.rows.unshift({
      id: "racer",
      email: EMAIL,
      codeHash: hashEmailCode(EMAIL, "999999"),
      expiresAt: at(10 * MIN),
      consumedAt: null,
      attempts: 0,
      createdAt: at(-1),
    });
    await expect(verifyEmailCode(EMAIL, code, { now: at(MIN) })).resolves.toBeUndefined();
    expect(fakeDb.emailCode.rows.every((r) => r.consumedAt !== null)).toBe(true);
    await expectHttpError(verifyEmailCode(EMAIL, "999999", { now: at(MIN) }), 400, "CODE_NOT_FOUND");
  });

  it("reports a missing code", async () => {
    await expectHttpError(verifyEmailCode(EMAIL, "123456", { now: T0 }), 400, "CODE_NOT_FOUND");
  });
});
