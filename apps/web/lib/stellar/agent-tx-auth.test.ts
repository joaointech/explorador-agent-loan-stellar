import { createHash, randomBytes } from "node:crypto";

import { Address, Keypair, Networks, StrKey, buildAuthorizationEntryPreimage, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  AuthEntryError,
  addressCredentials,
  authContextCount,
  authDigest,
  authEntryAddress,
  authPayloadScVal,
  compareScVal,
  contextRuleIdsXdr,
  defaultContextRuleIds,
  digestOfPreparedEntry,
  prepareEntryForSigning,
  signerToScVal,
  webAuthnSigDataBytes,
  withSignature,
  type SmartAccountSigner,
} from "./agent-tx-auth";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();
const contractId = () => StrKey.encodeContract(randomBytes(32));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const account = contractId();
const pool = contractId();
const verifier = contractId();

function invocation(fn: string, subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(pool).toScAddress(),
        functionName: fn,
        args: [new Address(account).toScVal()],
      }),
    ),
    subInvocations: subs,
  });
}

function entry(opts: { v2?: boolean; subs?: xdr.SorobanAuthorizedInvocation[] } = {}) {
  const creds = new xdr.SorobanAddressCredentials({
    address: new Address(account).toScAddress(),
    nonce: 1234567890123n,
    signatureExpirationLedger: 0,
    signature: xdr.ScVal.scvVoid(),
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: opts.v2 === false
      ? xdr.SorobanCredentials.sorobanCredentialsAddress(creds)
      : xdr.SorobanCredentials.sorobanCredentialsAddressV2(creds),
    rootInvocation: invocation("enable_card", opts.subs),
  });
}

const webauthnSigner: SmartAccountSigner = {
  kind: "webauthn",
  verifier,
  publicKey: new Uint8Array([0x04, ...randomBytes(64)]),
  credentialId: new Uint8Array(randomBytes(20)),
};

describe("auth digest", () => {
  it("binds the context rule ids as XDR of ScVal::Vec<u32>", () => {
    // scvVec (16) · vec present (1) · length 1 · scvU32 (3) · value 0
    expect(hex(contextRuleIdsXdr([0]))).toBe("00000010" + "00000001" + "00000001" + "00000003" + "00000000");
    const payload = new Uint8Array(randomBytes(32));
    const expected = sha256(Buffer.concat([payload, Buffer.from(contextRuleIdsXdr([0, 2]))]));
    expect(hex(authDigest(payload, [0, 2]))).toBe(hex(expected));
    expect(hex(authDigest(payload, [0]))).not.toBe(hex(authDigest(payload, [1])));
  });

  it("requires a 32-byte signature payload", () => {
    expect(() => authDigest(new Uint8Array(31), [0])).toThrow(AuthEntryError);
  });
});

describe("prepareEntryForSigning", () => {
  it("sets the expiration and hashes the CAP-71 address-bound preimage for V2 credentials", () => {
    const prepared = prepareEntryForSigning(entry(), 4242, Networks.TESTNET);
    expect(addressCredentials(prepared.entry).signatureExpirationLedger).toBe(4242);
    expect(prepared.entry.credentials.type).toBe("sorobanCredentialsAddressV2");

    const preimage = buildAuthorizationEntryPreimage(prepared.entry, 4242, Networks.TESTNET);
    expect(preimage.type).toBe("envelopeTypeSorobanAuthorizationWithAddress");
    expect(hex(prepared.signaturePayload)).toBe(hex(sha256(preimage.toXDR())));
    expect(hex(prepared.authDigest)).toBe(hex(authDigest(prepared.signaturePayload, [0])));
  });

  it("uses the legacy preimage for V1 credentials and commits to the expiration and network", () => {
    const a = prepareEntryForSigning(entry({ v2: false }), 100, Networks.TESTNET);
    expect(buildAuthorizationEntryPreimage(a.entry, 100, Networks.TESTNET).type).toBe("envelopeTypeSorobanAuthorization");
    const b = prepareEntryForSigning(entry({ v2: false }), 101, Networks.TESTNET);
    const c = prepareEntryForSigning(entry({ v2: false }), 100, Networks.PUBLIC);
    expect(hex(a.authDigest)).not.toBe(hex(b.authDigest));
    expect(hex(a.authDigest)).not.toBe(hex(c.authDigest));
  });

  it("does not mutate the input entry", () => {
    const original = entry();
    prepareEntryForSigning(original, 99, Networks.TESTNET);
    expect(addressCredentials(original).signatureExpirationLedger).toBe(0);
  });

  it("recomputes the same digest from a prepared entry (submit-time check)", () => {
    const prepared = prepareEntryForSigning(entry(), 777, Networks.TESTNET);
    const again = digestOfPreparedEntry(prepared.entry, Networks.TESTNET);
    expect(hex(again.authDigest)).toBe(hex(prepared.authDigest));
  });

  it("validates expiration and rule ids", () => {
    expect(() => prepareEntryForSigning(entry(), 0, Networks.TESTNET)).toThrow(AuthEntryError);
    expect(() => prepareEntryForSigning(entry(), 2 ** 32, Networks.TESTNET)).toThrow(AuthEntryError);
    expect(() => prepareEntryForSigning(entry(), 10, Networks.TESTNET, [0, 0])).toThrow(AuthEntryError);
  });
});

describe("auth contexts", () => {
  it("counts one context per invocation node", () => {
    expect(authContextCount(entry())).toBe(1);
    const nested = entry({ subs: [invocation("a", [invocation("b")]), invocation("c")] });
    expect(authContextCount(nested)).toBe(4);
    expect(defaultContextRuleIds(nested)).toEqual([0, 0, 0, 0]);
  });

  it("reads the authorizing address and rejects source-account credentials", () => {
    expect(authEntryAddress(entry())).toBe(account);
    const source = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: invocation("enable_card"),
    });
    expect(() => authEntryAddress(source)).toThrow(AuthEntryError);
  });
});

describe("signatures", () => {
  it("encodes Signer::External(verifier, P-256 key ‖ credential id)", () => {
    const scv = signerToScVal(webauthnSigner);
    expect(scv.type).toBe("scvVec");
    const [tag, addr, key] = scv.type === "scvVec" ? scv.vec! : [];
    expect(tag?.type === "scvSymbol" && tag.sym.toString()).toBe("External");
    expect(addr?.type === "scvAddress" && Address.fromScAddress(addr.address).toString()).toBe(verifier);
    expect(key?.type === "scvBytes" && hex(key.bytes.value)).toBe(
      hex(webauthnSigner.publicKey) + hex(webauthnSigner.kind === "webauthn" ? webauthnSigner.credentialId : new Uint8Array()),
    );
  });

  it("validates signer key sizes", () => {
    expect(() => signerToScVal({ ...webauthnSigner, publicKey: new Uint8Array(64) })).toThrow(AuthEntryError);
    expect(() => signerToScVal({ kind: "ed25519", verifier, publicKey: new Uint8Array(31) })).toThrow(AuthEntryError);
    expect(() => signerToScVal({ kind: "ed25519", verifier: Keypair.random().publicKey(), publicKey: new Uint8Array(32) })).toThrow(
      AuthEntryError,
    );
  });

  it("encodes WebAuthnSigData with keys in host order", () => {
    const bytes = webAuthnSigDataBytes({
      authenticatorData: new Uint8Array(37),
      clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get"}'),
      signature: new Uint8Array(64),
    });
    const decoded = xdr.ScVal.fromXDR(bytes);
    expect(decoded.type).toBe("scvMap");
    const keys = decoded.type === "scvMap" ? decoded.map!.map((e) => (e.key.type === "scvSymbol" ? e.key.sym.toString() : "")) : [];
    expect(keys).toEqual(["authenticator_data", "client_data", "signature"]);
    expect(() => webAuthnSigDataBytes({ authenticatorData: new Uint8Array(37), clientDataJSON: new Uint8Array(2), signature: new Uint8Array(70) })).toThrow(
      AuthEntryError,
    );
  });

  it("builds AuthPayload { context_rule_ids, signers } and attaches it without touching nonce or variant", () => {
    const prepared = prepareEntryForSigning(entry(), 500, Networks.TESTNET);
    const payload = authPayloadScVal([0], [{ signer: webauthnSigner, bytes: new Uint8Array([1, 2, 3]) }]);
    const signed = withSignature(prepared.entry, payload);
    const creds = addressCredentials(signed);
    expect(signed.credentials.type).toBe("sorobanCredentialsAddressV2");
    expect(creds.nonce).toBe(1234567890123n);
    expect(creds.signatureExpirationLedger).toBe(500);
    expect(creds.signature.equals(payload)).toBe(true);
    expect(hex(digestOfPreparedEntry(signed, Networks.TESTNET).authDigest)).toBe(hex(prepared.authDigest));

    expect(payload.type).toBe("scvMap");
    const fields = payload.type === "scvMap" ? payload.map!.map((e) => (e.key.type === "scvSymbol" ? e.key.sym.toString() : "")) : [];
    expect(fields).toEqual(["context_rule_ids", "signers"]);
  });

  it("sorts the signers map by key content (host order), not by length-prefixed XDR bytes", () => {
    const publicKey = new Uint8Array([0x04, ...new Uint8Array(64).fill(0xaa)]);
    // Shorter key data but larger content: XDR order would put it first, the host puts it last.
    const shorter: SmartAccountSigner = { kind: "webauthn", verifier, publicKey, credentialId: new Uint8Array([2]) };
    const longer: SmartAccountSigner = { kind: "webauthn", verifier, publicKey, credentialId: new Uint8Array([1, 0]) };
    expect(Buffer.compare(signerToScVal(shorter).toXDR(), signerToScVal(longer).toXDR())).toBeLessThan(0);

    const payload = authPayloadScVal([0], [
      { signer: shorter, bytes: new Uint8Array([1]) },
      { signer: longer, bytes: new Uint8Array([2]) },
    ]);
    const signers = payload.type === "scvMap" ? payload.map![1]!.val : xdr.ScVal.scvVoid();
    const keys = signers.type === "scvMap" ? signers.map!.map((e) => e.key) : [];
    expect(keys[0]!.equals(signerToScVal(longer))).toBe(true);
    expect(keys[1]!.equals(signerToScVal(shorter))).toBe(true);
  });

  it("compareScVal orders bytes by content, then length", () => {
    const a = xdr.ScVal.scvBytes(new Uint8Array([1, 2]));
    const b = xdr.ScVal.scvBytes(new Uint8Array([1, 2, 0]));
    const c = xdr.ScVal.scvBytes(new Uint8Array([2]));
    expect(compareScVal(a, b)).toBeLessThan(0);
    expect(compareScVal(b, c)).toBeLessThan(0);
    expect(compareScVal(c, a)).toBeGreaterThan(0);
    expect(compareScVal(a, xdr.ScVal.scvBytes(new Uint8Array([1, 2])))).toBe(0);
  });
});
