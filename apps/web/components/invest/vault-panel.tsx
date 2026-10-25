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
import { stroopsToEurInput, type ActionResult, type DeploymentState, type InvestActions, type PositionView, type WalletView } from "./model";
import { TxStatus, useTx } from "./tx-status";

type Mode = "deposit" | "withdraw";
type PanelActions = Pick<InvestActions, "connect" | "deposit" | "withdraw" | "withdrawMax" | "previewDeposit" | "previewWithdraw">;

const QUICK_DEPOSITS = [1_000n, 5_000n];
/** Quotes kept per amount (typing back and forth reuses them). */
const MAX_QUOTES = 20;

interface Quote {
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
  deployment,
  explorerBase,
  actions,
  className,
}: {
  wallet: WalletView;
  position: PositionView;
  stats: PoolStatsResponse | undefined;
  deployment: DeploymentState["status"];
  explorerBase?: string;
  actions: PanelActions;
  className?: string;
}) {
  const toast = useToast();
  const tx = useTx();
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  /** "Max" on withdraw: everything withdrawable now, decided from a fresh read when submitting. */
  const [useMax, setUseMax] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  const deployed = deployment === "ready";
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
  const quoteKey = deployed && assets !== null && !invalid && !useMax ? `${mode}:${assets}` : null;

  const fetchQuote = useEffectEvent(async (key: string, kind: Mode, value: bigint) => {
    let quote: Quote;
    try {
      quote = { shares: kind === "deposit" ? await actions.previewDeposit(value) : await actions.previewWithdraw(value) };
    } catch (err) {
      quote = { shares: null, error: toWalletError(err).message };
    }
    // Keyed by amount, so a slow answer for an older amount can't stand in for the current one.
    setQuotes((q) => Object.fromEntries([...Object.entries(q).filter(([k]) => k !== key).slice(-(MAX_QUOTES - 1)), [key, quote]]));
  });

  useEffect(() => {
    if (quoteKey === null || assets === null) return;
    const timer = setTimeout(() => void fetchQuote(quoteKey, mode, assets), 350);
    return () => clearTimeout(timer);
  }, [quoteKey, mode, assets]);

  const quote = quoteKey === null ? undefined : quotes[quoteKey];

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
    let result: ActionResult | null = null;
    if (mode === "deposit") {
      if (assets !== null) result = await tx.run((onPhase) => actions.deposit(assets, onPhase));
    } else if (useMax) {
      result = await tx.run((onPhase) => actions.withdrawMax(onPhase));
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

  // What the primary button says (and does) while the wallet or the pool isn't ready.
  const gate: { label: string; onClick?: () => void } | null =
    deployment === "loading"
      ? { label: "Loading the pool…" }
      : deployment === "error"
        ? { label: "Can't reach the pool right now" }
        : deployment === "not-deployed"
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

  const canSubmit = ready && !tx.pending && !invalid && (useMax ? mode === "withdraw" : assets !== null);
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
  const quoteValue = (shares: bigint | null | undefined) => (shares === null || shares === undefined ? EMPTY_VALUE : `≈ ${formatShares(shares)}`);
  const fullExit = position.shares !== null && position.maxRedeem !== null && position.shares > 0n && position.maxRedeem >= position.shares;
  const nothingToWithdraw = position.maxWithdraw === 0n || position.shares === 0n;

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
            <SummaryRow label="You receive" value={quoteValue(quote?.shares)} loading={quoteKey !== null && quote === undefined} />
            <SummaryRow label="Share price" value={sharePrice ? `${sharePrice} per eaSR` : EMPTY_VALUE} />
          </div>
        </TabsContent>

        <TabsContent value="withdraw" className="mt-5 flex flex-col gap-4">
          {amountField(
            useMax
              ? fullExit || position.maxWithdraw === null
                ? "Everything you hold, worked out again when you confirm."
                : "As much as the pool's idle liquidity allows right now, worked out again when you confirm."
              : position.maxWithdraw !== null
                ? `You can withdraw up to ${formatEurLimit(position.maxWithdraw)} now.`
                : "Amounts are in euros (1 tEURC = €1).",
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
            <Chip
              pressed={useMax}
              onClick={() => {
                setAmount(position.maxWithdraw !== null ? stroopsToEurInput(position.maxWithdraw) : "");
                setUseMax(true);
              }}
              disabled={tx.pending || !deployed || wallet.status !== "connected" || nothingToWithdraw}
            >
              Max
            </Chip>
          </div>
          <div className="rounded-xl bg-card-muted px-4 py-2 ring-1 ring-line">
            <SummaryRow
              label="Shares burned"
              value={useMax ? (fullExit ? `${formatShares(position.shares)} (all)` : "As many as liquidity allows") : quoteValue(quote?.shares)}
              loading={!useMax && quoteKey !== null && quote === undefined}
            />
            <SummaryRow label="Your shares" value={formatShares(position.shares)} />
          </div>
        </TabsContent>
      </Tabs>

      {quote?.error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{quote.error}</p>}

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
