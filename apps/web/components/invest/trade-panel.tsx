"use client";
import * as React from "react";
import type { InvestorPreviewResponse, InvestorResponse, PoolStatsResponse } from "@/lib/api-types";
import { ErrorNote, TxLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, errorMessage } from "@/lib/client/api";
import { runInvestorTx } from "@/lib/client/freighter";
import { formatStroops } from "@/lib/format";
import { parseEurInput } from "@/components/agent/money";
import { formatShares } from "./wallet-panel";

type Tab = "deposit" | "withdraw";

/** Floors stroops to whole cents and prints them as an input value ("1234.56"). */
function toInput(stroops: bigint): string {
  const cents = stroops / 100_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function usePreview(action: "deposit" | "withdraw" | "redeem", amount: bigint | null) {
  const [result, setResult] = React.useState<InvestorPreviewResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    setResult(null);
    if (amount === null || amount <= 0n) return;
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await apiGet<InvestorPreviewResponse>(`/api/investor/preview?action=${action}&amount=${amount.toString()}`);
        if (!cancelled) setResult(r);
      } catch {
        if (!cancelled) setResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [action, amount]);
  return { result, loading };
}

export function TradePanel({
  address,
  canSign,
  investor,
  pool,
  onDone,
}: {
  address: string | null;
  canSign: boolean;
  investor: InvestorResponse | null;
  pool: PoolStatsResponse | null;
  onDone: () => void;
}) {
  const [tab, setTab] = React.useState<Tab>("deposit");
  return (
    <Card className="p-5 sm:p-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="deposit">Deposit</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
          </TabsList>
          <div className="text-right text-xs text-muted">
            Available liquidity now
            <span className="block text-sm font-bold tabular-nums text-ink">{pool ? formatStroops(pool.stats.lendable) : "—"}</span>
          </div>
        </div>
        <TabsContent value="deposit" className="mt-4">
          <TradeForm key="deposit" kind="deposit" address={address} canSign={canSign} investor={investor} onDone={onDone} />
        </TabsContent>
        <TabsContent value="withdraw" className="mt-4">
          <TradeForm key="withdraw" kind="withdraw" address={address} canSign={canSign} investor={investor} onDone={onDone} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function TradeForm({
  kind,
  address,
  canSign,
  investor,
  onDone,
}: {
  kind: Tab;
  address: string | null;
  canSign: boolean;
  investor: InvestorResponse | null;
  onDone: () => void;
}) {
  const [text, setText] = React.useState("");
  const [all, setAll] = React.useState(false); // "Max" on withdraw redeems every share (no dust left)
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tx, setTx] = React.useState<string | null>(null);

  const max = investor ? BigInt(kind === "deposit" ? investor.teurcBalance : investor.maxWithdraw) : 0n;
  const maxRedeem = investor ? BigInt(investor.maxRedeem) : 0n;
  const parsed = parseEurInput(text);
  const useRedeem = kind === "withdraw" && all && maxRedeem > 0n;
  const action = kind === "deposit" ? "deposit" : useRedeem ? "redeem" : "withdraw";
  const amount = useRedeem ? maxRedeem : parsed;
  const preview = usePreview(action, amount);

  const tooMuch = !useRedeem && parsed !== null && parsed > max;
  const valid = !!address && canSign && amount !== null && amount > 0n && !tooMuch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !address || amount === null) return;
    setBusy(true);
    setError(null);
    setTx(null);
    try {
      const r = await runInvestorTx(action, address, amount.toString());
      setTx(r.hash);
      setText("");
      setAll(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  let previewText: string | null = null;
  if (preview.result) {
    if (action === "deposit") previewText = `You receive ≈ ${formatShares(preview.result.result)} eaSR`;
    else if (action === "withdraw") previewText = `Burns ≈ ${formatShares(preview.result.result)} eaSR`;
    else previewText = `Redeems all ${formatShares(maxRedeem.toString())} eaSR for ≈ ${formatStroops(preview.result.result)}`;
  }

  return (
    <form onSubmit={submit}>
      <Label htmlFor={`${kind}-amount`}>{kind === "deposit" ? "Amount to deposit (tEURC)" : "Amount to withdraw (tEURC)"}</Label>
      <div className="flex gap-2">
        <Input
          id={`${kind}-amount`}
          inputMode="decimal"
          placeholder="0.00"
          value={text}
          onChange={(e) => {
            setText(e.target.value.replace(/[^\d.]/g, ""));
            setAll(false);
          }}
          disabled={!address}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!investor || max <= 0n}
          onClick={() => {
            setText(toInput(max));
            setAll(kind === "withdraw");
          }}
        >
          Max
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>
          {kind === "deposit" ? "Wallet balance" : "Max withdraw now"}: <span className="font-semibold tabular-nums text-ink">{investor ? formatStroops(max) : "—"}</span>
        </span>
        <span className="tabular-nums">{preview.loading ? "Previewing…" : previewText}</span>
      </div>
      {tooMuch && (
        <ErrorNote className="mt-3">
          {kind === "deposit"
            ? "That is more tEURC than your wallet holds."
            : "That is more than you can withdraw right now — part of the pool is lent to agents and comes back as deals settle."}
        </ErrorNote>
      )}
      <Button type="submit" size="lg" className="mt-4 w-full" disabled={!valid} loading={busy}>
        {kind === "deposit" ? "Deposit" : "Withdraw"} {amount && amount > 0n && !useRedeem ? formatStroops(amount) : ""} →
      </Button>
      <p className="mt-2 text-center text-xs text-muted">
        {address ? (canSign ? "You will confirm in Freighter." : "Switch Freighter to Testnet to continue.") : "Connect Freighter to continue."}
      </p>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      {tx && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
          Done. <TxLink hash={tx} label="View transaction" />
        </p>
      )}
    </form>
  );
}
