// Agent smart accounts (spec §2 Agent wallet, §4.2, §9.2, §9.3, §11.2).
//
// Every agent gets an OpenZeppelin smart account (the build smart-account-kit
// 0.8.0 deploys on testnet) whose only signer is either the agent's passkey
// (`External(WebAuthn verifier, P-256 key ‖ credential id)`) or, for seed
// agents, a server-held Ed25519 demo key (`External(Ed25519 verifier, key)`).
// The sponsor deploys the account and pays every fee, so agents never see a
// wallet, a seed phrase or a fee.

import { createHmac } from "node:crypto";

import { Address, Keypair, StrKey, hash, xdr } from "@stellar/stellar-sdk";

import { env, requireEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { getDeployment } from "@/lib/stellar/contracts";
import type { AgentTxAction } from "@/lib/types/api";

import { agentActionFunc, cardEnabledAfter } from "./agent-tx-actions";
import {
  AuthEntryError,
  authEntryAddress,
  authPayloadScVal,
  prepareEntryForSigning,
  signerToScVal,
  withSignature,
  type SmartAccountSigner,
} from "./agent-tx-auth";
import {
  ChainTxError,
  contractExists,
  deriveContractId,
  networkPassphrase,
  recordAuth,
  sponsorKeypair,
  submitSponsored,
  type SubmittedTx,
} from "./agent-tx-sponsor";

/** smart-account-kit testnet deployment (docs/deployments-protocol-27-2026-07-09.md, OpenZeppelin/stellar-contracts@1e513890). */
export const SMART_ACCOUNT_KIT_TESTNET = {
  accountWasmHash: "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifier: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  ed25519Verifier: "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4",
} as const;

export function smartAccountConfig() {
  const e = env();
  return {
    accountWasmHash: e.SMART_ACCOUNT_WASM_HASH ?? SMART_ACCOUNT_KIT_TESTNET.accountWasmHash,
    webauthnVerifier: e.WEBAUTHN_VERIFIER_ID ?? SMART_ACCOUNT_KIT_TESTNET.webauthnVerifier,
    ed25519Verifier: e.ED25519_VERIFIER_ID ?? SMART_ACCOUNT_KIT_TESTNET.ed25519Verifier,
  };
}

/** Lifetime of a smart-account signature, from the simulation ledger (~30 min at ~5 s per ledger). */
export const SIGNATURE_TTL_LEDGERS = 360;

export interface DeployedAccount {
  /** C… contract address of the smart account. */
  address: string;
  /** Null when the account already existed (deployment is idempotent). */
  txHash: string | null;
}

// ---------- signers ----------

export function credentialIdBytes(credentialId: string): Buffer {
  const bytes = Buffer.from(credentialId, "base64url");
  if (bytes.length === 0) throw new HttpError(400, "BAD_CREDENTIAL", "Credential id must be base64url");
  return bytes;
}

export function passkeySigner(input: { credentialId: string; publicKeyP256: Uint8Array }): SmartAccountSigner {
  return {
    kind: "webauthn",
    verifier: smartAccountConfig().webauthnVerifier,
    publicKey: new Uint8Array(input.publicKeyP256),
    credentialId: credentialIdBytes(input.credentialId),
  };
}

/** Salt = sha256(credential id), the smart-account-kit convention: one account per passkey. */
export function passkeyAccountSalt(credentialId: string): Uint8Array {
  return hash(credentialIdBytes(credentialId));
}

/** Address the passkey's account has (or will have) when deployed by the current sponsor. */
export function predictPasskeySmartAccount(credentialId: string): string {
  return deriveContractId(sponsorKeypair().publicKey(), passkeyAccountSalt(credentialId));
}

/**
 * Seed agents' Ed25519 demo signer: HMAC-SHA256(DEMO_SIGNER_SEED, label) as the key seed, so the
 * same label always maps to the same key (falls back to SPONSOR_SECRET when no seed is configured).
 */
export function demoSignerKeypair(label: string): Keypair {
  const normalized = label.trim().toLowerCase();
  if (!normalized) throw new HttpError(400, "BAD_LABEL", "Demo signer label must not be empty");
  const secret = env().DEMO_SIGNER_SEED ?? requireEnv("SPONSOR_SECRET");
  const seed = createHmac("sha256", secret).update(`explorador-advance/demo-signer/v1/${normalized}`).digest();
  return Keypair.fromRawEd25519Seed(seed);
}

export function demoSigner(label: string): SmartAccountSigner {
  return { kind: "ed25519", verifier: smartAccountConfig().ed25519Verifier, publicKey: demoSignerKeypair(label).rawPublicKey() };
}

export function demoAccountSalt(label: string): Uint8Array {
  return hash(demoSignerKeypair(label).rawPublicKey());
}

export function predictDemoSmartAccount(label: string): string {
  return deriveContractId(sponsorKeypair().publicKey(), demoAccountSalt(label));
}

// ---------- deployment ----------

/** `CreateContractV2(account wasm, salt)` with constructor `(signers: [signer], policies: {})`, deployed by the sponsor. */
export function deployFunc(signer: SmartAccountSigner, salt: Uint8Array): xdr.HostFunction {
  const { accountWasmHash } = smartAccountConfig();
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(sponsorKeypair().publicKey()).toScAddress(),
          salt: Buffer.from(salt),
        }),
      ),
      executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(accountWasmHash, "hex")),
      constructorArgs: [xdr.ScVal.scvVec([signerToScVal(signer)]), xdr.ScVal.scvMap([])],
    }),
  );
}

async function deployWithSigner(signer: SmartAccountSigner, salt: Uint8Array): Promise<DeployedAccount> {
  const address = deriveContractId(sponsorKeypair().publicKey(), salt);
  if (await contractExists(address)) return { address, txHash: null };
  try {
    const res = await submitSponsored(deployFunc(signer, salt), []);
    return { address, txHash: res.txHash };
  } catch (err) {
    // A concurrent or earlier attempt may have deployed it (deterministic address).
    if (await contractExists(address).catch(() => false)) return { address, txHash: null };
    throw err;
  }
}

/** Deploys the agent's smart account whose signer is the passkey's P-256 public key (sponsored, idempotent). */
export async function deployPasskeySmartAccount(input: {
  credentialId: string;
  /** 65-byte uncompressed secp256r1 public key. */
  publicKeyP256: Uint8Array;
}): Promise<DeployedAccount> {
  return deployWithSigner(passkeySigner(input), passkeyAccountSalt(input.credentialId));
}

/** Seed agents (spec §11.2): smart account controlled by a server-held Ed25519 demo signer. */
export async function deployDemoSmartAccount(input: {
  /** Stable label (e.g. the agent's email) the demo signer is derived from. */
  label: string;
}): Promise<DeployedAccount> {
  return deployWithSigner(demoSigner(input.label), demoAccountSalt(input.label));
}

// ---------- invocations signed by a server-held signer ----------

export interface DigestSigner {
  signer: SmartAccountSigner;
  /** Returns the `AuthPayload` signature bytes for a 32-byte auth digest. */
  sign(authDigest: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

export function ed25519DigestSigner(keypair: Keypair, verifier = smartAccountConfig().ed25519Verifier): DigestSigner {
  return {
    signer: { kind: "ed25519", verifier, publicKey: keypair.rawPublicKey() },
    sign: (digest) => keypair.sign(digest),
  };
}

/**
 * Authorizes `func` as `smartAccount` with `signer` and submits it with the sponsor as source.
 * Every auth entry the invocation needs must belong to `smartAccount`.
 */
export async function invokeAsSmartAccount(input: {
  smartAccount: string;
  func: xdr.HostFunction;
  signer: DigestSigner;
  advanceCodes?: boolean;
}): Promise<SubmittedTx> {
  if (!StrKey.isValidContract(input.smartAccount)) throw new HttpError(400, "BAD_ACCOUNT", "Smart account must be a C… address");
  const opts = { advanceCodes: input.advanceCodes };
  const recorded = await recordAuth(input.func, opts);
  if (recorded.auth.length === 0) {
    throw new ChainTxError("NO_AUTH_REQUIRED", "The invocation does not require the smart account's authorization");
  }
  const expiration = recorded.latestLedger + SIGNATURE_TTL_LEDGERS;
  const signed: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of recorded.auth) {
    let address: string;
    try {
      address = authEntryAddress(entry);
    } catch (err) {
      throw new ChainTxError("UNEXPECTED_AUTH", err instanceof AuthEntryError ? err.message : "Unsupported auth entry");
    }
    if (address !== input.smartAccount) {
      throw new ChainTxError("UNEXPECTED_AUTH", `The invocation also needs authorization from ${address}`);
    }
    const prepared = prepareEntryForSigning(entry, expiration, networkPassphrase());
    const bytes = await input.signer.sign(prepared.authDigest);
    signed.push(withSignature(prepared.entry, authPayloadScVal(prepared.contextRuleIds, [{ signer: input.signer.signer, bytes }])));
  }
  return submitSponsored(input.func, signed, opts);
}

// ---------- agent actions ----------

export async function requirePoolId(): Promise<string> {
  const deployment = await getDeployment();
  if (!deployment?.advancePool) {
    throw new HttpError(503, "NOT_DEPLOYED", "advance_pool is not deployed yet (run pnpm deploy:testnet)");
  }
  return deployment.advancePool;
}

/** Mirrors the on-chain card flag on the Agent row after enable_card / disable_card. */
export async function recordCardState(smartAccount: string, action: AgentTxAction): Promise<boolean | null> {
  const enabled = cardEnabledAfter(action);
  if (enabled !== null) {
    // Lazy import keeps this module usable from scripts before their env is loaded.
    const { db } = await import("@/lib/db");
    await db.agent.updateMany({ where: { smartAccount }, data: { cardEnabledOnChain: enabled } });
  }
  return enabled;
}

/** Signs and submits an agent action (e.g. `enable_card`) with a seed agent's server-held demo signer. */
export async function submitDemoAgentAction(input: {
  label: string;
  smartAccount: string;
  action: AgentTxAction;
}): Promise<{ txHash: string }> {
  const poolId = await requirePoolId();
  const res = await invokeAsSmartAccount({
    smartAccount: input.smartAccount,
    func: agentActionFunc(poolId, input.smartAccount, input.action),
    signer: ed25519DigestSigner(demoSignerKeypair(input.label)),
    advanceCodes: true,
  });
  await recordCardState(input.smartAccount, input.action);
  return { txHash: res.txHash };
}
