// Server side of the agents' smart accounts (OpenZeppelin `stellar-accounts` multisig
// account, already deployed on testnet as a WASM hash — see DECISIONS.md).
//
// - Passkey agents: External(webauthn_verifier, p256_pubkey65 ‖ credential_id)
// - Seed agents:    External(ed25519_verifier, ed25519_pubkey32), key held by the server
import { createHash } from "node:crypto";
import { Address, Keypair, Operation, xdr } from "@stellar/stellar-sdk";
import { env } from "@/lib/env";
import { submitOperation } from "./client";
import { publicKey, rpcServer } from "./network";
import { deployedContractAddress, signerScVal, signSmartAccountEntries, type ExternalSigner } from "./smart-account-auth";

export function passkeySigner(p256PublicKey: Uint8Array, credentialIdB64url: string): ExternalSigner {
  const cred = Buffer.from(credentialIdB64url, "base64url");
  return { verifier: env.webauthnVerifier, keyData: Buffer.concat([Buffer.from(p256PublicKey), cred]) };
}

export function ed25519Signer(kp: Keypair): ExternalSigner {
  return { verifier: env.ed25519Verifier, keyData: kp.rawPublicKey() };
}

export async function contractExists(address: string): Promise<boolean> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(address).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const r = await rpcServer().getLedgerEntries(key);
  return r.entries.length > 0;
}

/** Deploys a smart account with a single signer on its default rule. Fees: sponsor. */
export async function deploySmartAccount(signer: ExternalSigner): Promise<{ address: string; hash: string }> {
  const salt = createHash("sha256").update(Buffer.from(signer.keyData)).digest();
  const deployer = publicKey("sponsor");
  const address = deployedContractAddress(deployer, salt, env.networkPassphrase);
  if (await contractExists(address)) return { address, hash: "" };
  const op = Operation.createCustomContract({
    address: new Address(deployer),
    wasmHash: Buffer.from(env.accountWasmHash, "hex"),
    salt,
    constructorArgs: [xdr.ScVal.scvVec([signerScVal(signer)]), xdr.ScVal.scvMap([])],
  });
  const r = await submitOperation(op, { source: "sponsor" });
  return { address, hash: r.hash };
}

/** Auth-entry signer for seed agents whose smart account uses a server-held Ed25519 key. */
export function demoEntrySigner(smartAccount: string, secret: string) {
  const kp = Keypair.fromSecret(secret);
  const signer = ed25519Signer(kp);
  return (entries: xdr.SorobanAuthorizationEntry[], latestLedger: number) =>
    signSmartAccountEntries(entries, smartAccount, signer, (digest) => kp.sign(digest), {
      networkPassphrase: env.networkPassphrase,
      latestLedger,
    });
}
