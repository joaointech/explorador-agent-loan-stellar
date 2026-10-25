"use client";
import * as React from "react";
import type { TxResponse } from "@/lib/api-types";
import { ErrorNote, TxLink } from "@/components/common";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost, errorMessage } from "@/lib/client/api";

/** "€ amount + buttons" row for the junior tranche and fee claims (POST {amountEur} → {txHash}). */
export function AmountAction({
  id,
  actions,
  defaultValue = "",
  max,
  onDone,
}: {
  id: string;
  actions: { label: string; url: string; variant?: ButtonProps["variant"] }[];
  defaultValue?: string;
  max?: number;
  onDone: () => void;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tx, setTx] = React.useState<string | null>(null);
  const amount = Number(value);
  const valid = /^\d+(\.\d{1,2})?$/.test(value) && amount > 0;

  async function run(url: string) {
    setBusy(url);
    setError(null);
    setTx(null);
    try {
      const r = await apiPost<TxResponse>(url, { amountEur: amount });
      setTx(r.txHash);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-32 flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">€</span>
          <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" className="pl-8" />
        </div>
        {max !== undefined && (
          <Button type="button" variant="secondary" onClick={() => setValue((Math.floor(max * 100) / 100).toFixed(2))} disabled={max <= 0}>
            Max
          </Button>
        )}
        {actions.map((a) => (
          <Button key={a.url} variant={a.variant} onClick={() => run(a.url)} disabled={!valid || busy !== null} loading={busy === a.url}>
            {a.label}
          </Button>
        ))}
      </div>
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
      {tx && (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
          Done. <TxLink hash={tx} label="View transaction" />
        </p>
      )}
    </div>
  );
}
