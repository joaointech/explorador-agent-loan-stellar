"use client";
import * as React from "react";
import { CircleCheck, CircleX, LoaderCircle, ShoppingBag } from "lucide-react";
import type { ActivityItem, AgentOverviewResponse, CardSimulateRequest, CardSimulateResponse } from "@/lib/api-types";
import { TxLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { apiGet, apiPost, errorMessage } from "@/lib/client/api";
import { useCooldown } from "@/lib/client/hooks";
import { formatCents, formatStroops } from "@/lib/format";
import { cn } from "@/lib/utils";
import { humanReason } from "./activity";

const PRESETS = [
  { merchant: "Pastelaria Aloma", amount: "4.80" },
  { merchant: "Galp fuel", amount: "62.00" },
  { merchant: "Worten", amount: "349.00" },
];

type CardItem = Extract<ActivityItem, { kind: "card" }>;

type Phase =
  | { kind: "idle" }
  | { kind: "authorizing" }
  | { kind: "declined"; reason: string | null }
  | { kind: "approved"; res: CardSimulateResponse; item: CardItem | null; timedOut: boolean }
  | { kind: "error"; message: string };

export function SimulatePurchaseSheet({ disabled, lithic, onDone }: { disabled?: boolean; lithic: boolean; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [merchant, setMerchant] = React.useState(PRESETS[0].merchant);
  const [amount, setAmount] = React.useState(PRESETS[0].amount);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [cooling, cool] = useCooldown(1200); // Lithic sandbox: max 1 write per second
  const pollRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!open) {
      pollRef.current++;
      setPhase({ kind: "idle" });
    }
  }, [open]);

  const amountNum = Number(amount.replace(",", "."));
  const valid = merchant.trim().length > 0 && Number.isFinite(amountNum) && amountNum > 0 && amountNum <= 100_000;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || cooling) return;
    cool();
    const run = ++pollRef.current;
    setPhase({ kind: "authorizing" });
    const startedAt = Date.now();
    const amountCents = Math.round(amountNum * 100);
    try {
      const body: CardSimulateRequest = { amountEur: Math.round(amountNum * 100) / 100, merchant: merchant.trim() };
      const res = await apiPost<CardSimulateResponse>("/api/agent/card/simulate", body);
      if (run !== pollRef.current) return;
      if (res.decision === "DECLINED") {
        setPhase({ kind: "declined", reason: res.declineReason });
        onDone();
        return;
      }
      setPhase({ kind: "approved", res, item: null, timedOut: false });
      // Poll the overview until the on-chain draw lands (or fails).
      const deadline = Date.now() + 90_000;
      while (run === pollRef.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        if (run !== pollRef.current) return;
        let ov: AgentOverviewResponse;
        try {
          ov = await apiGet<AgentOverviewResponse>("/api/agent/overview");
        } catch {
          continue;
        }
        const item = findItem(ov.activity, res, merchant.trim(), amountCents, startedAt);
        if (item?.decision === "DECLINED") {
          setPhase({ kind: "declined", reason: item.declineReason });
          onDone();
          return;
        }
        setPhase({ kind: "approved", res, item, timedOut: false });
        if (item && (item.chainStatus === "CONFIRMED" || item.chainStatus === "FAILED")) {
          onDone();
          return;
        }
      }
      if (run === pollRef.current) setPhase((p) => (p.kind === "approved" ? { ...p, timedOut: true } : p));
      onDone();
    } catch (err) {
      if (run === pollRef.current) setPhase({ kind: "error", message: errorMessage(err) });
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="lg" className="w-full" disabled={disabled}>
          <ShoppingBag /> Simulate purchase →
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Simulate a card purchase</SheetTitle>
          <SheetDescription>
            {lithic
              ? "Runs a real authorization through the Lithic sandbox card network. Amounts are in euros."
              : "Lithic isn't configured, so the authorization runs through the same decision logic locally. Amounts are in euros."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.merchant}
                type="button"
                onClick={() => {
                  setMerchant(p.merchant);
                  setAmount(p.amount);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                  merchant === p.merchant && amount === p.amount
                    ? "border-primary bg-primary text-white"
                    : "border-line bg-surface text-ink-soft hover:border-primary/50 hover:text-primary",
                )}
              >
                {p.merchant} €{p.amount}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Label htmlFor="merchant">Merchant</Label>
              <Input id="merchant" value={merchant} maxLength={60} onChange={(e) => setMerchant(e.target.value)} />
            </div>
            <div className="w-32">
              <Label htmlFor="amount">Amount (€)</Label>
              <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
            </div>
          </div>
          <Button type="submit" size="lg" disabled={!valid || cooling || phase.kind === "authorizing"} loading={phase.kind === "authorizing"}>
            Pay {valid ? formatCents(Math.round(amountNum * 100)) : ""} →
          </Button>
        </form>

        <ResultPanel phase={phase} />
      </SheetContent>
    </Sheet>
  );
}

function findItem(activity: ActivityItem[], res: CardSimulateResponse, merchant: string, amountCents: number, startedAt: number): CardItem | null {
  const cards = activity.filter((a): a is CardItem => a.kind === "card");
  if (res.authorizationId) {
    const hit = cards.find((c) => c.id === res.authorizationId);
    if (hit) return hit;
  }
  return (
    cards.find((c) => c.merchant === merchant && c.amountCents === amountCents && new Date(c.createdAt).getTime() >= startedAt - 15_000) ?? null
  );
}

function ResultPanel({ phase }: { phase: Phase }) {
  if (phase.kind === "idle") return null;
  if (phase.kind === "authorizing")
    return (
      <Step icon={<LoaderCircle className="size-5 animate-spin text-primary" />} title="Authorizing…">
        The card network is asking explorador whether you can spend this.
      </Step>
    );
  if (phase.kind === "error")
    return (
      <Step icon={<CircleX className="size-5 text-red-600" />} title="Something went wrong" tone="red">
        {phase.message}
      </Step>
    );
  if (phase.kind === "declined")
    return (
      <Step icon={<CircleX className="size-5 text-red-600" />} title="Declined" tone="red">
        {phase.reason === "INSUFFICIENT_FUNDS"
          ? "This purchase is larger than what you can spend right now (card balance + available credit)."
          : phase.reason
            ? `Reason: ${humanReason(phase.reason)}.`
            : "The purchase was declined."}
      </Step>
    );

  const it = phase.item;
  const confirmed = it?.chainStatus === "CONFIRMED";
  const failed = it?.chainStatus === "FAILED";
  return (
    <div className="flex flex-col gap-2">
      <Step icon={<CircleCheck className="size-5 text-emerald-600" />} title="Approved" tone="emerald">
        The card network approved the purchase in under two seconds.
      </Step>
      <Step
        icon={
          confirmed ? (
            <CircleCheck className="size-5 text-emerald-600" />
          ) : failed ? (
            <CircleX className="size-5 text-red-600" />
          ) : (
            <LoaderCircle className="size-5 animate-spin text-primary" />
          )
        }
        title={confirmed ? "Recorded on Stellar" : failed ? "Not recorded on-chain" : "Recording on Stellar…"}
        tone={confirmed ? "emerald" : failed ? "red" : undefined}
      >
        {confirmed && it ? (
          <span className="flex flex-col gap-1">
            <span className="tabular-nums">
              from balance {formatStroops(it.fromBalance)} / on credit {formatStroops(it.fromCredit)}
            </span>
            {it.txHash && <TxLink hash={it.txHash} label="View transaction" />}
          </span>
        ) : failed ? (
          "explorador covers this purchase; the team has been alerted."
        ) : phase.timedOut ? (
          "Still confirming — it will appear in your activity shortly."
        ) : (
          "Drawing from your balance first, then your credit line."
        )}
      </Step>
    </div>
  );
}

function Step({ icon, title, children, tone }: { icon: React.ReactNode; title: string; children: React.ReactNode; tone?: "emerald" | "red" }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-2xl border p-4 text-sm",
        tone === "emerald"
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10"
          : tone === "red"
            ? "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10"
            : "border-line bg-warm",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        <div className="mt-0.5 text-ink-soft">{children}</div>
      </div>
    </div>
  );
}
