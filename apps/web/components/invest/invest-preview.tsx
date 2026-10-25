"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/components/ui/cn";
import { formatEur } from "@/lib/format";
import { TESTNET_PASSPHRASE } from "@/lib/wallet/constants";
import type { LivePosition } from "@/lib/wallet/pool";

import {
  FIXTURE_DEPLOYMENT,
  FIXTURE_INVESTOR,
  fixtureEmptyInvestor,
  fixtureInvestor,
  fixtureLive,
  fixturePreviewDeposit,
  fixturePreviewWithdraw,
  fixtureSnapshots,
  fixtureStats,
} from "./fixtures";
import { formatShares } from "./format";
import { InvestView } from "./invest-view";
import { remote, type ActionResult, type InvestActions, type InvestModel, type OnPhase, type SnapshotRange, type WalletView } from "./model";
import { PREVIEW_STATES, type PreviewState } from "./preview-states";

// /invest/preview: every dashboard state rendered from fixtures, with
// simulated actions (nothing is signed or sent). For reviews, screenshots
// and the demo script when Freighter or the deployment isn't at hand.

const MAINNET = { network: "PUBLIC", passphrase: "Public Global Stellar Network ; September 2015" };
const TESTNET = { network: "TESTNET", passphrase: TESTNET_PASSPHRASE };

function walletFor(state: PreviewState): WalletView {
  const base = { expectedPassphrase: TESTNET_PASSPHRASE, error: null };
  switch (state) {
    case "no-wallet":
      return { ...base, status: "unavailable", address: null, network: null, wrongNetwork: false };
    case "disconnected":
    case "not-deployed":
    case "error":
      return { ...base, status: "disconnected", address: null, network: null, wrongNetwork: false };
    case "loading":
      return { ...base, status: "checking", address: null, network: null, wrongNetwork: false };
    case "wrong-network":
      return { ...base, status: "connected", address: FIXTURE_INVESTOR, network: MAINNET, wrongNetwork: true };
    default:
      return { ...base, status: "connected", address: FIXTURE_INVESTOR, network: TESTNET, wrongNetwork: false };
  }
}

export function previewModel(state: PreviewState, range: SnapshotRange = "7d"): InvestModel {
  const wallet = walletFor(state);
  const deployment =
    state === "not-deployed"
      ? ({ status: "not-deployed" } as const)
      : state === "loading"
        ? ({ status: "loading" } as const)
        : state === "error"
          ? ({ status: "error", message: "HTTP 502" } as const)
          : ({ status: "ready", deployment: FIXTURE_DEPLOYMENT } as const);
  const deployed = deployment.status === "ready";
  const connected = wallet.status === "connected";
  const empty = state === "connected-empty" || state === "unfunded";
  const live: LivePosition | undefined = connected && deployed ? fixtureLive({ empty, unfunded: state === "unfunded" }) : undefined;
  return {
    deployment,
    wallet,
    stats: remote(deployed ? fixtureStats() : undefined),
    snapshots: remote(deployed ? fixtureSnapshots(range) : undefined),
    range,
    investor: remote(connected && deployed ? (empty ? fixtureEmptyInvestor() : fixtureInvestor()) : undefined),
    live: remote(live),
    pendingFlows: [],
  };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Walks through the phases like a real transaction, then reports that nothing was sent. */
async function simulate(onPhase: OnPhase, message: string): Promise<ActionResult> {
  for (const phase of ["preparing", "signing", "submitting", "confirming"] as const) {
    onPhase(phase);
    await pause(450);
  }
  return { message: `${message} (Preview: nothing was signed or sent.)`, txHash: null };
}

export function previewActions(go: (state: PreviewState) => void, setRange: (r: SnapshotRange) => void): InvestActions {
  return {
    connect: () => go("connected-position"),
    disconnect: () => go("disconnected"),
    recheckWallet: () => go("disconnected"),
    retry: () => go("connected-position"),
    setRange,
    fundXlm: (onPhase) => simulate(onPhase, "Friendbot would send 10,000 test XLM."),
    getTeurc: (onPhase) => simulate(onPhase, "10,000 tEURC would be minted to your wallet."),
    deposit: (assets, onPhase) => simulate(onPhase, `Deposited ${formatEur(assets)} for ${formatShares(fixturePreviewDeposit(assets))}.`),
    withdraw: (assets, onPhase) => simulate(onPhase, `Withdrew ${formatEur(assets)}; ${formatShares(fixturePreviewWithdraw(assets))} burned.`),
    withdrawMax: (onPhase) => simulate(onPhase, `Withdrew ${formatEur(fixtureLive().maxWithdraw)} for ${formatShares(fixtureLive().maxRedeem)}.`),
    previewDeposit: async (assets) => {
      await pause(250);
      return fixturePreviewDeposit(assets);
    },
    previewWithdraw: async (assets) => {
      await pause(250);
      return fixturePreviewWithdraw(assets);
    },
  };
}

export function InvestPreview({ state }: { state: PreviewState }) {
  const router = useRouter();
  const [range, setRange] = useState<SnapshotRange>("7d");
  const go = (next: PreviewState) => router.replace(`/invest/preview?state=${next}`, { scroll: false });
  return (
    <>
      <nav aria-label="Preview states" className="border-b border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
          <p className="flex shrink-0 items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
            <FlaskConical aria-hidden className="size-4" /> Preview with mocked data
          </p>
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
            {PREVIEW_STATES.map((p) => (
              <li key={p.id} className="shrink-0">
                <Link
                  href={`/invest/preview?state=${p.id}`}
                  scroll={false}
                  replace
                  aria-current={p.id === state ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition-colors",
                    p.id === state
                      ? "bg-amber-500 text-amber-950 ring-amber-500"
                      : "bg-white/70 text-amber-900 ring-amber-300 hover:bg-white dark:bg-transparent dark:text-amber-100 dark:ring-amber-500/40",
                  )}
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <InvestView model={previewModel(state, range)} actions={previewActions(go, setRange)} />
    </>
  );
}
