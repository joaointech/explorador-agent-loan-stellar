// A software WebAuthn authenticator for tests and the testnet smoke script: a
// P-256 key generated in Node that produces the same assertion structure a
// browser passkey does (authenticatorData, clientDataJSON, DER signature).
// Never used by the app at runtime.

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

import { isoCBOR } from "@simplewebauthn/server/helpers";

export interface SoftwarePasskey {
  /** base64url credential id */
  credentialId: string;
  /** 65-byte uncompressed P-256 public key */
  publicKeyP256: Uint8Array;
  /** CBOR COSE_Key (what an attestation carries) */
  publicKeyCose: Uint8Array;
  privateKey: KeyObject;
  rpId: string;
  origin: string;
}

export interface SoftwareAssertion {
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
  /** ASN.1 DER ECDSA signature, as authenticators return it */
  signature: Buffer;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

export function createSoftwarePasskey(opts: { rpId?: string; origin?: string } = {}): SoftwarePasskey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  const publicKeyCose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, new Uint8Array(x)],
      [-3, new Uint8Array(y)],
    ]),
  );
  return {
    credentialId: randomBytes(16).toString("base64url"),
    publicKeyP256: new Uint8Array(Buffer.concat([Buffer.from([0x04]), x, y])),
    publicKeyCose: new Uint8Array(publicKeyCose),
    privateKey,
    rpId: opts.rpId ?? "localhost",
    origin: opts.origin ?? "http://localhost:3000",
  };
}

/** Signs `challenge` like `navigator.credentials.get` would (flags UP, UV, BE, BS by default). */
export function softwareAssertion(
  passkey: SoftwarePasskey,
  challenge: Uint8Array,
  opts: { flags?: number; counter?: number; type?: string; origin?: string } = {},
): SoftwareAssertion {
  const flags = opts.flags ?? 0x1d;
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter ?? 0);
  const authenticatorData = Buffer.concat([sha256(Buffer.from(passkey.rpId)), Buffer.from([flags]), counter]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: opts.type ?? "webauthn.get",
      challenge: Buffer.from(challenge).toString("base64url"),
      origin: opts.origin ?? passkey.origin,
      crossOrigin: false,
    }),
  );
  const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), {
    key: passkey.privateKey,
    dsaEncoding: "der",
  });
  return { authenticatorData, clientDataJSON, signature };
}

/**
 * A `navigator.credentials.create` response with "none" attestation, in the `@simplewebauthn/browser`
 * RegistrationResponseJSON shape. `challenge` is the base64url string from the registration options.
 */
export function softwareRegistration(passkey: SoftwarePasskey, challenge: string, opts: { flags?: number } = {}) {
  const credentialId = Buffer.from(passkey.credentialId, "base64url");
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    sha256(Buffer.from(passkey.rpId)),
    Buffer.from([opts.flags ?? 0x45]), // UP | UV | AT (attested credential data)
    Buffer.alloc(4), // sign count
    Buffer.alloc(16), // AAGUID
    idLength,
    credentialId,
    Buffer.from(passkey.publicKeyCose),
  ]);
  const attestationObject = isoCBOR.encode(
    new Map<string, string | Map<string, string> | Uint8Array>([
      ["fmt", "none"],
      ["attStmt", new Map<string, string>()],
      ["authData", new Uint8Array(authData)],
    ]),
  );
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge, origin: passkey.origin, crossOrigin: false }),
  );
  return {
    id: passkey.credentialId,
    rawId: passkey.credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientDataJSON.toString("base64url"),
      attestationObject: Buffer.from(attestationObject).toString("base64url"),
      transports: ["internal"],
    },
  };
}

/** The assertion in `@simplewebauthn/browser` AuthenticationResponseJSON shape. */
export function assertionToJSON(passkey: SoftwarePasskey, assertion: SoftwareAssertion) {
  return {
    id: passkey.credentialId,
    rawId: passkey.credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      authenticatorData: assertion.authenticatorData.toString("base64url"),
      clientDataJSON: assertion.clientDataJSON.toString("base64url"),
      signature: assertion.signature.toString("base64url"),
    },
  };
}
