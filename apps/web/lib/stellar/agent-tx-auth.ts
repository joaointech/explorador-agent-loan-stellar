// Authorization encoding for OpenZeppelin smart accounts (the build deployed by
// smart-account-kit 0.8.0 on testnet, OpenZeppelin/stellar-contracts@1e513890).
// Pure functions over XDR (stellar-sdk 17's immutable XDR classes): no network, no secrets.
//
// How a smart account authorizes a Soroban auth entry:
//   signature_payload = sha256(HashIdPreimage of the entry)   // CAP-71 address-bound for V2 credentials
//   auth_digest       = sha256(signature_payload ‖ XDR(ScVal::Vec<u32>(context_rule_ids)))
// Every External signer signs `auth_digest`; the entry's `signature` is an
// `AuthPayload { context_rule_ids, signers: Map<Signer, Bytes> }`.
//   - WebAuthn signer: key data = 65-byte P-256 key ‖ credential id; signature bytes =
//     XDR of `WebAuthnSigData { authenticator_data, client_data, signature: BytesN<64> }`.
//   - Ed25519 signer: key data = 32-byte public key; signature bytes = the 64-byte signature.

import { Address, StrKey, buildAuthorizationEntryPreimage, hash, xdr } from "@stellar/stellar-sdk";

export type SmartAccountSigner =
  | { kind: "webauthn"; verifier: string; publicKey: Uint8Array; credentialId: Uint8Array }
  | { kind: "ed25519"; verifier: string; publicKey: Uint8Array };

/** The default context rule created by the smart account constructor. */
export const DEFAULT_CONTEXT_RULE_ID = 0;

export class AuthEntryError extends Error {}

const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const sha256 = (data: Uint8Array) => new Uint8Array(hash(data));

// ---------- signers ----------

export function signerKeyData(signer: SmartAccountSigner): Uint8Array {
  if (signer.kind === "webauthn") {
    if (signer.publicKey.length !== 65 || signer.publicKey[0] !== 0x04) {
      throw new AuthEntryError("WebAuthn signer needs a 65-byte uncompressed P-256 key");
    }
    if (signer.credentialId.length === 0) throw new AuthEntryError("WebAuthn signer needs a credential id");
    return concat(signer.publicKey, signer.credentialId);
  }
  if (signer.publicKey.length !== 32) throw new AuthEntryError("Ed25519 signer needs a 32-byte public key");
  return new Uint8Array(signer.publicKey);
}

/** `Signer::External(verifier, key_data)` as an ScVal (contracttype enum → Vec[Symbol, …fields]). */
export function signerToScVal(signer: SmartAccountSigner): xdr.ScVal {
  if (!StrKey.isValidContract(signer.verifier)) throw new AuthEntryError("Verifier must be a C… contract address");
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("External"),
    new Address(signer.verifier).toScVal(),
    xdr.ScVal.scvBytes(signerKeyData(signer)),
  ]);
}

// ---------- auth entries ----------

/** Address credentials of a V1 or V2 (CAP-71) entry. Source-account and delegated entries are rejected. */
export function addressCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials {
  const credentials = entry.credentials;
  switch (credentials.type) {
    case "sorobanCredentialsAddress":
      return credentials.address;
    case "sorobanCredentialsAddressV2":
      return credentials.addressV2;
    default:
      throw new AuthEntryError(`Unsupported authorization credentials: ${credentials.type}`);
  }
}

export function authEntryAddress(entry: xdr.SorobanAuthorizationEntry): string {
  return Address.fromScAddress(addressCredentials(entry).address).toString();
}

/** Returns a copy of `entry` with some address-credential fields replaced (XDR values are immutable). */
export function withCredentials(
  entry: xdr.SorobanAuthorizationEntry,
  patch: { signatureExpirationLedger?: number; signature?: xdr.ScVal },
): xdr.SorobanAuthorizationEntry {
  const current = addressCredentials(entry);
  const next = new xdr.SorobanAddressCredentials({
    address: current.address,
    nonce: current.nonce,
    signatureExpirationLedger: patch.signatureExpirationLedger ?? current.signatureExpirationLedger,
    signature: patch.signature ?? current.signature,
  });
  const credentials =
    entry.credentials.type === "sorobanCredentialsAddressV2"
      ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(next)
      : xdr.SorobanCredentials.sorobanCredentialsAddress(next);
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: entry.rootInvocation });
}

/** Number of invocations in the entry's tree: `__check_auth` receives one context per node. */
export function authContextCount(entry: xdr.SorobanAuthorizationEntry): number {
  const walk = (inv: xdr.SorobanAuthorizedInvocation): number =>
    1 + inv.subInvocations.reduce((n, sub) => n + walk(sub), 0);
  return walk(entry.rootInvocation);
}

/** One rule id per auth context; agent accounts only have the constructor's Default rule. */
export function defaultContextRuleIds(entry: xdr.SorobanAuthorizationEntry): number[] {
  return Array.from({ length: authContextCount(entry) }, () => DEFAULT_CONTEXT_RULE_ID);
}

export function contextRuleIdsXdr(contextRuleIds: number[]): Uint8Array {
  return xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))).toXDR();
}

/** sha256(signature_payload ‖ XDR(Vec<u32>)), the digest smart-account signers sign. */
export function authDigest(signaturePayload: Uint8Array, contextRuleIds: number[]): Uint8Array {
  if (signaturePayload.length !== 32) throw new AuthEntryError("Signature payload must be 32 bytes");
  return sha256(concat(signaturePayload, contextRuleIdsXdr(contextRuleIds)));
}

export interface EntryToSign {
  /** Copy of the entry with `signatureExpirationLedger` set (the signature commits to it). */
  entry: xdr.SorobanAuthorizationEntry;
  signaturePayload: Uint8Array;
  authDigest: Uint8Array;
  contextRuleIds: number[];
}

/** Sets the expiration ledger and computes what the smart account's signers must sign. */
export function prepareEntryForSigning(
  entry: xdr.SorobanAuthorizationEntry,
  expirationLedger: number,
  networkPassphrase: string,
  contextRuleIds: number[] = defaultContextRuleIds(entry),
): EntryToSign {
  if (!Number.isInteger(expirationLedger) || expirationLedger <= 0 || expirationLedger > 0xffffffff) {
    throw new AuthEntryError("Expiration ledger must be a positive u32");
  }
  if (contextRuleIds.length !== authContextCount(entry)) {
    throw new AuthEntryError("contextRuleIds must have one id per auth context");
  }
  const withExpiration = withCredentials(entry, { signatureExpirationLedger: expirationLedger });
  const preimage = buildAuthorizationEntryPreimage(withExpiration, expirationLedger, networkPassphrase);
  const signaturePayload = sha256(preimage.toXDR());
  return {
    entry: withExpiration,
    signaturePayload,
    authDigest: authDigest(signaturePayload, contextRuleIds),
    contextRuleIds,
  };
}

/** Recomputes the digest of an entry that already carries its expiration ledger (used at submit time). */
export function digestOfPreparedEntry(
  entry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
  contextRuleIds: number[] = defaultContextRuleIds(entry),
): EntryToSign {
  const expiration = addressCredentials(entry).signatureExpirationLedger;
  return prepareEntryForSigning(entry, expiration, networkPassphrase, contextRuleIds);
}

// ---------- signatures ----------

/** XDR of `WebAuthnSigData` (map keys in host order: authenticator_data < client_data < signature). */
export function webAuthnSigDataBytes(input: {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}): Uint8Array {
  if (input.signature.length !== 64) throw new AuthEntryError("WebAuthn signature must be 64-byte compact (r ‖ s)");
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("authenticator_data"), val: xdr.ScVal.scvBytes(new Uint8Array(input.authenticatorData)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("client_data"), val: xdr.ScVal.scvBytes(new Uint8Array(input.clientDataJSON)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(new Uint8Array(input.signature)) }),
  ]).toXDR();
}

export interface SignerSignature {
  signer: SmartAccountSigner;
  /** Bytes stored in `AuthPayload.signers` for this signer. */
  bytes: Uint8Array;
}

/** `AuthPayload { context_rule_ids, signers }` as the entry's signature ScVal. */
export function authPayloadScVal(contextRuleIds: number[], signatures: SignerSignature[]): xdr.ScVal {
  if (signatures.length === 0) throw new AuthEntryError("At least one signature is required");
  const entries = signatures
    .map(({ signer, bytes }) => new xdr.ScMapEntry({ key: signerToScVal(signer), val: xdr.ScVal.scvBytes(new Uint8Array(bytes)) }))
    .sort((a, b) => compareScVal(a.key, b.key));
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context_rule_ids"),
      val: xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signers"), val: xdr.ScVal.scvMap(entries) }),
  ]);
}

/** Returns a copy of `entry` whose credentials carry `signature`. */
export function withSignature(entry: xdr.SorobanAuthorizationEntry, signature: xdr.ScVal): xdr.SorobanAuthorizationEntry {
  return withCredentials(entry, { signature });
}

const discriminant = (v: xdr.ScVal) => (v.toXdrObject() as { type: number }).type;

/**
 * Host ordering of ScVals for map keys (the host rejects unsorted maps). Vecs compare element-wise,
 * Bytes/Symbol/String compare by content with shorter-prefix-first (Rust slice Ord), which differs from
 * comparing XDR bytes because XDR length-prefixes variable data.
 */
export function compareScVal(a: xdr.ScVal, b: xdr.ScVal): number {
  const ta = discriminant(a);
  const tb = discriminant(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.type === "scvVec" && b.type === "scvVec") {
    const av = a.vec ?? [];
    const bv = b.vec ?? [];
    for (let i = 0; i < Math.min(av.length, bv.length); i++) {
      const c = compareScVal(av[i]!, bv[i]!);
      if (c !== 0) return c;
    }
    return Math.sign(av.length - bv.length);
  }
  if (a.type === "scvSymbol" && b.type === "scvSymbol") return Buffer.compare(a.sym.bytes, b.sym.bytes);
  if (a.type === "scvString" && b.type === "scvString") return Buffer.compare(a.str.bytes, b.str.bytes);
  if (a.type === "scvBytes" && b.type === "scvBytes") return Buffer.compare(a.bytes.value, b.bytes.value);
  if (a.type === "scvAddress" && b.type === "scvAddress") return Buffer.compare(a.address.toXDR(), b.address.toXDR());
  return Buffer.compare(a.toXDR(), b.toXDR());
}
