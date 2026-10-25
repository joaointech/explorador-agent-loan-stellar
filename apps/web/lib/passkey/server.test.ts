import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/http";

import { buildLoginOptions, buildRegistrationOptions, completeLogin, completeRegistration } from "./server";
import { assertionToJSON, createSoftwarePasskey, softwareAssertion, softwareRegistration } from "./software-authenticator";

interface PasskeyRow {
  id: string;
  userId: string;
  credentialId: string;
  publicKeyCose: Uint8Array;
  publicKeyP256: Uint8Array;
  counter: number;
  transports: string[];
}

const store = vi.hoisted(() => {
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_RP_NAME = "explorador advance";
  process.env.APP_URL = "http://localhost:3106";
  process.env.ADMIN_EMAILS = "boss@explorador.ai";
  return {
    passkeys: [] as PasskeyRow[],
    users: new Map<string, { id: string; email: string; role: "AGENT" | "ADMIN" }>(),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { role: "AGENT" | "ADMIN" } }) => {
        const row = store.users.get(where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    passkey: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) => store.passkeys.filter((p) => p.userId === where.userId)),
      findUnique: vi.fn(async ({ where, include }: { where: { credentialId: string }; include?: { user?: boolean } }) => {
        const row = store.passkeys.find((p) => p.credentialId === where.credentialId);
        if (!row) return null;
        return include?.user ? { ...row, user: store.users.get(row.userId) } : row;
      }),
      create: vi.fn(async ({ data }: { data: Omit<PasskeyRow, "id"> }) => {
        const row = { id: `pk_${store.passkeys.length}`, ...data };
        store.passkeys.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PasskeyRow> }) => {
        const row = store.passkeys.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

const user = { userId: "user_1", email: "agent@explorador.ai" };
const origin = "http://localhost:3106";

async function registered() {
  const passkey = createSoftwarePasskey({ rpId: "localhost", origin });
  const options = await buildRegistrationOptions(user);
  await completeRegistration(user, softwareRegistration(passkey, options.challenge), options.challenge);
  return passkey;
}

async function expectHttpError(promise: Promise<unknown>, status: number, code?: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
}

beforeEach(() => {
  store.passkeys.length = 0;
  store.users.clear();
  store.users.set(user.userId, { id: user.userId, email: user.email, role: "AGENT" });
});

describe("registration", () => {
  it("asks for a discoverable, user-verified ES256 passkey and excludes existing ones", async () => {
    const first = await registered();
    const options = await buildRegistrationOptions(user);
    expect(options.rp).toEqual({ id: "localhost", name: "explorador advance" });
    expect(options.user.name).toBe(user.email);
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7]);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual([first.credentialId]);
  });

  it("stores the credential with the 65-byte P-256 key derived from the COSE key", async () => {
    const passkey = await registered();
    expect(store.passkeys).toHaveLength(1);
    const row = store.passkeys[0]!;
    expect(row.credentialId).toBe(passkey.credentialId);
    expect(row.userId).toBe(user.userId);
    expect(Buffer.from(row.publicKeyP256).equals(Buffer.from(passkey.publicKeyP256))).toBe(true);
    expect(Buffer.from(row.publicKeyCose).equals(Buffer.from(passkey.publicKeyCose))).toBe(true);
    expect(row.transports).toEqual(["internal"]);
  });

  it("rejects a wrong challenge, a wrong origin and a missing user verification", async () => {
    const passkey = createSoftwarePasskey({ rpId: "localhost", origin });
    const options = await buildRegistrationOptions(user);
    await expectHttpError(completeRegistration(user, softwareRegistration(passkey, options.challenge), "other-challenge"), 400, "PASSKEY_INVALID");

    const evil = createSoftwarePasskey({ rpId: "localhost", origin: "https://evil.example" });
    await expectHttpError(completeRegistration(user, softwareRegistration(evil, options.challenge), options.challenge), 400, "PASSKEY_INVALID");

    const noUv = softwareRegistration(passkey, options.challenge, { flags: 0x41 });
    await expectHttpError(completeRegistration(user, noUv, options.challenge), 400, "PASSKEY_INVALID");
    expect(store.passkeys).toHaveLength(0);
  });

  it("refuses to register the same credential twice", async () => {
    const passkey = await registered();
    const options = await buildRegistrationOptions(user);
    await expectHttpError(completeRegistration(user, softwareRegistration(passkey, options.challenge), options.challenge), 409, "PASSKEY_EXISTS");
  });
});

describe("discoverable sign-in", () => {
  it("verifies the assertion, returns the user and updates the counter", async () => {
    const passkey = await registered();
    const options = await buildLoginOptions();
    expect(options.rpId).toBe("localhost");
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials ?? []).toEqual([]);

    const assertion = softwareAssertion(passkey, Buffer.from(options.challenge, "base64url"), { counter: 7 });
    const result = await completeLogin(assertionToJSON(passkey, assertion), options.challenge);
    expect(result).toEqual({ id: user.userId, email: user.email, role: "AGENT" });
    expect(store.passkeys[0]!.counter).toBe(7);
  });

  it("rejects unknown passkeys and forged signatures", async () => {
    const passkey = await registered();
    const options = await buildLoginOptions();
    const challenge = Buffer.from(options.challenge, "base64url");

    const stranger = createSoftwarePasskey({ rpId: "localhost", origin });
    await expectHttpError(completeLogin(assertionToJSON(stranger, softwareAssertion(stranger, challenge)), options.challenge), 401);

    const impostor = { ...createSoftwarePasskey({ rpId: "localhost", origin }), credentialId: passkey.credentialId };
    await expectHttpError(completeLogin(assertionToJSON(impostor, softwareAssertion(impostor, challenge)), options.challenge), 401, "PASSKEY_INVALID");

    await expectHttpError(completeLogin(assertionToJSON(passkey, softwareAssertion(passkey, challenge)), "wrong"), 401, "PASSKEY_INVALID");
  });

  it("re-syncs the role with ADMIN_EMAILS, so a removed admin can't keep signing in as admin", async () => {
    const passkey = await registered();
    const signIn = async () => {
      const options = await buildLoginOptions();
      const assertion = softwareAssertion(passkey, Buffer.from(options.challenge, "base64url"));
      return completeLogin(assertionToJSON(passkey, assertion), options.challenge);
    };

    // Removed from ADMIN_EMAILS since their last email sign-in: demoted.
    store.users.get(user.userId)!.role = "ADMIN";
    expect(await signIn()).toEqual({ id: user.userId, email: user.email, role: "AGENT" });
    expect(store.users.get(user.userId)!.role).toBe("AGENT");

    // Added to ADMIN_EMAILS: promoted.
    store.users.get(user.userId)!.email = "boss@explorador.ai";
    expect(await signIn()).toMatchObject({ role: "ADMIN" });
    expect(store.users.get(user.userId)!.role).toBe("ADMIN");
  });
});
