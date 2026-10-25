import Lithic from "lithic";
import { describe, expect, it } from "vitest";

import { HttpError } from "@/lib/http";

import { computeAsaSignature, signAsaPayload, verifyAsaSignature } from "./webhook";

// Standard Webhooks reference vector; its signature is also the example
// `webhook-signature` header in Lithic's ASA reference.
const VECTOR = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

const SECRET = "whsec_" + Buffer.from("explorador-advance-test-secret-32b").toString("base64");
const BODY = JSON.stringify({ token: "8b1e9e4c-2f5a-4c1d-9a51-1f0f6c0d7a10", status: "AUTHORIZATION", amount: 480 });

function expectRejected(fn: () => void, message: RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect((err as HttpError).message).toMatch(message);
    return;
  }
  throw new Error("expected the signature to be rejected");
}

describe("ASA signature verification", () => {
  it("matches the Standard Webhooks reference vector", () => {
    expect(computeAsaSignature(VECTOR.secret, VECTOR.id, VECTOR.timestamp, VECTOR.body)).toBe(VECTOR.signature);
    const headers = {
      "webhook-id": VECTOR.id,
      "webhook-timestamp": String(VECTOR.timestamp),
      "webhook-signature": `v1,${VECTOR.signature}`,
    };
    expect(() => verifyAsaSignature(VECTOR.body, headers, VECTOR.secret, VECTOR.timestamp + 10)).not.toThrow();
  });

  it("accepts a freshly signed request (Headers object, case-insensitive)", () => {
    const signed = signAsaPayload(SECRET, BODY);
    const headers = new Headers({
      "Webhook-Id": signed["webhook-id"],
      "Webhook-Timestamp": signed["webhook-timestamp"],
      "Webhook-Signature": signed["webhook-signature"],
    });
    expect(() => verifyAsaSignature(BODY, headers, SECRET)).not.toThrow();
  });

  it("agrees with the Lithic SDK's own verifier (standardwebhooks)", () => {
    const client = new Lithic({ apiKey: "test-key", environment: "sandbox", baseURL: null });
    const headers = signAsaPayload(SECRET, BODY);
    expect(() => client.webhooks.verifySignature(BODY, headers, SECRET)).not.toThrow();
    const tampered = { ...headers, "webhook-signature": `v1,${computeAsaSignature(SECRET, "other-id", Number(headers["webhook-timestamp"]), BODY)}` };
    expect(() => client.webhooks.verifySignature(BODY, tampered, SECRET)).toThrow();
    expectRejected(() => verifyAsaSignature(BODY, tampered, SECRET), /No matching/);
  });

  it("rejects a tampered body", () => {
    const headers = signAsaPayload(SECRET, BODY);
    expectRejected(() => verifyAsaSignature(BODY.replace("480", "48000"), headers, SECRET), /No matching/);
  });

  it("rejects a signature made with another secret", () => {
    const other = "whsec_" + Buffer.from("some-other-secret").toString("base64");
    expectRejected(() => verifyAsaSignature(BODY, signAsaPayload(other, BODY), SECRET), /No matching/);
  });

  it("rejects stale and future timestamps (5-minute tolerance)", () => {
    const now = 1_800_000_000;
    expectRejected(() => verifyAsaSignature(BODY, signAsaPayload(SECRET, BODY, { timestamp: now - 301 }), SECRET, now), /tolerance/);
    expectRejected(() => verifyAsaSignature(BODY, signAsaPayload(SECRET, BODY, { timestamp: now + 301 }), SECRET, now), /tolerance/);
    expect(() => verifyAsaSignature(BODY, signAsaPayload(SECRET, BODY, { timestamp: now - 299 }), SECRET, now)).not.toThrow();
  });

  it("accepts any matching entry of a rotated signature list and ignores unknown versions", () => {
    const signed = signAsaPayload(SECRET, BODY);
    const old = computeAsaSignature("whsec_" + Buffer.from("retired-secret").toString("base64"), signed["webhook-id"], Number(signed["webhook-timestamp"]), BODY);
    const headers = { ...signed, "webhook-signature": `v2,abc v1,${old} ${signed["webhook-signature"]}` };
    expect(() => verifyAsaSignature(BODY, headers, SECRET)).not.toThrow();
  });

  it("rejects requests without the signature headers", () => {
    expectRejected(() => verifyAsaSignature(BODY, {}, SECRET), /Missing/);
    const { "webhook-signature": _omit, ...partial } = signAsaPayload(SECRET, BODY);
    expectRejected(() => verifyAsaSignature(BODY, partial, SECRET), /Missing/);
  });

  it("accepts a secret without the whsec_ prefix", () => {
    const bare = SECRET.slice("whsec_".length);
    expect(() => verifyAsaSignature(BODY, signAsaPayload(SECRET, BODY), bare)).not.toThrow();
  });
});
