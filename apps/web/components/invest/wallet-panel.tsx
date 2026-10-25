"use client";
import * as React from "react";
import { Coins, Droplets, ExternalLink, LogOut, TriangleAlert, Wallet } from "lucide-react";
import type { InvestorResponse, TxResponse } from "@/lib/api-types";
import { Address, ErrorNote, TxLink } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiPost, errorMessage } from "@/lib/client/api";
import { FreighterError, friendbot, runInvestorTx } from "@/lib/client/freighter";
import { formatDateTime, formatNumber, formatStroops, stroopsToEur } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WalletState } from "./wallet";

const FAUCET_AMOUNT = "100000000000"; // 10,000 tEURC (7 decimals)

export function formatShares(s: string | null | undefined): string {
  return new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(stroopsToEur(s));
}

export function ConnectCard({ wallet }: { wallet: WalletState }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
          <Wallet className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Connect your Stellar wallet</h2>
          <p className="mt-1 text-sm text-muted">
            Investors use Freighter on Stellar testnet. You deposit tEURC (test euros) and receive eaSR shares in the senior tranche.
          </p>
        </div>
      </div>
      {wallet.installed === false ? (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <a href="https://freighter.app" target="_blank" rel="noreferrer">
              Install Freighter <ExternalLink />
            </a>
          </Button>
          <Button variant="secondary" onClick={() => void wallet.recheck()}>
            I installed it
          </Button>
        </div>
      ) : (
        <Button className="mt-5 w-full sm:w-auto" onClick={() => void wallet.connect()} loading={wallet.connecting} disabled={wallet.installed === null}>
          Connect Freighter →
        </Button>
      )}
      {wallet.error && <ErrorNote className="mt-3">{wallet.error}</ErrorNote>}
    </Card>
  );
}

export function NetworkWarning({ wallet }: { wallet: WalletState }) {
  if (!wallet.address || !wallet.network || wallet.network.isTestnet) return null;
  return (
    <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <TriangleAlert className="mt-0.5 size-5 shrink-0" />
      <div>
        <p className="font-bold">Freighter is on {wallet.network.network || "another network"}</p>
        <p className="mt-0.5">
          Open Freighter → Settings → Network and switch to <strong>Testnet</strong>, then{" "}
          <button className="font-semibold underline" onClick={() => void wallet.recheck()}>
            check again
          </button>
          .
        </p>
      </div>
    </div>
  );
}

export function PositionCard({
  wallet,
  investor,
  loading,
  onChanged,
}: {
  wallet: WalletState;
  investor: InvestorResponse | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<null | "xlm" | "teurc">(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const address = wallet.address!;
  const earned = investor ? BigInt(investor.earned) : 0n;
  const needsXlm = investor ? !investor.funded || Number(investor.xlmBalance ?? "0") < 5 : false;

  async function getXlm() {
    setBusy("xlm");
    setMsg(null);
    try {
      await friendbot(address);
      setMsg({ ok: true, text: "10,000 test XLM sent by Friendbot." });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function getTeurc() {
    setBusy("teurc");
    setMsg(null);
    try {
      let tx: string | undefined;
      try {
        tx = (await runInvestorTx("faucet", address, FAUCET_AMOUNT)).hash;
      } catch (e) {
        if (e instanceof FreighterError && (e.code === "REJECTED" || e.code === "WRONG_NETWORK")) throw e;
        // Fall back to the server-side faucet (e.g. the account has no XLM for fees yet).
        tx = (await apiPost<Partial<TxResponse>>("/api/faucet/teurc", { address })).txHash;
      }
      setMsg({ ok: true, text: "10,000 tEURC on its way.", tx });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <p className="eyebrow">Your position</p>
          {wallet.network &&
            (wallet.network.isTestnet ? <Badge tone="emerald">Testnet</Badge> : <Badge tone="amber">{wallet.network.network || "Wrong network"}</Badge>)}
        </div>
        <div className="flex items-center gap-2">
          <Address value={address} />
          <Button variant="ghost" size="icon" aria-label="Disconnect wallet" onClick={wallet.disconnect}>
            <LogOut />
          </Button>
        </div>
      </div>

      {!investor ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-16 rounded-2xl", !loading && "animate-none")} />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Current value" value={formatStroops(investor.value)} big />
            <Figure label="Shares" value={`${formatShares(investor.shares)} eaSR`} />
            <Figure label="Deposited" value={formatStroops(BigInt(investor.deposited) - BigInt(investor.withdrawn))} hint="net of withdrawals" />
            <Figure
              label="Earned"
              value={`${earned > 0n ? "+" : ""}${formatStroops(earned)}`}
              valueClassName={earned > 0n ? "text-emerald-600 dark:text-emerald-400" : undefined}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span>
              Share price <span className="font-semibold tabular-nums text-ink">{investor.sharePrice.toFixed(6)}</span> tEURC
            </span>
            <span>
              Wallet <span className="font-semibold tabular-nums text-ink">{formatStroops(investor.teurcBalance)}</span> tEURC
            </span>
            <span>
              <span className="font-semibold tabular-nums text-ink">{investor.xlmBalance ? formatNumber(Number(investor.xlmBalance)) : "0"}</span> XLM
            </span>
          </div>
        </>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" variant={needsXlm ? "primary" : "secondary"} onClick={getXlm} loading={busy === "xlm"} disabled={busy !== null}>
          <Droplets /> Get test XLM
        </Button>
        <Button size="sm" variant={!needsXlm && investor && BigInt(investor.teurcBalance) === 0n ? "primary" : "secondary"} onClick={getTeurc} loading={busy === "teurc"} disabled={busy !== null}>
          <Coins /> Get 10,000 tEURC
        </Button>
      </div>
      {msg &&
        (msg.ok ? (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
            {msg.text} {msg.tx && <TxLink hash={msg.tx} label="View transaction" />}
          </p>
        ) : (
          <ErrorNote className="mt-3">{msg.text}</ErrorNote>
        ))}

      {investor && investor.history.length > 0 && (
        <details className="group mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">History ({investor.history.length})</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {investor.history.map((h) => (
              <li key={h.txHash + h.type} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <span className="font-semibold capitalize">{h.type}</span>{" "}
                  <span className="tabular-nums">{formatStroops(h.assets)}</span>
                  <span className="block text-xs text-muted">
                    {formatShares(h.shares)} eaSR · {formatDateTime(h.createdAt)}
                  </span>
                </div>
                <TxLink hash={h.txHash} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Figure({ label, value, hint, big, valueClassName }: { label: string; value: string; hint?: string; big?: boolean; valueClassName?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-warm px-3 py-2.5">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={cn("mt-0.5 truncate font-bold tabular-nums", big ? "text-xl" : "text-base", valueClassName)}>{value}</div>
      {hint && <div className="truncate text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
