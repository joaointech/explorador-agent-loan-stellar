import { randomBytes } from "node:crypto";

import { Address, Keypair, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/http";
import { derToCompactLowS } from "@/lib/passkey/signature";
import { assertionToJSON, createSoftwarePasskey, softwareAssertion } from "@/lib/passkey/software-authenticator";
import type { AgentTxSubmitRequest } from "@/lib/types/api";

import { addressCredentials, digestOfPreparedEntry, signerToScVal, withCredentials } from "./agent-tx-auth";

const mocks = vi.hoisted(() => ({
  agent: null as unknown,
  deployment: { advancePool: "" } as { advancePool: string } | null,
  latestLedger: 1000,
  nonce: 1n,
  authAddress: null as string | null,
  authKind: "address" as "address" | "source",
}));

vi.mock("@/lib/db", () => ({
  db: {
    agent: {
      findUnique: vi.fn(async () => mocks.agent),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

vi.mock("@/lib/stellar/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar/contracts")>()),
  getDeployment: vi.fn(async () => mocks.deployment),
}));

vi.mock("@/lib/stellar/agent-tx-sponsor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stellar/agent-tx-sponsor")>();
  const { Address: A, xdr: X } = await import("@stellar/stellar-sdk");
  return {
    ...actual,
    // Simulation in record mode: one auth entry for the agent account (fresh nonce each time, like the RPC).
    recordAuth: vi.fn(async (func: xdr.HostFunction) => {
      if (func.type !== "hostFunctionTypeInvokeContract") throw new Error("unexpected host function");
      const rootInvocation = new X.SorobanAuthorizedInvocation({
        function: X.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(func.invokeContract),
        subInvocations: [],
      });
      const credentials =
        mocks.authKind === "source"
          ? X.SorobanCredentials.sorobanCredentialsSourceAccount()
          : X.SorobanCredentials.sorobanCredentialsAddressV2(
              new X.SorobanAddressCredentials({
                address: new A(mocks.authAddress!).toScAddress(),
                nonce: mocks.nonce++,
                signatureExpirationLedger: 0,
                signature: X.ScVal.scvVoid(),
              }),
            );
      return { auth: [new X.SorobanAuthorizationEntry({ credentials, rootInvocation })], latestLedger: mocks.latestLedger, retval: undefined };
    }),
    submitSponsored: vi.fn(async () => ({ txHash: "ab".repeat(32), ledger: mocks.latestLedger + 2, returnValue: undefined })),
  };
});

const { db } = await import("@/lib/db");
const sponsorLib = await import("./agent-tx-sponsor");
const { prepareAgentTx, submitAgentTx, agentTxActionSchema, agentTxSubmitSchema } = await import("./agent-tx");
const { demoSignerKeypair, passkeySigner, predictDemoSmartAccount, predictPasskeySmartAccount, demoSigner, SIGNATURE_TTL_LEDGERS } =
  await import("./smart-account");

const origin = "http://localhost:3106";
const passkey = createSoftwarePasskey({ rpId: "localhost", origin });
const demoLabel = "ana@demo.explorador.pt";
const pool = StrKey.encodeContract(randomBytes(32));
let smartAccount = "";
let demoAccount = "";

const agentUser: SessionUser = { userId: "u_agent", email: "agent@explorador.ai", role: "AGENT", passkeyVerified: true };
const demoUser: SessionUser = { userId: "u_demo", email: demoLabel, role: "AGENT", passkeyVerified: false };

function passkeyAgent() {
  return {
    userId: agentUser.userId,
    smartAccount,
    signerKind: "passkey",
    user: {
      email: agentUser.email,
      passkeys: [{ credentialId: passkey.credentialId, publicKeyP256: passkey.publicKeyP256, transports: ["internal"] }],
    },
  };
}

function demoAgent() {
  return { userId: demoUser.userId, smartAccount: demoAccount, signerKind: "demo-ed25519", user: { email: demoLabel, passkeys: [] } };
}

beforeAll(() => {
  process.env.SPONSOR_SECRET = Keypair.random().secret();
  process.env.DEMO_SIGNER_SEED = randomBytes(32).toString("hex");
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.APP_URL = origin;
  smartAccount = predictPasskeySmartAccount(passkey.credentialId);
  demoAccount = predictDemoSmartAccount(demoLabel);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agent = passkeyAgent();
  mocks.deployment = { advancePool: pool };
  mocks.authAddress = smartAccount;
  mocks.authKind = "address";
});

async function httpError(promise: Promise<unknown>): Promise<HttpError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

async function signedSubmit(body: Partial<AgentTxSubmitRequest> & AgentTxSubmitRequest, opts: Parameters<typeof softwareAssertion>[2] = {}) {
  const prep = await prepareAgentTx(agentUser, body.action === "withdraw_balance" ? { action: body.action, amount: body.amount, to: body.to } : { action: body.action });
  const assertion = softwareAssertion(passkey, Buffer.from(prep.challenges[0]!, "base64url"), opts);
  return { prep, body: { ...body, authEntries: prep.authEntries, assertions: [assertionToJSON(passkey, assertion)] } as AgentTxSubmitRequest };
}

function mapField(scv: xdr.ScVal, key: string): xdr.ScVal {
  if (scv.type !== "scvMap") throw new Error("not a map");
  const entry = scv.map!.find((e) => e.key.type === "scvSymbol" && e.key.sym.toString() === key);
  if (!entry) throw new Error(`missing ${key}`);
  return entry.val;
}

describe("prepare", () => {
  it("returns the auth entry and the digest the passkey must sign", async () => {
    const prep = await prepareAgentTx(agentUser, { action: "enable_card" });
    expect(prep.signerKind).toBe("passkey");
    expect(prep.smartAccount).toBe(smartAccount);
    expect(prep.rpId).toBe("localhost");
    expect(prep.expirationLedger).toBe(1000 + SIGNATURE_TTL_LEDGERS);
    expect(prep.allowCredentials).toEqual([{ id: passkey.credentialId, transports: ["internal"] }]);
    expect(prep.authEntries).toHaveLength(1);

    const entry = xdr.SorobanAuthorizationEntry.fromXDR(prep.authEntries[0]!, "base64");
    expect(addressCredentials(entry).signatureExpirationLedger).toBe(prep.expirationLedger);
    const digest = digestOfPreparedEntry(entry, sponsorLib.networkPassphrase());
    expect(prep.challenges).toEqual([Buffer.from(digest.authDigest).toString("base64url")]);

    const [func] = vi.mocked(sponsorLib.recordAuth).mock.calls[0]!;
    expect(func.type).toBe("hostFunctionTypeInvokeContract");
    if (func.type === "hostFunctionTypeInvokeContract") {
      expect(Address.fromScAddress(func.invokeContract.contractAddress).toString()).toBe(pool);
      expect(func.invokeContract.functionName.toString()).toBe("enable_card");
      expect(func.invokeContract.args.map((a) => scValToNative(a))).toEqual([smartAccount]);
    }
  });

  it("builds withdraw_balance(agent, amount, to) with the smart account as default recipient", async () => {
    await prepareAgentTx(agentUser, { action: "withdraw_balance", amount: "12500000" });
    const [func] = vi.mocked(sponsorLib.recordAuth).mock.calls[0]!;
    if (func.type !== "hostFunctionTypeInvokeContract") throw new Error("expected invokeContract");
    expect(func.invokeContract.functionName.toString()).toBe("withdraw_balance");
    expect(func.invokeContract.args.map((a) => scValToNative(a))).toEqual([smartAccount, 12_500_000n, smartAccount]);
  });

  it("tells demo-signer agents to submit directly", async () => {
    mocks.agent = demoAgent();
    const prep = await prepareAgentTx(demoUser, { action: "enable_card" });
    expect(prep).toMatchObject({ signerKind: "demo-ed25519", authEntries: [], challenges: [], expirationLedger: null });
    expect(sponsorLib.recordAuth).not.toHaveBeenCalled();
  });

  it("requires onboarding and a deployed pool", async () => {
    mocks.agent = null;
    expect((await httpError(prepareAgentTx(agentUser, { action: "enable_card" }))).code).toBe("NO_SMART_ACCOUNT");
    mocks.agent = passkeyAgent();
    mocks.deployment = null;
    const err = await httpError(prepareAgentTx(agentUser, { action: "enable_card" }));
    expect([err.status, err.code]).toEqual([503, "NOT_DEPLOYED"]);
  });

  it("refuses calls that need anyone else's authorization", async () => {
    mocks.authAddress = StrKey.encodeContract(randomBytes(32));
    expect((await httpError(prepareAgentTx(agentUser, { action: "enable_card" }))).code).toBe("UNEXPECTED_AUTH");
    mocks.authKind = "source"; // would make the sponsor authorize part of the call
    expect((await httpError(prepareAgentTx(agentUser, { action: "enable_card" }))).code).toBe("UNEXPECTED_AUTH");
  });
});

describe("submit (passkey)", () => {
  it("attaches the WebAuthn signature as AuthPayload, submits, and records the card state", async () => {
    const { prep, body } = await signedSubmit({ action: "enable_card" });
    const res = await submitAgentTx(agentUser, body);

    expect(res).toMatchObject({ txHash: "ab".repeat(32), action: "enable_card", cardEnabledOnChain: true, ledger: 1002 });
    expect(res.explorerUrl).toBe(`https://stellar.expert/explorer/testnet/tx/${"ab".repeat(32)}`);
    expect(db.agent.updateMany).toHaveBeenCalledWith({ where: { smartAccount }, data: { cardEnabledOnChain: true } });

    const [, signed, opts] = vi.mocked(sponsorLib.submitSponsored).mock.calls[0]!;
    expect(opts).toEqual({ advanceCodes: true });
    expect(signed).toHaveLength(1);
    const creds = addressCredentials(signed[0]!);
    const sent = xdr.SorobanAuthorizationEntry.fromXDR(prep.authEntries[0]!, "base64");
    expect(creds.nonce).toBe(addressCredentials(sent).nonce); // the signed nonce, not a fresh one
    expect(creds.signatureExpirationLedger).toBe(prep.expirationLedger);

    expect(mapField(creds.signature, "context_rule_ids").equals(xdr.ScVal.scvVec([xdr.ScVal.scvU32(0)]))).toBe(true);
    const signers = mapField(creds.signature, "signers");
    if (signers.type !== "scvMap") throw new Error("signers is not a map");
    expect(signers.map).toHaveLength(1);
    const signerKey = passkeySigner({ credentialId: passkey.credentialId, publicKeyP256: passkey.publicKeyP256 });
    expect(signers.map![0]!.key.equals(signerToScVal(signerKey))).toBe(true);
    const sigBytes = signers.map![0]!.val;
    if (sigBytes.type !== "scvBytes") throw new Error("signature is not bytes");
    const sigData = xdr.ScVal.fromXDR(sigBytes.bytes.value);
    const compact = mapField(sigData, "signature");
    expect(compact.type === "scvBytes" && compact.bytes.value.length).toBe(64);
  });

  it("records disable_card and leaves the flag alone for withdraw_balance", async () => {
    await submitAgentTx(agentUser, (await signedSubmit({ action: "disable_card" })).body);
    expect(db.agent.updateMany).toHaveBeenLastCalledWith({ where: { smartAccount }, data: { cardEnabledOnChain: false } });
    vi.mocked(db.agent.updateMany).mockClear();
    const res = await submitAgentTx(agentUser, (await signedSubmit({ action: "withdraw_balance", amount: "100" })).body);
    expect(res.cardEnabledOnChain).toBeNull();
    expect(db.agent.updateMany).not.toHaveBeenCalled();
  });

  it("rejects assertions that don't sign this exact transaction", async () => {
    const cases: [string, Parameters<typeof softwareAssertion>[2]][] = [
      ["wrong origin", { origin: "https://evil.example" }],
      ["no user verification", { flags: 0x01 }],
      ["registration type", { type: "webauthn.create" }],
    ];
    for (const [label, opts] of cases) {
      const { body } = await signedSubmit({ action: "enable_card" }, opts);
      const err = await httpError(submitAgentTx(agentUser, body));
      expect(err.code, label).toBe("BAD_SIGNATURE");
    }

    const { prep } = await signedSubmit({ action: "enable_card" });
    const otherChallenge = softwareAssertion(passkey, randomBytes(32));
    const wrongDigest: AgentTxSubmitRequest = { action: "enable_card", authEntries: prep.authEntries, assertions: [assertionToJSON(passkey, otherChallenge)] };
    expect((await httpError(submitAgentTx(agentUser, wrongDigest))).code).toBe("BAD_SIGNATURE");

    const impostor = { ...createSoftwarePasskey({ rpId: "localhost", origin }), credentialId: passkey.credentialId };
    const forged = softwareAssertion(impostor, Buffer.from(prep.challenges[0]!, "base64url"));
    const forgedBody: AgentTxSubmitRequest = { action: "enable_card", authEntries: prep.authEntries, assertions: [assertionToJSON(impostor, forged)] };
    expect((await httpError(submitAgentTx(agentUser, forgedBody))).code).toBe("BAD_SIGNATURE");
    expect(sponsorLib.submitSponsored).not.toHaveBeenCalled();
  });

  it("rejects entries that don't match the action, the account or the time window", async () => {
    const { body } = await signedSubmit({ action: "disable_card" });
    expect((await httpError(submitAgentTx(agentUser, { ...body, action: "enable_card" }))).code).toBe("STALE_TX");

    const entry = xdr.SorobanAuthorizationEntry.fromXDR(body.authEntries![0]!, "base64");
    const expired = withCredentials(entry, { signatureExpirationLedger: 1000 }).toXdr("base64");
    expect((await httpError(submitAgentTx(agentUser, { ...body, authEntries: [expired] }))).code).toBe("EXPIRED");
    const tooLong = withCredentials(entry, { signatureExpirationLedger: 1000 + SIGNATURE_TTL_LEDGERS + 500 }).toXdr("base64");
    expect((await httpError(submitAgentTx(agentUser, { ...body, authEntries: [tooLong] }))).code).toBe("BAD_AUTH_ENTRY");

    const otherAccount = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        new xdr.SorobanAddressCredentials({
          address: new Address(StrKey.encodeContract(randomBytes(32))).toScAddress(),
          nonce: 5n,
          signatureExpirationLedger: 1200,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: entry.rootInvocation,
    });
    const err = await httpError(submitAgentTx(agentUser, { ...body, authEntries: [otherAccount.toXdr("base64")] }));
    expect(err.status).toBe(403);
    expect(sponsorLib.submitSponsored).not.toHaveBeenCalled();
  });

  it("validates the request shape and passkey ownership", async () => {
    const { body } = await signedSubmit({ action: "enable_card" });
    expect((await httpError(submitAgentTx(agentUser, { action: "enable_card" }))).code).toBe("MISSING_SIGNATURE");
    expect((await httpError(submitAgentTx(agentUser, { ...body, assertions: [] }))).code).toBe("MISSING_SIGNATURE");
    expect((await httpError(submitAgentTx(agentUser, { ...body, authEntries: ["AAAA"] }))).code).toBe("BAD_AUTH_ENTRY");
    const foreign = { ...body.assertions![0]!, id: createSoftwarePasskey().credentialId };
    expect((await httpError(submitAgentTx(agentUser, { ...body, assertions: [foreign] }))).status).toBe(403);
  });
});

describe("submit (demo signer)", () => {
  it("signs with the server-held Ed25519 key derived from the agent's email", async () => {
    mocks.agent = demoAgent();
    mocks.authAddress = demoAccount;
    const res = await submitAgentTx(demoUser, { action: "enable_card" });
    expect(res.cardEnabledOnChain).toBe(true);

    const [, signed] = vi.mocked(sponsorLib.submitSponsored).mock.calls[0]!;
    const creds = addressCredentials(signed[0]!);
    const signers = mapField(creds.signature, "signers");
    if (signers.type !== "scvMap") throw new Error("signers is not a map");
    expect(signers.map![0]!.key.equals(signerToScVal(demoSigner(demoLabel)))).toBe(true);
    const sig = signers.map![0]!.val;
    if (sig.type !== "scvBytes") throw new Error("signature is not bytes");
    const digest = digestOfPreparedEntry(signed[0]!, sponsorLib.networkPassphrase()).authDigest;
    expect(demoSignerKeypair(demoLabel).verify(Buffer.from(digest), Buffer.from(sig.bytes.value))).toBe(true);
  });

  it("refuses when the account was not derived from the agent's email", async () => {
    mocks.agent = { ...demoAgent(), smartAccount: StrKey.encodeContract(randomBytes(32)) };
    expect((await httpError(submitAgentTx(demoUser, { action: "enable_card" }))).code).toBe("DEMO_SIGNER_MISMATCH");
  });
});

describe("request schemas", () => {
  it("accepts the three actions and validates amounts and recipients", () => {
    const ok = [
      { action: "enable_card" },
      { action: "disable_card" },
      { action: "withdraw_balance", amount: "1" },
      { action: "withdraw_balance", amount: "170141183460469231731687303715884105727", to: Keypair.random().publicKey() },
      { action: "withdraw_balance", amount: "5", to: StrKey.encodeContract(randomBytes(32)) },
    ];
    for (const body of ok) expect(agentTxActionSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    const bad = [
      { action: "transfer" },
      { action: "withdraw_balance" },
      { action: "withdraw_balance", amount: "0" },
      { action: "withdraw_balance", amount: "-1" },
      { action: "withdraw_balance", amount: "1.5" },
      { action: "withdraw_balance", amount: 10 },
      { action: "withdraw_balance", amount: "170141183460469231731687303715884105728" },
      { action: "withdraw_balance", amount: "5", to: "not-an-address" },
    ];
    for (const body of bad) expect(agentTxActionSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });

  it("parses submit bodies and caps the number of entries", () => {
    const assertion = { id: "abc", response: { authenticatorData: "AA", clientDataJSON: "AA", signature: "AA" } };
    const parsed = agentTxSubmitSchema.parse({ action: "enable_card", authEntries: ["AAAA"], assertions: [assertion] });
    expect(parsed).toMatchObject({ action: "enable_card", authEntries: ["AAAA"] });
    expect(agentTxSubmitSchema.safeParse({ action: "enable_card", authEntries: Array(5).fill("AAAA") }).success).toBe(false);
    expect(agentTxSubmitSchema.safeParse({ action: "enable_card", assertions: [{ id: "a b", response: assertion.response }] }).success).toBe(false);
  });
});

describe("signature conversion sanity", () => {
  it("produces 64-byte low-S signatures from the software authenticator", () => {
    const a = softwareAssertion(passkey, randomBytes(32));
    expect(derToCompactLowS(a.signature)).toHaveLength(64);
  });
});
