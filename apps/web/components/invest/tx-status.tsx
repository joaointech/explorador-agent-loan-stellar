"use client";

import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";

import { TxLink } from "@/components/ui/address";
import { cn } from "@/components/ui/cn";
import { toWalletError } from "@/lib/wallet/errors";

import type { ActionPhase, ActionResult, OnPhase, TxState } from "./model";

const PHASE_LABEL: Record<ActionPhase, string> = {
  preparing: "Preparing the transaction…",
  signing: "Confirm in Freighter…",
  submitting: "Submitting to Stellar…",
  confirming: "Waiting for confirmation…",
  fallback: "Freighter didn't work out: asking the server faucet instead…",
};

const STEPS: ActionPhase[] = ["preparing", "signing", "submitting", "confirming"];

/**
 * Runs one wallet action at a time and tracks its phases:
 * pending (preparing → signing → submitting → confirming) → success | error.
 */
export function useTx() {
  const [state, setState] = useState<TxState>({ status: "idle" });
  const running = useRef(false);

  const run = async (task: (onPhase: OnPhase) => Promise<ActionResult>): Promise<ActionResult | null> => {
    if (running.current) return null;
    running.current = true;
    setState({ status: "pending", phase: "preparing" });
    try {
      const result = await task((phase, info) => setState({ status: "pending", phase, txHash: info?.txHash }));
      setState({ status: "success", message: result.message, txHash: result.txHash });
      return result;
    } catch (err) {
      const e = toWalletError(err);
      setState({ status: "error", message: e.message, txHash: e.txHash, code: e.code });
      return null;
    } finally {
      running.current = false;
    }
  };

  return { state, run, reset: () => setState({ status: "idle" }), pending: state.status === "pending" };
}

/** Inline status of the current action: phase with a spinner, then the outcome with a stellar.expert link. */
export function TxStatus({
  state,
  explorerBase,
  onDismiss,
  className,
}: {
  state: TxState;
  explorerBase?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  if (state.status === "idle") return null;

  if (state.status === "pending") {
    const step = STEPS.indexOf(state.phase);
    return (
      <div role="status" aria-live="polite" className={cn("rounded-xl border border-line bg-card-muted px-4 py-3 text-sm", className)}>
        <p className="flex items-center gap-2 font-medium text-heading">
          <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-primary-text" />
          {PHASE_LABEL[state.phase]}
        </p>
        {step >= 0 && (
          <ol aria-hidden className="mt-2.5 grid grid-cols-4 gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s} className={cn("h-1 rounded-full", i <= step ? "bg-primary" : "bg-slate-200 dark:bg-slate-700")} />
            ))}
          </ol>
        )}
        {state.txHash && (
          <p className="mt-2 text-xs text-muted">
            Submitted: <TxLink hash={state.txHash} explorerBase={explorerBase} />
          </p>
        )}
      </div>
    );
  }

  const success = state.status === "success";
  const Icon = success ? CircleCheck : CircleAlert;
  return (
    <div
      role={success ? "status" : "alert"}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
          : "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-[18px] shrink-0", success ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")} />
      <div className="min-w-0 flex-1">
        <p className="leading-relaxed">{state.message}</p>
        {state.txHash && (
          <p className="mt-1">
            <TxLink hash={state.txHash} explorerBase={explorerBase}>
              View on stellar.expert
            </TxLink>
          </p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mt-1 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
