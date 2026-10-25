// Agent passkey transactions (spec §9.3): POST /api/stellar/agent-tx/prepare
// builds the advance_pool call with the sponsor as source, simulates it and
// returns the smart-account auth digests the passkey must sign; /submit checks
// the signed material, attaches it, re-simulates, signs as sponsor and submits.
// Stateless between the two calls: the client returns the unsigned entries and
// the server re-derives everything it trusts.

import { xdr } from "@stellar/stellar-sdk";
import { z } from "zod";

import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { badRequest, conflict, forbidden } from "@/lib/http";
import { AssertionError, checkSigningAssertion } from "@/lib/passkey/assertion";
import { webauthnConfig } from "@/lib/passkey/config";
import { explorerUrl } from "@/lib/stellar/contracts";
import type {
  AgentTxAction,
  AgentTxPrepareResponse,
  AgentTxSubmitRequest,
  AgentTxSubmitResponse,
  WebAuthnAssertionJSON,
} from "@/lib/types/api";

import { agentActionFunc, agentTxActionSchema } from "./agent-tx-actions";
import {
  AuthEntryError,
  addressCredentials,
  authEntryAddress,
  authPayloadScVal,
  digestOfPreparedEntry,
  prepareEntryForSigning,
  webAuthnSigDataBytes,
  withSignature,
} from "./agent-tx-auth";
import { ChainTxError, networkPassphrase, recordAuth, submitSponsored } from "./agent-tx-sponsor";
import {
  SIGNATURE_TTL_LEDGERS,
  demoSignerKeypair,
  ed25519DigestSigner,
  invokeAsSmartAccount,
  passkeySigner,
  predictDemoSmartAccount,
  predictPasskeySmartAccount,
  recordCardState,
  requirePoolId,
} from "./smart-account";

/** An agent action needs one auth entry (the agent's `require_auth`); allow a little headroom. */
const MAX_AUTH_ENTRIES = 4;
/** Slack for ledgers that close between /prepare and /submit when checking the requested expiration. */
const EXPIRATION_SLACK_LEDGERS = 60;

const base64url = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/, "must be base64url");

const assertionSchema = z.object({
  id: base64url,
  rawId: base64url.optional(),
  type: z.literal("public-key").optional(),
  response: z.object({
    authenticatorData: base64url,
    clientDataJSON: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().optional(),
});

/** Body of POST /api/stellar/agent-tx/submit. */
export const agentTxSubmitSchema: z.ZodType<AgentTxSubmitRequest> = agentTxActionSchema.and(
  z.object({
    authEntries: z.array(z.string().min(1).max(16_384)).max(MAX_AUTH_ENTRIES).optional(),
    assertions: z.array(assertionSchema).max(MAX_AUTH_ENTRIES).optional(),
  }),
);

export { agentTxActionSchema };

type LoadedAgent = NonNullable<Awaited<ReturnType<typeof loadAgent>>>;

async function loadAgent(user: SessionUser) {
  const agent = await db.agent.findUnique({
    where: { userId: user.userId },
    include: { user: { include: { passkeys: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!agent) throw conflict("Your account isn't set up yet: finish onboarding first", "NO_SMART_ACCOUNT");
  return agent;
}

function actionOf(body: AgentTxSubmitRequest): AgentTxAction {
  if (body.action === "withdraw_balance") {
    return body.to ? { action: body.action, amount: body.amount, to: body.to } : { action: body.action, amount: body.amount };
  }
  return { action: body.action };
}

/** Every auth entry the call needs must be the agent's smart account (never the sponsor or anyone else). */
function agentEntries(auth: xdr.SorobanAuthorizationEntry[], smartAccount: string): xdr.SorobanAuthorizationEntry[] {
  if (auth.length === 0) {
    throw new ChainTxError("NO_AUTH_REQUIRED", "advance_pool did not ask for the agent's authorization", null, 500);
  }
  if (auth.length > MAX_AUTH_ENTRIES) throw new ChainTxError("UNEXPECTED_AUTH", "Too many authorizations requested", null, 500);
  for (const entry of auth) {
    let address: string;
    try {
      address = authEntryAddress(entry);
    } catch (err) {
      throw new ChainTxError("UNEXPECTED_AUTH", err instanceof AuthEntryError ? err.message : "Unsupported authorization", null, 500);
    }
    if (address !== smartAccount) {
      throw new ChainTxError("UNEXPECTED_AUTH", `The call also needs authorization from ${address}`, null, 500);
    }
  }
  return auth;
}

/** Passkeys that control the account (its address derives from the credential id); all of the user's as a fallback. */
function signerPasskeys(agent: LoadedAgent) {
  const passkeys = agent.user.passkeys;
  const matching = passkeys.filter((p) => {
    try {
      return predictPasskeySmartAccount(p.credentialId) === agent.smartAccount;
    } catch {
      return false;
    }
  });
  return matching.length > 0 ? matching : passkeys;
}

export async function prepareAgentTx(user: SessionUser, action: AgentTxAction): Promise<AgentTxPrepareResponse> {
  const agent = await loadAgent(user);
  const poolId = await requirePoolId();
  const { rpID } = webauthnConfig();
  const base = { action, smartAccount: agent.smartAccount, rpId: rpID };

  if (agent.signerKind === "demo-ed25519") {
    return { ...base, signerKind: "demo-ed25519", authEntries: [], challenges: [], allowCredentials: [], expirationLedger: null };
  }
  const passkeys = signerPasskeys(agent);
  if (passkeys.length === 0) throw conflict("Register a passkey first", "NO_PASSKEY");

  const recorded = await recordAuth(agentActionFunc(poolId, agent.smartAccount, action), { advanceCodes: true });
  return {
    ...base,
    signerKind: "passkey",
    ...preparePasskeyEntries(agentEntries(recorded.auth, agent.smartAccount), recorded.latestLedger),
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
  };
}

/** Sets the signature expiration on simulated entries and returns what /prepare sends to the browser. */
export function preparePasskeyEntries(entries: xdr.SorobanAuthorizationEntry[], latestLedger: number) {
  const expirationLedger = latestLedger + SIGNATURE_TTL_LEDGERS;
  const prepared = entries.map((entry) => prepareEntryForSigning(entry, expirationLedger, networkPassphrase()));
  return {
    expirationLedger,
    authEntries: prepared.map((p) => p.entry.toXdr("base64")),
    challenges: prepared.map((p) => Buffer.from(p.authDigest).toString("base64url")),
  };
}

export function decodeAuthEntry(encoded: string): xdr.SorobanAuthorizationEntry {
  try {
    return xdr.SorobanAuthorizationEntry.fromXDR(encoded, "base64");
  } catch {
    throw badRequest("authEntries are not valid XDR", "BAD_AUTH_ENTRY");
  }
}

export async function submitAgentTx(user: SessionUser, body: AgentTxSubmitRequest): Promise<AgentTxSubmitResponse> {
  const agent = await loadAgent(user);
  const action = actionOf(body);
  const poolId = await requirePoolId();
  const func = agentActionFunc(poolId, agent.smartAccount, action);

  let submitted: { txHash: string; ledger: number };
  if (agent.signerKind === "demo-ed25519") {
    if (predictDemoSmartAccount(user.email) !== agent.smartAccount) {
      throw conflict("This account's demo signer is not derived from your email", "DEMO_SIGNER_MISMATCH");
    }
    submitted = await invokeAsSmartAccount({
      smartAccount: agent.smartAccount,
      func,
      signer: ed25519DigestSigner(demoSignerKeypair(user.email)),
      advanceCodes: true,
    });
  } else {
    submitted = await submitSponsored(func, await signWithPasskeys(agent, func, body), { advanceCodes: true });
  }

  const cardEnabledOnChain = await recordCardState(agent.smartAccount, action);
  return {
    txHash: submitted.txHash,
    explorerUrl: explorerUrl("tx", submitted.txHash),
    ledger: submitted.ledger,
    action: action.action,
    cardEnabledOnChain,
  };
}

const fromBase64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

/** Validates the client's entries against a fresh simulation and attaches the passkey signatures. */
async function signWithPasskeys(
  agent: LoadedAgent,
  func: xdr.HostFunction,
  body: AgentTxSubmitRequest,
): Promise<xdr.SorobanAuthorizationEntry[]> {
  const encoded = body.authEntries ?? [];
  const assertions = body.assertions ?? [];
  if (encoded.length === 0) throw badRequest("authEntries are required: call /prepare first", "MISSING_SIGNATURE");
  if (assertions.length !== encoded.length) throw badRequest("One passkey assertion per auth entry is required", "MISSING_SIGNATURE");

  const entries = encoded.map(decodeAuthEntry);

  // The entries must authorize exactly the invocation the server builds now.
  const expected = await recordAuth(func, { advanceCodes: true });
  const expectedEntries = agentEntries(expected.auth, agent.smartAccount);
  if (expectedEntries.length !== entries.length) throw badRequest("The transaction changed: prepare it again", "STALE_TX");

  return entries.map((entry, i) => {
    let address: string;
    try {
      address = authEntryAddress(entry);
    } catch {
      throw badRequest("Unsupported authorization entry", "BAD_AUTH_ENTRY");
    }
    if (address !== agent.smartAccount) throw forbidden("Authorization entry is for another account");
    if (!entry.rootInvocation.equals(expectedEntries[i]!.rootInvocation)) {
      throw badRequest("The authorization does not match this action: prepare it again", "STALE_TX");
    }
    const expiration = addressCredentials(entry).signatureExpirationLedger;
    if (expiration <= expected.latestLedger) throw badRequest("The signature request expired: try again", "EXPIRED");
    if (expiration > expected.latestLedger + SIGNATURE_TTL_LEDGERS + EXPIRATION_SLACK_LEDGERS) {
      throw badRequest("Signature expiration is too far in the future", "BAD_AUTH_ENTRY");
    }

    const assertion = assertions[i]!;
    const passkey = agent.user.passkeys.find((p) => p.credentialId === assertion.id);
    if (!passkey) throw forbidden("This passkey is not registered to your account");
    return signEntryWithAssertion(entry, passkey, assertion);
  });
}

/**
 * Checks that `assertion` is the passkey's signature over this entry's auth digest (type, challenge,
 * origin, RP ID, UP/UV, signature) and returns the entry carrying the smart-account `AuthPayload`.
 */
export function signEntryWithAssertion(
  entry: xdr.SorobanAuthorizationEntry,
  passkey: { credentialId: string; publicKeyP256: Uint8Array },
  assertion: WebAuthnAssertionJSON,
): xdr.SorobanAuthorizationEntry {
  const { rpID, origin } = webauthnConfig();
  const digest = digestOfPreparedEntry(entry, networkPassphrase());
  const authenticatorData = fromBase64url(assertion.response.authenticatorData);
  const clientDataJSON = fromBase64url(assertion.response.clientDataJSON);
  let compact: Uint8Array;
  try {
    compact = checkSigningAssertion({
      publicKeyP256: new Uint8Array(passkey.publicKeyP256),
      expectedChallenge: digest.authDigest,
      expectedOrigin: origin,
      rpID,
      authenticatorData,
      clientDataJSON,
      signature: fromBase64url(assertion.response.signature),
    });
  } catch (err) {
    if (err instanceof AssertionError) throw badRequest(err.message, "BAD_SIGNATURE");
    throw err;
  }
  const sigData = webAuthnSigDataBytes({ authenticatorData, clientDataJSON, signature: compact });
  return withSignature(digest.entry, authPayloadScVal(digest.contextRuleIds, [{ signer: passkeySigner(passkey), bytes: sigData }]));
}
