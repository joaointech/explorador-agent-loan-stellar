"use client";

import { CircleAlert, CircleCheck, CircleX, LoaderCircle, Store } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Sheet } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { formatEur, parseEurToCents } from "@/lib/format";
import type { AuthorizationStatusResponse } from "@/lib/types/api";

import { errorMessage } from "./api";
import { useAgentApp } from "./context";
import { declineMessage } from "./state";

/** Quick picks (spec §10.2). */
export const PURCHASE_PRESETS = [
  { merchant: "Pastelaria Aloma", amount: "4.80" },
  { merchant: "Galp fuel", amount: "62.00" },
  { merchant: "Worten", amount: "349.00" },
] as const;

const MAX_CENTS = 5_000_000n; // €50,000.00, the simulate API's limit
const MAX_MERCHANT = 40;
/** Lithic sandbox allows one simulation per second: requests are spaced at least this far apart. */
const MIN_GAP_MS = 1_100;
const POLL_MS = 1_500;
const POLL_TIMEOUT_MS = 60_000;

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "declined"; cents: bigint; merchant: string; reason: string | null }
  | { kind: "approved"; id: string; cents: bigint; merchant: string; status: AuthorizationStatusResponse | null; timedOut: boolean };

const isFinal = (s: AuthorizationStatusResponse | null) => s?.chainStatus === "CONFIRMED" || s?.chainStatus === "FAILED";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One spacer for the whole page: Lithic's limit is per account, not per sheet.
let lastSimulationAt = 0;

/** Runs a simulation at least MIN_GAP_MS after the previous one finished or started. */
async function spaced<T>(run: () => Promise<T>): Promise<T> {
  const wait = lastSimulationAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastSimulationAt = Date.now();
  try {
    return await run();
  } finally {
    lastSimulationAt = Date.now();
  }
}

function validate(cents: bigint | null, merchant: string): string | null {
  if (cents === null || cents <= 0n) return "Enter an amount.";
  if (cents > MAX_CENTS) return "At most €50,000.00 per purchase.";
  if (merchant === "") return "Enter the merchant's name.";
  return null;
}

function ChainStatus({ status, timedOut }: { status: AuthorizationStatusResponse | null; timedOut: boolean }) {
  if (status?.chainStatus === "CONFIRMED") {
    return (
      <div className="rounded-card border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          <CircleCheck aria-hidden className="size-4" /> Recorded on Stellar
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">From card balance</dt>
            <dd className="font-semibold text-heading">
              <Amount value={status.fromBalance ?? "0"} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">On credit</dt>
            <dd className="font-semibold text-heading">
              <Amount value={status.fromCredit ?? "0"} />
            </dd>
          </div>
        </dl>
        {status.txHash && (
          <p className="mt-3 text-sm">
            <TxLink hash={status.txHash}>View on stellar.expert</TxLink>
          </p>
        )}
      </div>
    );
  }
  if (status?.chainStatus === "FAILED") {
    return (
      <div role="alert" className="rounded-card border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <p className="flex items-center gap-2 font-semibold">
          <CircleAlert aria-hidden className="size-4" /> Couldn&apos;t record it on Stellar
        </p>
        <p className="mt-1 leading-relaxed">The purchase still went through: explorador&apos;s treasury covers it and retries the on-chain draw.</p>
      </div>
    );
  }
  if (timedOut) {
    return (
      <div className="rounded-card border border-line bg-card-muted p-4 text-sm text-muted">
        <p className="font-semibold text-heading">Still recording…</p>
        <p className="mt-1 leading-relaxed">It will show up in your activity as soon as Stellar confirms it.</p>
      </div>
    );
  }
  return (
    <div role="status" className="rounded-card border border-line bg-card-muted p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-heading">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-primary-text" /> Recording on Stellar…
      </p>
      <p className="mt-1 leading-relaxed text-muted">The pool contract funds it: card balance first, then a draw on your credit line. Usually a few seconds.</p>
    </div>
  );
}

/**
 * "Simulate purchase" bottom sheet (spec §4.4, §10.2): amount + merchant with
 * quick picks → approve/decline from the card network flow → polls the
 * authorization until the on-chain draw confirms, then shows the split.
 */
export function PurchaseSheet({ open, onOpenChange, spendableNow }: { open: boolean; onOpenChange: (open: boolean) => void; spendableNow: bigint }) {
  const { api, refresh } = useAgentApp();
  const [merchant, setMerchant] = useState<string>(PURCHASE_PRESETS[0].merchant);
  const [amount, setAmount] = useState<string>(PURCHASE_PRESETS[0].amount);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const formId = useId();

  const cents = parseEurToCents(amount);
  const merchantName = merchant.trim();
  const invalid = validate(cents, merchantName);
  const sending = phase.kind === "sending";

  // Poll the authorization until its on-chain draw is CONFIRMED or FAILED.
  const pollId = phase.kind === "approved" && !isFinal(phase.status) && !phase.timedOut ? phase.id : null;
  useEffect(() => {
    if (!pollId) return;
    let cancelled = false;
    const startedAt = Date.now();
    const poll = async () => {
      while (!cancelled) {
        await sleep(POLL_MS);
        if (cancelled) return;
        try {
          const status = await api.authorization(pollId);
          if (cancelled) return;
          setPhase((p) => (p.kind === "approved" && p.id === pollId ? { ...p, status } : p));
          if (isFinal(status)) {
            void refresh();
            return;
          }
        } catch {
          // transient: keep polling until the timeout
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setPhase((p) => (p.kind === "approved" && p.id === pollId ? { ...p, timedOut: true } : p));
          void refresh();
          return;
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [pollId, api, refresh]);

  const submit = async () => {
    setTouched(true);
    if (invalid || cents === null || sending) return;
    setError(null);
    setPhase({ kind: "sending" });
    try {
      const res = await spaced(() => api.simulate({ amountEur: Number(cents) / 100, merchant: merchantName }));
      setPhase(
        res.decision === "APPROVED"
          ? { kind: "approved", id: res.authorizationId, cents, merchant: merchantName, status: null, timedOut: false }
          : { kind: "declined", cents, merchant: merchantName, reason: res.declineReason },
      );
      void refresh(); // the hold shows in "Available to spend" right away
    } catch (err) {
      setPhase({ kind: "form" });
      setError(errorMessage(err));
    }
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setPhase({ kind: "form" });
      setError(null);
      setTouched(false);
    }
  };

  const again = () => {
    setPhase({ kind: "form" });
    setError(null);
  };

  // Distinct keys: React must not morph the clicked "New purchase" button into the submit button
  // (the browser would then run the submit activation on the same click and re-send the purchase).
  const footer =
    phase.kind === "form" || phase.kind === "sending" ? (
      <Button key="pay" type="submit" form={formId} fullWidth size="lg" loading={sending} disabled={invalid !== null && touched}>
        {cents !== null && cents > 0n && merchantName ? `Pay ${formatEur(cents, { unit: "cents" })} at ${merchantName}` : "Pay"}
      </Button>
    ) : (
      <>
        <Button key="again" variant="secondary" fullWidth onClick={again}>
          {phase.kind === "declined" ? "Try another amount" : "New purchase"}
        </Button>
        <Button key="done" fullWidth onClick={() => close(false)}>
          Done
        </Button>
      </>
    );

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      dismissible={!sending}
      title="Simulate purchase"
      description="Sandbox card, real funding on Stellar: card balance first, then credit."
      footer={footer}
    >
      {phase.kind === "approved" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1.5 pt-1 text-center">
            <CircleCheck aria-hidden className="size-12 text-emerald-500" />
            <p className="text-lg font-bold text-heading">Approved</p>
            <p className="text-sm text-muted">
              {formatEur(phase.cents, { unit: "cents" })} at {phase.merchant}
            </p>
          </div>
          <ChainStatus status={phase.status} timedOut={phase.timedOut} />
        </div>
      ) : phase.kind === "declined" ? (
        <div role="alert" className="flex flex-col items-center gap-1.5 py-2 text-center">
          <CircleX aria-hidden className="size-12 text-red-500" />
          <p className="text-lg font-bold text-heading">Declined</p>
          <p className="text-sm text-muted">
            {formatEur(phase.cents, { unit: "cents" })} at {phase.merchant}
          </p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-fg">{declineMessage(phase.reason, spendableNow)}</p>
        </div>
      ) : (
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
            {PURCHASE_PRESETS.map((p) => {
              const selected = merchant === p.merchant && amount === p.amount;
              return (
                <button
                  key={p.merchant}
                  type="button"
                  aria-pressed={selected}
                  disabled={sending}
                  onClick={() => {
                    setMerchant(p.merchant);
                    setAmount(p.amount);
                  }}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-colors disabled:opacity-60",
                    selected ? "bg-primary-tint text-primary-text ring-primary/40" : "bg-card text-fg ring-line hover:bg-slate-50 dark:hover:bg-slate-800",
                  )}
                >
                  <Store aria-hidden className="size-3.5" />
                  {p.merchant} {formatEur(p.amount, { unit: "eur" })}
                </button>
              );
            })}
          </div>
          <Field label="Amount" error={touched && cents !== null && cents > MAX_CENTS ? "At most €50,000.00 per purchase." : touched && (cents === null || cents <= 0n) ? "Enter an amount." : undefined}>
            <NumberInput value={amount} onValueChange={setAmount} decimals={2} prefix="€" disabled={sending} />
          </Field>
          <Field label="Merchant" error={touched && merchantName === "" ? "Enter the merchant's name." : undefined}>
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={MAX_MERCHANT} autoComplete="off" disabled={sending} />
          </Field>
          <p className="text-xs leading-relaxed text-muted">
            You can spend <span className="font-semibold text-heading">{formatEur(spendableNow)}</span> right now.
          </p>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </p>
          )}
        </form>
      )}
    </Sheet>
  );
}
