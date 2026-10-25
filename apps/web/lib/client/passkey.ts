"use client";
// Browser-side passkey helpers (WebAuthn login/registration + smart-account auth signing).
// The same passkey signs in and authorizes the agent's smart account: for on-chain actions
// the WebAuthn challenge is the auth digest of the Soroban auth entry.

import { base64URLStringToBuffer, bufferToBase64URLString, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Buffer } from "buffer";
import { xdr } from "@stellar/stellar-sdk";
import type { AgentTxAction, AgentTxPrepareResponse, TxSubmitResponse } from "@/lib/api-types";
import { apiPost } from "@/lib/client/api";
import { derToCompactLowS, signSmartAccountEntries, webAuthnSignatureBytes } from "@/lib/stellar/smart-account-auth";

const fromB64url = (s: string) => new Uint8Array(base64URLStringToBuffer(s));

/** Registers a new passkey for the logged-in (pre-passkey) user. Resolves with the agent's smart account (agents) or null (admins). */
export async function registerPasskey(): Promise<{ smartAccount: string | null }> {
  const optionsJSON = await apiPost<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/auth/passkey/register/options");
  const response = await startRegistration({ optionsJSON });
  const r = await apiPost<{ ok: true; smartAccount: string | null }>("/api/auth/passkey/register/verify", { response });
  return { smartAccount: r.smartAccount };
}

/** Discoverable-credential passkey sign-in. Resolves with the user's role. */
export async function loginWithPasskey(): Promise<{ role: "AGENT" | "ADMIN" }> {
  const optionsJSON = await apiPost<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/passkey/login/options");
  const response = await startAuthentication({ optionsJSON });
  const r = await apiPost<{ ok: true; role: "AGENT" | "ADMIN" }>("/api/auth/passkey/login/verify", { response });
  return { role: r.role };
}

/**
 * Runs a passkey-authorized smart-account action end to end:
 * prepare (server) → sign auth entries with the passkey (browser) → submit (server).
 */
export async function runAgentAction(
  action: AgentTxAction,
  params: { amount?: string; to?: string } = {},
): Promise<TxSubmitResponse> {
  const prepared = await apiPost<AgentTxPrepareResponse>("/api/stellar/agent-tx/prepare", { action, ...params });
  const signedXdr = prepared.serverSigned ? prepared.xdr : await signPreparedTx(prepared);
  return apiPost<TxSubmitResponse>("/api/stellar/agent-tx/submit", { xdr: signedXdr, action });
}

/** Signs the smart-account auth entries in a prepared transaction with the passkey. */
export async function signPreparedTx(prepared: AgentTxPrepareResponse, credentialId?: string): Promise<string> {
  if (!prepared.signer) throw new Error("This account has no passkey signer");
  const signer = { verifier: prepared.signer.verifier, keyData: new Uint8Array(Buffer.from(prepared.signer.keyData, "hex")) };
  const credId = credentialId ?? prepared.signer.credentialId;

  const envelope = xdr.TransactionEnvelope.fromXDR(prepared.xdr, "base64");
  const op = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
  const signed = await signSmartAccountEntries(
    op.auth(),
    prepared.smartAccount,
    signer,
    async (digest) => {
      const res = await startAuthentication({
        optionsJSON: {
          challenge: bufferToBase64URLString(new Uint8Array(digest).buffer as ArrayBuffer),
          allowCredentials: [{ id: credId, type: "public-key" }],
          userVerification: "required",
          timeout: 60_000,
        },
      });
      return webAuthnSignatureBytes({
        authenticatorData: fromB64url(res.response.authenticatorData),
        clientDataJSON: fromB64url(res.response.clientDataJSON),
        signature: derToCompactLowS(fromB64url(res.response.signature)),
      });
    },
    { networkPassphrase: prepared.networkPassphrase, latestLedger: prepared.latestLedger },
  );
  op.auth(signed);
  return envelope.toXDR("base64");
}
