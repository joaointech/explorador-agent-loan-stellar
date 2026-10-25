"use client";

import { useState } from "react";

import { formatEur } from "@/lib/format";
import type { ConfigResponse, DeploymentInfo, InvestorResponse, PoolSnapshotsResponse, PoolStatsResponse } from "@/lib/types/api";
import { TESTNET_PASSPHRASE } from "@/lib/wallet/constants";
import { WalletError } from "@/lib/wallet/errors";
import { freighterSigner } from "@/lib/wallet/freighter";
import type { PoolClient, PoolSigner } from "@/lib/wallet/pool";
import { useFreighter } from "@/lib/wallet/use-freighter";

import { formatShares } from "./format";
import { InvestView } from "./invest-view";
import type { DeploymentState, InvestActions, InvestModel, OnPhase, SnapshotRange } from "./model";
import { ApiRequestError, getJson, useResource } from "./use-resource";

// The live /invest dashboard: wires GET /api/config, /api/pool/stats,
// /api/pool/snapshots and /api/investor/[address], Freighter, and live
// contract reads/writes (lib/wallet) into InvestView. The Stellar SDK is
// loaded on demand, so the first paint doesn't wait for it.

const loadPool = () => import("@/lib/wallet/pool");
const loadRpc = async (rpcUrl: string) => (await import("@/lib/wallet/soroban")).getRpc(rpcUrl);

async function fetchConfig(): Promise<ConfigResponse> {
  try {
    return await getJson<ConfigResponse>("/api/config");
  } catch (err) {
    // No config route (yet) means nothing is deployed for this app.
    if (err instanceof ApiRequestError && err.status === 404) return { deployment: null, demoMode: false, lithicEnabled: false };
    throw err;
  }
}

export function InvestDashboard() {
  const freighter = useFreighter();
  const [range, setRange] = useState<SnapshotRange>("7d");

  // Re-read now and then: a demo reset redeploys the contracts under new ids.
  const config = useResource("config", fetchConfig, { intervalMs: 60_000 });
  const deployed: DeploymentInfo | null = config.data?.deployment ?? null;
  const deployment: DeploymentState = config.data
    ? deployed
      ? { status: "ready", deployment: deployed }
      : { status: "not-deployed" }
    : config.error
      ? { status: "error", message: config.error }
      : { status: "loading" };

  const expectedPassphrase = deployed?.networkPassphrase ?? TESTNET_PASSPHRASE;
  const connectedAddress = freighter.status === "connected" ? freighter.address : null;
  const wrongNetwork = freighter.status === "connected" && freighter.network?.passphrase !== expectedPassphrase;
  const pool = deployed?.advancePool ?? null;

  const stats = useResource(pool && `stats:${pool}`, () => getJson<PoolStatsResponse>("/api/pool/stats"), { intervalMs: 30_000 });
  const snapshots = useResource(pool && `snapshots:${pool}:${range}`, () => getJson<PoolSnapshotsResponse>(`/api/pool/snapshots?range=${range}`), {
    intervalMs: 60_000,
    keepPrevious: true,
  });
  const investorKey = pool && connectedAddress ? `${pool}:${connectedAddress}` : null;
  const investor = useResource(investorKey && `investor:${investorKey}`, () => getJson<InvestorResponse>(`/api/investor/${connectedAddress}`), {
    intervalMs: 30_000,
  });
  const live = useResource(
    investorKey && `live:${investorKey}`,
    async () => {
      if (!deployed || !connectedAddress) throw new Error("not connected");
      const { readLivePosition } = await loadPool();
      return readLivePosition({ rpc: await loadRpc(deployed.rpcUrl), deployment: deployed }, connectedAddress);
    },
    { intervalMs: 30_000 },
  );

  const refreshAccount = () => Promise.all([live.refresh(), investor.refresh()]);
  /** After a transaction: live reads now, the indexed APIs again once the indexer has caught up. */
  const refreshAfterTx = () => {
    void refreshAccount();
    void stats.refresh();
    setTimeout(() => {
      void refreshAccount();
      void stats.refresh();
      void snapshots.refresh();
    }, 6_000);
  };

  const client = async (): Promise<PoolClient> => {
    if (!deployed) throw new WalletError("WALLET_ERROR", "The pool isn't deployed yet.");
    return { rpc: await loadRpc(deployed.rpcUrl), deployment: deployed };
  };

  const signer = async (onPhase: OnPhase): Promise<PoolSigner> => {
    if (!deployed) throw new WalletError("WALLET_ERROR", "The pool isn't deployed yet.");
    if (!connectedAddress) throw new WalletError("WALLET_ERROR", "Connect Freighter first.");
    if (wrongNetwork) throw new WalletError("WRONG_NETWORK", "Switch Freighter to Testnet first.");
    return { ...(await client()), source: connectedAddress, sign: freighterSigner, onPhase };
  };

  const actions: InvestActions = {
    connect: () => void freighter.connect(),
    disconnect: freighter.disconnect,
    recheckWallet: () => void freighter.recheck(),
    retry: () => {
      void config.refresh();
      void stats.refresh();
      void snapshots.refresh();
      void refreshAccount();
    },
    setRange,
    fundXlm: async (onPhase) => {
      if (!connectedAddress) throw new WalletError("WALLET_ERROR", "Connect Freighter first.");
      const { fundWithFriendbot } = await import("@/lib/wallet/faucet");
      onPhase("submitting");
      const res = await fundWithFriendbot(connectedAddress);
      void live.refresh();
      return res.status === "funded"
        ? { message: "Friendbot sent 10,000 test XLM to your account.", txHash: res.txHash }
        : { message: "Your account already has test XLM.", txHash: null };
    },
    getTeurc: async (onPhase) => {
      const s = await signer(onPhase);
      const { getTestEurc } = await import("@/lib/wallet/faucet");
      const res = await getTestEurc({ signer: s, onFallback: () => onPhase("fallback") });
      refreshAfterTx();
      return {
        message: res.via === "freighter" ? "10,000 tEURC minted to your wallet." : "The server faucet sent 10,000 tEURC to your wallet.",
        txHash: res.txHash,
      };
    },
    deposit: async (assets, onPhase) => {
      const s = await signer(onPhase);
      const res = await (await loadPool()).deposit(s, assets);
      refreshAfterTx();
      return { message: `Deposited ${formatEur(res.assets)} and received ${formatShares(res.shares)}.`, txHash: res.txHash };
    },
    withdraw: async (assets, onPhase) => {
      const s = await signer(onPhase);
      const res = await (await loadPool()).withdraw(s, assets);
      refreshAfterTx();
      return { message: `Withdrew ${formatEur(res.assets)}; ${formatShares(res.shares)} burned.`, txHash: res.txHash };
    },
    redeem: async (shares, onPhase) => {
      const s = await signer(onPhase);
      const res = await (await loadPool()).redeem(s, shares);
      refreshAfterTx();
      return { message: `Withdrew ${formatEur(res.assets)} for ${formatShares(res.shares)}.`, txHash: res.txHash };
    },
    previewDeposit: async (assets) => (await loadPool()).previewDeposit(await client(), assets),
    previewWithdraw: async (assets) => (await loadPool()).previewWithdraw(await client(), assets),
  };

  const model: InvestModel = {
    deployment,
    wallet: {
      status: freighter.status,
      address: freighter.address,
      network: freighter.network,
      error: freighter.error,
      expectedPassphrase,
      wrongNetwork,
    },
    stats,
    snapshots,
    range,
    investor,
    live,
  };

  return <InvestView model={model} actions={actions} />;
}
