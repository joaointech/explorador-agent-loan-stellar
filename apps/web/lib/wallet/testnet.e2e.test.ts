// The investor flow against the real testnet deployment, with a throwaway
// keypair standing in for Freighter: Friendbot → teurc.faucet → deposit →
// withdraw → "Max" (redeem everything). Skipped unless INVEST_E2E_APP_URL points at a
// running app (its GET /api/config names the contracts):
//
//   INVEST_E2E_APP_URL=http://localhost:3000 pnpm --filter web exec vitest run lib/wallet/testnet.e2e
//
// It moves €100 of test tEURC through the live pool and leaves only rounding dust.

import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import type { ConfigResponse, DeploymentInfo } from "../types/api";
import { STROOPS_PER_EUR } from "../units";
import { FAUCET_AMOUNT } from "./constants";
import { fundWithFriendbot, getTestEurc } from "./faucet";
import { deposit, previewDeposit, previewWithdraw, readLivePosition, withdraw, withdrawMax, type PoolSigner } from "./pool";
import { getRpc } from "./soroban";
import { keypairSigner } from "./testing/mock-rpc";

const APP_URL = process.env.INVEST_E2E_APP_URL;
const EUR = STROOPS_PER_EUR;

describe.skipIf(!APP_URL)("investor flow on testnet", () => {
  it(
    "funds, deposits, withdraws and redeems with client-side transactions",
    async () => {
      const config = (await (await fetch(`${APP_URL}/api/config`)).json()) as ConfigResponse;
      const deployment = config.deployment as DeploymentInfo;
      expect(deployment, "the app has no deployment").toBeTruthy();

      const kp = Keypair.random();
      const me = kp.publicKey();
      const phases: string[] = [];
      const signer: PoolSigner = {
        rpc: getRpc(deployment.rpcUrl),
        deployment,
        source: me,
        sign: keypairSigner(kp),
        onPhase: (phase) => phases.push(phase),
      };

      expect((await fundWithFriendbot(me)).status).toBe("funded");

      const faucet = await getTestEurc({ signer });
      expect(faucet.via).toBe("freighter");
      let live = await readLivePosition(signer, me);
      expect(live.teurc).toBe(FAUCET_AMOUNT);
      expect(live.shares).toBe(0n);
      expect(live.xlm).toBeGreaterThan(0n);

      const quoted = await previewDeposit(signer, 100n * EUR);
      const dep = await deposit(signer, 100n * EUR);
      expect(dep.txHash).toMatch(/^[0-9a-f]{64}$/);
      // Interest accrues between the quote and the deposit: never more shares than quoted.
      expect(dep.shares).toBeGreaterThan(0n);
      expect(dep.shares <= quoted).toBe(true);
      live = await readLivePosition(signer, me);
      expect(live.shares).toBe(dep.shares);
      expect(live.teurc).toBe(FAUCET_AMOUNT - 100n * EUR);
      expect(live.value <= 100n * EUR).toBe(true);
      expect(live.value > 99n * EUR).toBe(true);

      const burnQuote = await previewWithdraw(signer, 40n * EUR);
      const wd = await withdraw(signer, 40n * EUR);
      expect(wd.shares > 0n && wd.shares <= burnQuote).toBe(true);
      live = await readLivePosition(signer, me);
      expect(live.teurc).toBe(FAUCET_AMOUNT - 60n * EUR);

      // "Max": liquidity allows a full exit here, so every share is redeemed.
      const out = await withdrawMax(signer, EUR);
      expect(out.shares).toBe(live.shares);
      expect(out.assets > 59n * EUR).toBe(true);
      live = await readLivePosition(signer, me);
      expect(live.shares).toBe(0n);
      expect(FAUCET_AMOUNT - live.teurc < 1n * EUR).toBe(true);

      expect(phases.slice(0, 4)).toEqual(["preparing", "signing", "submitting", "confirming"]);
    },
    240_000,
  );
});
