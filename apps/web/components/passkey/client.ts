// Browser side of the passkey flows (spec §4.2, §9.2, §9.3). Framework-free so
// any component can call it; the React hooks and buttons wrap these functions.

import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import type {
  AgentProvisioning,
  AgentTxAction,
  AgentTxPrepareResponse,
  AgentTxSubmitRequest,
  AgentTxSubmitResponse,
  ApiError,
  PasskeyLoginVerifyResponse,
  PasskeyRegisterVerifyResponse,
} from "@/lib/types/api";

export class PasskeyClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}

export type AgentActionPhase = "preparing" | "signing" | "submitting";

const SIGN_TIMEOUT_MS = 120_000;

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      credentials: "same-origin",
    });
  } catch {
    throw new PasskeyClientError("Network error: check your connection and try again", "NETWORK");
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as ApiError | null)?.error;
    throw new PasskeyClientError(error?.message ?? `Request failed (${res.status})`, error?.code ?? "HTTP_ERROR", res.status);
  }
  return data as T;
}

/** Maps browser WebAuthn failures to messages an agent can act on. */
export function describeWebAuthnError(err: unknown): PasskeyClientError {
  if (err instanceof PasskeyClientError) return err;
  const code = err instanceof WebAuthnError ? err.code : undefined;
  const name = err instanceof Error ? err.name : "";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return new PasskeyClientError("This device already has a passkey for your account: sign in with it instead", "PASSKEY_EXISTS");
  }
  if (code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" || code === "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT") {
    return new PasskeyClientError("This authenticator can't create a passkey with a PIN or biometrics; try your phone or computer's built-in passkeys", "PASSKEY_UNSUPPORTED");
  }
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") {
    return new PasskeyClientError("Passkeys aren't available on this address; open the app from its official URL", "PASSKEY_DOMAIN");
  }
  if (name === "NotAllowedError" || code === "ERROR_CEREMONY_ABORTED") {
    return new PasskeyClientError("The passkey prompt was closed or timed out", "PASSKEY_CANCELLED");
  }
  return new PasskeyClientError(err instanceof Error ? err.message : "Passkey operation failed", "PASSKEY_FAILED");
}

async function webauthn<T>(ceremony: () => Promise<T>): Promise<T> {
  try {
    return await ceremony();
  } catch (err) {
    throw describeWebAuthnError(err);
  }
}

/** Creates the agent's (or admin's) passkey; for agents the server also deploys the smart account and creates the card. */
export async function registerPasskey(): Promise<PasskeyRegisterVerifyResponse> {
  const optionsJSON = await postJson<PublicKeyCredentialCreationOptionsJSON>("/api/auth/passkey/register/options");
  const response = await webauthn(() => startRegistration({ optionsJSON }));
  return postJson<PasskeyRegisterVerifyResponse>("/api/auth/passkey/register/verify", response);
}

/** Discoverable passkey sign-in (no email needed). */
export async function signInWithPasskey(): Promise<PasskeyLoginVerifyResponse> {
  const optionsJSON = await postJson<PublicKeyCredentialRequestOptionsJSON>("/api/auth/passkey/login/options");
  const response = await webauthn(() => startAuthentication({ optionsJSON }));
  return postJson<PasskeyLoginVerifyResponse>("/api/auth/passkey/login/verify", response);
}

/** Re-runs the smart account / card set-up after a failed step (idempotent). */
export function retryProvisioning(): Promise<AgentProvisioning> {
  return postJson<AgentProvisioning>("/api/auth/passkey/provision");
}

/**
 * Runs an agent action on advance_pool: prepare (server) → passkey prompt (one per auth entry) → submit.
 * The sponsor pays the fee; the agent only confirms with their passkey.
 */
export async function signAndSubmitAgentAction(
  action: AgentTxAction,
  onPhase?: (phase: AgentActionPhase) => void,
): Promise<AgentTxSubmitResponse> {
  onPhase?.("preparing");
  const prepared = await postJson<AgentTxPrepareResponse>("/api/stellar/agent-tx/prepare", action);

  const body: AgentTxSubmitRequest = { ...action };
  if (prepared.signerKind === "passkey") {
    onPhase?.("signing");
    body.authEntries = prepared.authEntries;
    body.assertions = [];
    for (const challenge of prepared.challenges) {
      const assertion = await webauthn(() =>
        startAuthentication({
          optionsJSON: {
            challenge,
            rpId: prepared.rpId,
            allowCredentials: prepared.allowCredentials.map((c) => ({
              id: c.id,
              type: "public-key" as const,
              transports: c.transports as AuthenticatorTransport[] | undefined,
            })),
            userVerification: "required",
            timeout: SIGN_TIMEOUT_MS,
          },
        }),
      );
      body.assertions.push(assertion);
    }
  }
  onPhase?.("submitting");
  return postJson<AgentTxSubmitResponse>("/api/stellar/agent-tx/submit", body);
}
