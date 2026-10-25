// Isomorphic helpers for OpenZeppelin smart-account authorization (browser + server).
//
// Every signer authenticates the Protocol 27 auth digest
//   auth_digest = sha256(sha256(auth preimage) ‖ scvVec(context_rule_ids).toXDR())
// and contributes bytes to the AuthPayload { context_rule_ids, signers: Map<Signer, Bytes> }.
// Wallets are deployed with a single signer on the Default context rule (id 0).
import { Buffer } from "buffer";
import { Address, hash, StrKey, xdr } from "@stellar/stellar-sdk";
import { computeEntryAuthDigest } from "smart-account-kit";

export const DEFAULT_CONTEXT_RULE_IDS = [0];
/** Signatures stay valid for ~1 hour of ledgers. */
export const SIGNATURE_LIFETIME_LEDGERS = 720;

export interface ExternalSigner {
  verifier: string;
  keyData: Uint8Array;
}

export function signerScVal(s: ExternalSigner): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("External"), new Address(s.verifier).toScVal(), xdr.ScVal.scvBytes(Buffer.from(s.keyData))]);
}

export function authPayloadScVal(contextRuleIds: number[], signer: ExternalSigner, signatureBytes: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context_rule_ids"),
      val: xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signers"),
      val: xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: signerScVal(signer), val: xdr.ScVal.scvBytes(Buffer.from(signatureBytes)) })]),
    }),
  ]);
}

export function addressCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials | null {
  const c = entry.credentials();
  switch (c.switch().name) {
    case "sorobanCredentialsAddress":
      return c.address();
    case "sorobanCredentialsAddressV2":
      return c.addressV2();
    default:
      return null;
  }
}

export function entryAddress(entry: xdr.SorobanAuthorizationEntry): string | null {
  const c = addressCredentials(entry);
  return c ? Address.fromScAddress(c.address()).toString() : null;
}

/** WebAuthnSigData encoded the way the OZ WebAuthn verifier expects (ScMap XDR, keys sorted). */
export function webAuthnSignatureBytes(sig: { authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array }): Uint8Array {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("authenticator_data"), val: xdr.ScVal.scvBytes(Buffer.from(sig.authenticatorData)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("client_data"), val: xdr.ScVal.scvBytes(Buffer.from(sig.clientDataJSON)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(Buffer.from(sig.signature)) }),
  ]).toXDR();
}

const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

/** DER ECDSA signature → 64-byte r ‖ s with low-S normalization (required by secp256r1_verify). */
export function derToCompactLowS(der: Uint8Array): Uint8Array {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad DER signature");
  i++; // total length (short form for P-256)
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("bad DER integer");
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt();
  const sBytes = readInt();
  let s = BigInt("0x" + Buffer.from(sBytes).toString("hex"));
  if (s > P256_N / 2n) s = P256_N - s;
  const sOut = Buffer.from(s.toString(16).padStart(64, "0"), "hex");
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(sOut, 32);
  return out;
}

/**
 * Signs every auth entry that belongs to `smartAccount`, using `sign(authDigest)` to
 * produce the signer's AuthPayload bytes. Other entries pass through untouched.
 */
export async function signSmartAccountEntries(
  entries: xdr.SorobanAuthorizationEntry[],
  smartAccount: string,
  signer: ExternalSigner,
  sign: (authDigest: Buffer) => Promise<Uint8Array> | Uint8Array,
  opts: { networkPassphrase: string; latestLedger: number; contextRuleIds?: number[] },
): Promise<xdr.SorobanAuthorizationEntry[]> {
  const ruleIds = opts.contextRuleIds ?? DEFAULT_CONTEXT_RULE_IDS;
  const out: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of entries) {
    if (entryAddress(entry) !== smartAccount) {
      out.push(entry);
      continue;
    }
    const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
    const expiration = opts.latestLedger + SIGNATURE_LIFETIME_LEDGERS;
    // Writes the expiration into the entry and returns the digest bound to the rule ids.
    const { authDigest } = computeEntryAuthDigest(opts.networkPassphrase, clone, expiration, ruleIds);
    const sigBytes = await sign(authDigest);
    addressCredentials(clone)!.signature(authPayloadScVal(ruleIds, signer, sigBytes));
    out.push(clone);
  }
  return out;
}

/** Contract address a deployer + salt deploy produces. */
export function deployedContractAddress(deployer: string, salt: Buffer, networkPassphrase: string): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({ address: Address.fromString(deployer).toScAddress(), salt }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
