"use client";

import { Coins, Droplets, PlugZap, RefreshCw, TriangleAlert, Wallet } from "lucide-react";

import { Address } from "@/components/ui/address";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { FREIGHTER_INSTALL_URL } from "@/lib/wallet/constants";
import { networkName } from "@/lib/wallet/freighter";

import { formatBalance, formatShares } from "./format";
import type { InvestActions, PositionView, WalletView } from "./model";
import { TxStatus, useTx } from "./tx-status";

type WalletActions = Pick<InvestActions, "connect" | "disconnect" | "recheckWallet" | "fundXlm" | "getTeurc">;

function Balance({ label, hint, value, loading, warn }: { label: string; hint: string; value: string; loading?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
      <dt className="min-w-0">
        <span className="font-semibold text-heading">{label}</span> <span className="text-muted">{hint}</span>
      </dt>
      {loading ? (
        <Skeleton className="h-4 w-20" />
      ) : (
        <dd className={cn("shrink-0 font-semibold tabular-nums", warn ? "text-amber-700 dark:text-amber-400" : "text-heading")}>{value}</dd>
      )}
    </div>
  );
}

/** Connection, balances and the testnet helpers ("Get test XLM", "Get 10,000 tEURC"). */
export function WalletCard({
  wallet,
  position,
  liveLoading,
  deployed,
  explorerBase,
  actions,
  className,
}: {
  wallet: WalletView;
  position: PositionView;
  liveLoading: boolean;
  deployed: boolean;
  explorerBase?: string;
  actions: WalletActions;
  className?: string;
}) {
  const toast = useToast();
  const xlmTx = useTx();
  const eurcTx = useTx();
  const helperState = eurcTx.state.status !== "idle" ? eurcTx.state : xlmTx.state;
  const busy = xlmTx.pending || eurcTx.pending;

  const fundXlm = async () => {
    eurcTx.reset();
    const res = await xlmTx.run(actions.fundXlm);
    if (res) toast.success("Test XLM ready", { description: res.message });
  };
  const getTeurc = async () => {
    xlmTx.reset();
    const res = await eurcTx.run(actions.getTeurc);
    if (res) toast.success("10,000 tEURC on the way", { description: res.message });
  };

  if (wallet.status === "checking") {
    return (
      <Card aria-busy className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </Card>
    );
  }

  if (wallet.status === "unavailable") {
    return (
      <Card className={className}>
        <CardHeader
          eyebrow="Your wallet"
          title="Freighter isn't installed"
          description="explorador advance uses Freighter, the Stellar Development Foundation's browser wallet, to sign deposits and withdrawals on testnet."
        />
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button href={FREIGHTER_INSTALL_URL} external arrow icon={<Wallet className="size-4" />}>
            Install Freighter
          </Button>
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={actions.recheckWallet}>
            I&apos;ve installed it
          </Button>
        </div>
      </Card>
    );
  }

  if (wallet.status === "disconnected" || wallet.status === "connecting") {
    const connecting = wallet.status === "connecting";
    return (
      <Card className={className}>
        <CardHeader
          eyebrow="Your wallet"
          title="Connect Freighter"
          description="Connect your Freighter wallet (Stellar testnet) to get test funds, deposit into the senior vault and follow your position."
        />
        <div className="mt-5 flex flex-col gap-3">
          <Button arrow loading={connecting} icon={<PlugZap className="size-4" />} onClick={actions.connect} fullWidth>
            {connecting ? "Approve in Freighter" : "Connect Freighter"}
          </Button>
          {wallet.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {wallet.error}
            </p>
          )}
        </div>
      </Card>
    );
  }

  // connected
  const unfunded = position.xlm === null;
  return (
    <Card className={className}>
      <CardHeader
        eyebrow="Your wallet"
        title={wallet.address ? <Address address={wallet.address} head={6} tail={6} label="your account" explorerBase={explorerBase} /> : "Connected"}
        action={
          wallet.wrongNetwork ? (
            <Badge tone="amber" dot>
              {networkName(wallet.network)}
            </Badge>
          ) : (
            <Badge tone="emerald" dot>
              Testnet
            </Badge>
          )
        }
      />

      {wallet.wrongNetwork ? (
        <div role="alert" className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <TriangleAlert aria-hidden className="mt-0.5 size-[18px] shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold">Switch Freighter to Testnet</p>
            <p className="mt-1 leading-relaxed">
              Freighter is on {networkName(wallet.network)}. explorador advance runs on Stellar testnet: open Freighter, choose{" "}
              <span className="font-semibold">Testnet</span> in its network menu, and this page updates by itself.
            </p>
          </div>
        </div>
      ) : (
        <>
          <dl className="mt-4 divide-y divide-line rounded-xl bg-card-muted ring-1 ring-line">
            <Balance
              label="XLM"
              hint="network fees"
              value={unfunded ? "Not funded yet" : formatBalance(position.xlm, "")}
              loading={liveLoading && position.xlm === undefined}
              warn={unfunded}
            />
            <Balance label="tEURC" hint="to invest" value={formatBalance(position.teurc, "")} loading={liveLoading && position.teurc === null} />
            <Balance label="eaSR" hint="vault shares" value={formatShares(position.shares, false)} loading={liveLoading && position.shares === null} />
          </dl>

          {unfunded && (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              New testnet accounts need a little XLM for network fees. Friendbot sends 10,000 test XLM for free.
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              variant={unfunded ? "primary" : "secondary"}
              size="sm"
              icon={<Droplets className="size-4" />}
              loading={xlmTx.pending}
              disabled={busy}
              onClick={fundXlm}
              className="sm:flex-1"
            >
              Get test XLM
            </Button>
            <Button
              variant={!unfunded && (position.teurc ?? 0n) === 0n && deployed ? "primary" : "secondary"}
              size="sm"
              icon={<Coins className="size-4" />}
              loading={eurcTx.pending}
              disabled={busy || !deployed}
              onClick={getTeurc}
              className="sm:flex-1"
            >
              Get 10,000 tEURC
            </Button>
          </div>
          {!deployed && <p className="mt-2 text-xs text-muted">tEURC is available once the pool is deployed.</p>}
          <TxStatus
            state={helperState}
            explorerBase={explorerBase}
            onDismiss={() => {
              xlmTx.reset();
              eurcTx.reset();
            }}
            className="mt-3"
          />
        </>
      )}

      <div className="mt-4 flex justify-end border-t border-line pt-3">
        <button
          type="button"
          onClick={actions.disconnect}
          className="-my-2 min-h-11 px-2 text-sm font-medium text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          Disconnect
        </button>
      </div>
    </Card>
  );
}
