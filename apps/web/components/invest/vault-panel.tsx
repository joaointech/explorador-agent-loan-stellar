"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { EMPTY_VALUE, explorerTxUrl, formatEur, formatSharePrice, parseEurToCents } from "@/lib/format";
import type { PoolStatsResponse } from "@/lib/types/api";
import { centsToStroops, STROOPS_PER_EUR } from "@/lib/units";
import { toWalletError } from "@/lib/wallet/errors";

import { formatBalance, formatEurLimit, formatShares } from "./format";
import { stroopsToEurInput, type InvestActions, type PositionView, type WalletView } from "./model";
import { TxStatus, useTx } from "./tx-status";

type Mode = "deposit" | "withdraw";
type PanelActions = Pick<InvestActions, "connect" | "deposit" | "withdraw" | "redeem" | "previewDeposit" | "previewWithdraw">;

const QUICK_DEPOSITS = [1_000n, 5_000n];

interface Preview {
  key: string;
  shares: bigint | null;
  error?: string;
}

function Chip({ children, pressed, onClick, disabled }: { children: ReactNode; pressed?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center rounded-full px-3 text-sm font-medium ring-1 transition-colors disabled:opacity-50",
        pressed ? "bg-primary-tint text-primary-text ring-primary/40" : "bg-card text-fg ring-line hover:bg-slate-50 dark:hover:bg-slate-800",
      )}
    >
      {children}
    </button>
  );
}

function SummaryRow({ label, value, loading }: { label: ReactNode; value: ReactNode; loading?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {loading ? <Skeleton className="h-4 w-24" /> : <span className="text-right font-medium text-heading tabular-nums">{value}</span>}
    </div>
  );
}

/** Deposit / Withdraw with live previews (preview_deposit, preview_withdraw, max_withdraw) and the pool's idle liquidity. */
export function VaultPanel({
  wallet,
  position,
  stats,
  deployed,
  explorerBase,
  actions,
  className,
}: {
  wallet: WalletView;
  position: PositionView;
  stats: PoolStatsResponse | undefined;
  deployed: boolean;
  explorerBase?: string;
  actions: PanelActions;
  className?: string;
}) {
  const toast = useToast();
  const tx = useTx();
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  /** "Max" on withdraw: redeem every withdrawable share (exact full exit, no dust). */
  const [useMax, setUseMax] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const cents = parseEurToCents(amount);
  const assets = cents !== null && cents > 0n ? centsToStroops(cents) : null;
  const lendable = stats ? BigInt(stats.stats.lendable) : null;
  const ready = deployed && wallet.status === "connected" && !wallet.wrongNetwork && position.xlm !== null;

  let invalid: string | null = null;
  if (mode === "deposit" && assets !== null && position.teurc !== null && assets > position.teurc) {
    invalid = position.teurc === 0n ? "You have no tEURC yet: use “Get 10,000 tEURC”." : "That's more than your tEURC balance.";
  }
  if (mode === "withdraw" && !useMax && assets !== null && position.maxWithdraw !== null && assets > position.maxWithdraw) {
    const capped = position.value !== null && position.maxWithdraw < position.value;
    invalid = capped ? "More than the pool can pay out right now (idle liquidity)." : "That's more than your position.";
  }

  // Quotes only need the RPC, so visitors see them before connecting a wallet.
  const previewKey = deployed && assets !== null && !invalid && !useMax ? `${mode}:${assets}` : null;

  const fetchPreview = useEffectEvent(async (key: string, kind: Mode, value: bigint) => {
    try {
      const shares = kind === "deposit" ? await actions.previewDeposit(value) : await actions.previewWithdraw(value);
      setPreview({ key, shares });
    } catch (err) {
      setPreview({ key, shares: null, error: toWalletError(err).message });
    }
  });

  useEffect(() => {
    if (previewKey === null || assets === null) return;
    const timer = setTimeout(() => void fetchPreview(previewKey, mode, assets), 350);
    return () => clearTimeout(timer);
  }, [previewKey, mode, assets]);

  const current = preview && preview.key === previewKey ? preview : null;

  const switchMode = (next: string) => {
    if (tx.pending) return;
    setMode(next as Mode);
    setAmount("");
    setUseMax(false);
    tx.reset();
  };

  const setEuros = (value: string) => {
    setAmount(value);
    setUseMax(false);
  };

  const submit = async () => {
    if (!ready) return;
    const redeemShares = position.maxRedeem;
    let result = null;
    if (mode === "deposit") {
      if (assets !== null) result = await tx.run((onPhase) => actions.deposit(assets, onPhase));
    } else if (useMax) {
      if (redeemShares !== null && redeemShares > 0n) result = await tx.run((onPhase) => actions.redeem(redeemShares, onPhase));
    } else if (assets !== null) {
      result = await tx.run((onPhase) => actions.withdraw(assets, onPhase));
    }
    if (!result) return;
    setAmount("");
    setUseMax(false);
    toast.success(mode === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed", {
      description: result.message,
      action: result.txHash ? { label: "View transaction", href: explorerTxUrl(result.txHash, explorerBase) } : undefined,
    });
  };

  // What the primary button says (and does) while the wallet isn't ready.
  const gate: { label: string; onClick?: () => void } | null = !deployed
    ? { label: "Pool not deployed yet" }
    : wallet.status === "checking"
      ? { label: "Looking for Freighter…" }
      : wallet.status === "unavailable"
        ? { label: "Install Freighter to deposit" }
        : wallet.status === "connecting"
          ? { label: "Approve the connection in Freighter…" }
          : wallet.status === "disconnected"
            ? { label: "Connect Freighter", onClick: actions.connect }
            : wallet.wrongNetwork
              ? { label: "Switch Freighter to Testnet" }
              : position.xlm === null
                ? { label: "Get test XLM first" }
                : null;

  const canSubmit =
    ready && !tx.pending && !invalid && (mode === "deposit" ? assets !== null : useMax ? (position.maxRedeem ?? 0n) > 0n : assets !== null);
  const label =
    mode === "deposit"
      ? assets !== null
        ? `Deposit ${formatEur(assets)}`
        : "Deposit"
      : useMax
        ? "Withdraw everything available"
        : assets !== null
          ? `Withdraw ${formatEur(assets)}`
          : "Withdraw";

  const sharePrice = stats ? formatSharePrice(stats.stats.sharePriceScaled, 6) : null;
  const previewValue = (shares: bigint | null | undefined) => (shares === null || shares === undefined ? EMPTY_VALUE : `≈ ${formatShares(shares)}`);

  const amountField = (hint: ReactNode) => (
    <Field label="Amount" hint={invalid ? undefined : hint} error={invalid ?? undefined}>
      <NumberInput value={amount} onValueChange={setEuros} decimals={2} prefix="€" placeholder="0.00" disabled={tx.pending} name="amount" />
    </Field>
  );

  return (
    <Card padding="lg" className={className}>
      <Tabs value={mode} onValueChange={switchMode}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-heading sm:text-lg">Senior vault</h3>
          <TabsList aria-label="Vault action">
            <TabsTrigger value="deposit">
              <ArrowDownToLine aria-hidden /> Deposit
            </TabsTrigger>
            <TabsTrigger value="withdraw">
              <ArrowUpFromLine aria-hidden /> Withdraw
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="deposit" className="mt-5 flex flex-col gap-4">
          {amountField(position.teurc !== null ? `Wallet balance: ${formatBalance(position.teurc, "tEURC")}` : "Amounts are in euros (1 tEURC = €1).")}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
            {QUICK_DEPOSITS.map((eur) => (
              <Chip key={String(eur)} pressed={amount === `${eur}.00` || amount === String(eur)} onClick={() => setEuros(`${eur}.00`)} disabled={tx.pending}>
                {formatEur(eur * STROOPS_PER_EUR, { decimals: 0 })}
              </Chip>
            ))}
            <Chip
              onClick={() => position.teurc !== null && setEuros(stroopsToEurInput(position.teurc))}
              disabled={tx.pending || position.teurc === null || position.teurc === 0n}
            >
              Max
            </Chip>
          </div>
          <div className="rounded-xl bg-card-muted px-4 py-2 ring-1 ring-line">
            <SummaryRow label="You receive" value={previewValue(current?.shares)} loading={previewKey !== null && current === null} />
            <SummaryRow label="Share price" value={sharePrice ? `${sharePrice} per eaSR` : EMPTY_VALUE} />
          </div>
        </TabsContent>

        <TabsContent value="withdraw" className="mt-5 flex flex-col gap-4">
          {amountField(position.maxWithdraw !== null ? `You can withdraw up to ${formatEurLimit(position.maxWithdraw)} now.` : "Amounts are in euros (1 tEURC = €1).")}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
            <Chip
              pressed={useMax}
              onClick={() => {
                if (position.maxWithdraw === null) return;
                setAmount(stroopsToEurInput(position.maxWithdraw));
                setUseMax(true);
              }}
              disabled={tx.pending || position.maxWithdraw === null || position.maxWithdraw === 0n}
            >
              Max
            </Chip>
          </div>
          <div className="rounded-xl bg-card-muted px-4 py-2 ring-1 ring-line">
            <SummaryRow
              label="Shares burned"
              value={useMax ? `${formatShares(position.maxRedeem)} (all withdrawable)` : previewValue(current?.shares)}
              loading={!useMax && previewKey !== null && current === null}
            />
            <SummaryRow label="Your shares" value={formatShares(position.shares)} />
          </div>
        </TabsContent>
      </Tabs>

      {current?.error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{current.error}</p>}

      <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-4 text-sm">
        <span className="text-muted">Available liquidity now</span>
        <span className="font-semibold text-heading tabular-nums">{lendable !== null ? formatEur(lendable) : EMPTY_VALUE}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Idle tEURC the pool can pay out right now. There is no withdrawal queue: more frees up as agents repay at the escritura.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {gate ? (
          <Button fullWidth arrow={Boolean(gate.onClick)} disabled={!gate.onClick} onClick={gate.onClick}>
            {gate.label}
          </Button>
        ) : (
          <Button fullWidth arrow loading={tx.pending} disabled={!canSubmit} onClick={submit}>
            {label}
          </Button>
        )}
        <TxStatus state={tx.state} explorerBase={explorerBase} onDismiss={tx.pending ? undefined : tx.reset} />
      </div>
    </Card>
  );
}
