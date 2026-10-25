"use client";
import * as React from "react";
import { ChevronDown, Fingerprint, Mail } from "lucide-react";
import type { AgentOverviewResponse } from "@/lib/api-types";
import { Address, ErrorNote, TxLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/client/api";
import { runAgentAction } from "@/lib/client/passkey";
import { formatDate, formatStroops } from "@/lib/format";
import { parseEurInput, toBig } from "./money";

export function SettingsPanel({ data, onChanged }: { data: AgentOverviewResponse; onChanged: () => Promise<void> | void }) {
  const balance = toBig(data.position?.cardBalance);
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tx, setTx] = React.useState<string | null>(null);
  const parsed = parseEurInput(amount);
  const valid = parsed !== null && parsed > 0n && parsed <= balance;

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || parsed === null) return;
    setBusy(true);
    setError(null);
    setTx(null);
    try {
      const r = await runAgentAction("withdraw_balance", { amount: parsed.toString() });
      setTx(r.hash);
      setAmount("");
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <p className="eyebrow">Settings</p>
      <dl className="mt-3 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="inline-flex items-center gap-2 text-muted">
            <Mail className="size-4" /> Email
          </dt>
          <dd className="truncate font-semibold">{data.user.email}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="inline-flex items-center gap-2 text-muted">
            <Fingerprint className="size-4" /> Passkeys
          </dt>
          <dd className="text-right">
            {data.passkeys.length === 0 ? (
              <span className="text-muted">{data.signerKind === "demo-ed25519" ? "Demo account (server signer)" : "None"}</span>
            ) : (
              data.passkeys.map((p, i) => (
                <div key={p.id} className="font-semibold">
                  Passkey {i + 1} <span className="font-normal text-muted">· added {formatDate(p.createdAt)}</span>
                </div>
              ))
            )}
          </dd>
        </div>
      </dl>

      <form onSubmit={withdraw} className="mt-5 border-t border-line pt-5">
        <Label htmlFor="withdraw">Withdraw balance to my account</Label>
        <div className="flex gap-2">
          <Input id="withdraw" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <Button type="button" variant="secondary" onClick={() => setAmount((Number(balance / 100_000n) / 100).toFixed(2))} disabled={balance <= 0n}>
            Max
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted">Card balance {formatStroops(balance)}. Confirmed with your passkey.</p>
        <Button type="submit" className="mt-3 w-full" variant="secondary" disabled={!valid} loading={busy}>
          Withdraw →
        </Button>
        {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
        {tx && (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
            Done. <TxLink hash={tx} label="View transaction" />
          </p>
        )}
      </form>

      <details className="group mt-5 border-t border-line pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-muted hover:text-ink">
          Advanced
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Account address</span>
            {data.smartAccount ? <Address value={data.smartAccount} /> : <span className="text-muted">—</span>}
          </div>
          <p className="text-xs text-muted">
            Your account is a smart contract on Stellar secured by your passkey. Notes and balances live there; only you can move your balance.
          </p>
        </div>
      </details>
    </Card>
  );
}
