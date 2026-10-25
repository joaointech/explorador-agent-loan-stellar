// Testnet smoke test for agent smart accounts (pnpm smoke:smart-account).
//
// Deploys two OpenZeppelin smart accounts through the sponsor:
//   1. a seed-agent account controlled by the Ed25519 demo signer, and
//   2. a passkey account whose signer is a P-256 key generated here (standing in for a passkey),
// funds both with XLM, then proves each can authorize a native-asset SAC `transfer` out of the
// account, and that a forged passkey signature is rejected. Needs SPONSOR_SECRET in
// apps/web/.env.local (funded with Friendbot if the account does not exist yet).

import net from "node:net";
import path from "node:path";

// Node gives each resolved address 250 ms to connect before trying the next; on slow links
// that fails every attempt against the RPC, so allow more time per address.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);
process.loadEnvFile(path.resolve(import.meta.dirname, "../apps/web/.env.local"));

const sa = await import("@/lib/stellar/smart-account");
const sponsorLib = await import("@/lib/stellar/agent-tx-sponsor");
const auth = await import("@/lib/stellar/agent-tx-auth");
const { derToCompactLowS } = await import("@/lib/passkey/signature");
const { createSoftwarePasskey, softwareAssertion } = await import("@/lib/passkey/software-authenticator");
const { explorerUrl } = await import("@/lib/stellar/contracts");

const XLM = 10_000_000n;
const log = (msg: string) => console.log(`[smoke] ${msg}`);
const txLine = (label: string, hash: string | null) =>
  log(`${label}: ${hash ? `${hash}  ${explorerUrl("tx", hash)}` : "already existed"}`);

const sponsor = sponsorLib.sponsorKeypair();
const sac = sponsorLib.nativeAssetContractId();

async function ensureSponsorFunded() {
  try {
    await sponsorLib.stellarRpc().getAccount(sponsor.publicKey());
  } catch {
    log(`funding sponsor ${sponsor.publicKey()} with Friendbot`);
    const res = await fetch(`https://friendbot.stellar.org?addr=${sponsor.publicKey()}`);
    if (!res.ok) throw new Error(`Friendbot failed: ${res.status}`);
  }
}

const transferFunc = (from: string, to: string, amount: bigint) => sponsorLib.tokenTransferFunc(sac, from, to, amount);
const balance = (id: string) => sponsorLib.readTokenBalance(sac, id);

async function main() {
  await ensureSponsorFunded();
  const cfg = sa.smartAccountConfig();
  log(`sponsor ${sponsor.publicKey()}`);
  log(`account wasm ${cfg.accountWasmHash}`);
  log(`webauthn verifier ${cfg.webauthnVerifier} · ed25519 verifier ${cfg.ed25519Verifier}`);

  // 1. Seed-agent account (Ed25519 demo signer)
  const label = `smoke-${Date.now()}@demo.explorador.pt`;
  const demo = await sa.deployDemoSmartAccount({ label });
  log(`demo-signer account ${demo.address}`);
  txLine("deploy (demo signer)", demo.txHash);
  const again = await sa.deployDemoSmartAccount({ label });
  if (again.address !== demo.address || again.txHash !== null) throw new Error("deployDemoSmartAccount is not idempotent");
  log("redeploy is a no-op (idempotent) ✓");

  // 2. Passkey account (P-256 key generated in Node)
  const passkey = createSoftwarePasskey({ rpId: "localhost", origin: "http://localhost:3106" });
  const pk = await sa.deployPasskeySmartAccount({ credentialId: passkey.credentialId, publicKeyP256: passkey.publicKeyP256 });
  log(`passkey account ${pk.address}`);
  txLine("deploy (passkey)", pk.txHash);
  if (sa.predictPasskeySmartAccount(passkey.credentialId) !== pk.address) throw new Error("address prediction mismatch");

  // 3. Fund both accounts from the sponsor (sponsor authorizes as the transaction source)
  for (const account of [demo.address, pk.address]) {
    const res = await sponsorLib.submitSponsored(transferFunc(sponsor.publicKey(), account, 5n * XLM), []);
    txLine(`fund ${account.slice(0, 6)}… with 5 XLM`, res.txHash);
  }

  // 4. Ed25519 demo signer authorizes a transfer out of its account
  const demoBefore = await balance(demo.address);
  const demoTx = await sa.invokeAsSmartAccount({
    smartAccount: demo.address,
    func: transferFunc(demo.address, sponsor.publicKey(), 1n * XLM),
    signer: sa.ed25519DigestSigner(sa.demoSignerKeypair(label)),
  });
  txLine("transfer 1 XLM authorized by the Ed25519 demo signer", demoTx.txHash);
  const demoAfter = await balance(demo.address);
  if (demoBefore - demoAfter !== XLM) throw new Error(`demo balance moved by ${demoBefore - demoAfter}`);
  log(`demo account balance ${demoBefore} → ${demoAfter} stroops ✓`);

  // 5. Passkey (WebAuthn / secp256r1) authorizes a transfer out of its account
  const webauthnSigner = (key: typeof passkey): import("@/lib/stellar/smart-account").DigestSigner => ({
    signer: sa.passkeySigner({ credentialId: passkey.credentialId, publicKeyP256: passkey.publicKeyP256 }),
    sign: (digest) => {
      const a = softwareAssertion(key, digest);
      return auth.webAuthnSigDataBytes({
        authenticatorData: a.authenticatorData,
        clientDataJSON: a.clientDataJSON,
        signature: derToCompactLowS(a.signature),
      });
    },
  });
  const pkBefore = await balance(pk.address);
  const pkTx = await sa.invokeAsSmartAccount({
    smartAccount: pk.address,
    func: transferFunc(pk.address, sponsor.publicKey(), 1n * XLM),
    signer: webauthnSigner(passkey),
  });
  txLine("transfer 1 XLM authorized by the passkey (WebAuthn)", pkTx.txHash);
  const pkAfter = await balance(pk.address);
  if (pkBefore - pkAfter !== XLM) throw new Error(`passkey balance moved by ${pkBefore - pkAfter}`);
  log(`passkey account balance ${pkBefore} → ${pkAfter} stroops ✓`);

  // 6. A signature from a different P-256 key must be rejected
  const impostor = createSoftwarePasskey({ rpId: "localhost", origin: "http://localhost:3106" });
  try {
    await sa.invokeAsSmartAccount({
      smartAccount: pk.address,
      func: transferFunc(pk.address, sponsor.publicKey(), 1n * XLM),
      signer: webauthnSigner(impostor),
    });
    throw new Error("forged passkey signature was accepted");
  } catch (err) {
    if (err instanceof Error && err.message === "forged passkey signature was accepted") throw err;
    log(`forged passkey signature rejected ✓ (${err instanceof Error ? err.message : String(err)})`);
  }

  log("all smart-account checks passed");
}

main().catch((err) => {
  console.error("[smoke] FAILED", err);
  process.exit(1);
});
