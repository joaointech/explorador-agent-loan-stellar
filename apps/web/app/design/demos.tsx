"use client";

import { CircleCheck, CircleX, CreditCard, Play, RotateCcw, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AreaChart, LineChart } from "@/components/ui/charts";
import { cn } from "@/components/ui/cn";
import { Countdown } from "@/components/ui/countdown";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Stepper, stepsFrom } from "@/components/ui/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useNow, useProtocolNow } from "@/components/ui/use-now";
import { explorerTxUrl, formatEur, formatShortDate, parseEurToCents } from "@/lib/format";

import { SAMPLE_NOW, SAMPLE_TX, SHARE_PRICE_SERIES, TVL_DEBT_SERIES } from "./sample-data";

// ── Overlays ────────────────────────────────────────────────────────────────

const MERCHANTS = [
  { name: "Pastelaria Aloma", eur: "4.80" },
  { name: "Galp fuel", eur: "62.00" },
  { name: "Worten", eur: "349.00" },
];
const SPENDABLE_CENTS = 200_000n; // €2,000.00 in this demo

type PurchaseState = "form" | "approved" | "declined";

export function OverlayDemos() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [merchant, setMerchant] = useState(MERCHANTS[0].name);
  const [amount, setAmount] = useState(MERCHANTS[0].eur);
  const [state, setState] = useState<PurchaseState>("form");
  const [confirming, setConfirming] = useState(false);

  const cents = parseEurToCents(amount) ?? 0n;
  const close = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setState("form");
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => setDialogOpen(true)}>
        Open dialog
      </Button>
      <Button icon={<CreditCard className="size-4" />} onClick={() => setSheetOpen(true)}>
        Simulate purchase (sheet)
      </Button>
      <Button variant="ghost" onClick={() => toast.success("Deposit confirmed", { description: "1,000.00 eaSR minted to your wallet.", action: { label: "View transaction", href: explorerTxUrl(SAMPLE_TX) } })}>
        Success toast
      </Button>
      <Button variant="ghost" onClick={() => toast.error("Purchase declined", { description: "Insufficient funds: €349.00 is more than you can spend now." })}>
        Error toast
      </Button>
      <Button variant="ghost" onClick={() => toast.info("Recording on Stellar…", { description: "Your purchase is approved; the draw lands on-chain in a few seconds." })}>
        Info toast
      </Button>
      <Button variant="ghost" onClick={() => toast.warning("Grace period ends in 12 days", { duration: 0 })}>
        Sticky warning
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Confirm escritura for Note #12?"
        description="explorador pays €15,000.00 into the pool. Debt and interest are repaid first; the rest goes to the agent's card balance."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setDialogOpen(false);
                toast.success("Deal #12 settled: €4,411.23 added to the card balance");
              }}
            >
              Confirm escritura
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Debt + interest</dt>
          <dd className="text-right font-medium text-heading">€3,088.77</dd>
          <dt className="text-muted">To card balance</dt>
          <dd className="text-right font-medium text-heading">€4,411.23</dd>
          <dt className="text-muted">To first-loss tranche</dt>
          <dd className="text-right font-medium text-heading">€7,500.00</dd>
        </dl>
      </Dialog>

      <Sheet
        open={sheetOpen}
        onOpenChange={close}
        title="Simulate purchase"
        description="Card balance first, then credit. Sandbox card, real on-chain draw."
        footer={
          state === "form" ? (
            <Button
              fullWidth
              disabled={cents <= 0n}
              loading={confirming}
              onClick={() => {
                setConfirming(true);
                setTimeout(() => {
                  setConfirming(false);
                  setState(cents <= SPENDABLE_CENTS ? "approved" : "declined");
                }, 700);
              }}
            >
              Pay {formatEur(cents, { unit: "cents" })} at {merchant}
            </Button>
          ) : (
            <Button fullWidth variant="secondary" onClick={() => close(false)}>
              Done
            </Button>
          )
        }
      >
        {state === "form" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
              {MERCHANTS.map((m) => {
                const selected = merchant === m.name && amount === m.eur;
                return (
                  <button
                    key={m.name}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setMerchant(m.name);
                      setAmount(m.eur);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors",
                      selected
                        ? "bg-primary-tint text-primary-text ring-primary/40"
                        : "bg-card text-fg ring-line hover:bg-slate-50 dark:hover:bg-slate-800",
                    )}
                  >
                    <Store aria-hidden className="size-3.5" />
                    {m.name} {formatEur(m.eur, { unit: "eur" })}
                  </button>
                );
              })}
            </div>
            <Field label="Amount">
              <NumberInput value={amount} onValueChange={setAmount} decimals={2} prefix="€" />
            </Field>
            <Field label="Merchant">
              <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </Field>
            <p className="text-xs text-muted">You can spend {formatEur(SPENDABLE_CENTS, { unit: "cents" })} right now in this demo.</p>
          </div>
        ) : state === "approved" ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CircleCheck aria-hidden className="size-12 text-emerald-500" />
            <p className="text-lg font-bold text-heading">Approved</p>
            <p className="text-sm text-muted">
              {formatEur(cents, { unit: "cents" })} at {merchant}: €0.00 from balance, {formatEur(cents, { unit: "cents" })} on credit.
            </p>
            <Badge tone="blue" dot pulse>
              Recording on Stellar
            </Badge>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CircleX aria-hidden className="size-12 text-red-500" />
            <p className="text-lg font-bold text-heading">Declined</p>
            <p className="text-sm text-muted">Insufficient funds. You can spend {formatEur(SPENDABLE_CENTS, { unit: "cents" })} right now.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ── Forms ───────────────────────────────────────────────────────────────────

export function FormDemo() {
  const [price, setPrice] = useState("300000");
  const [rate, setRate] = useState("500");
  const [nif, setNif] = useState("12345678");
  const [submitted, setSubmitted] = useState(false);
  const nifError = submitted && !/^\d{9}$/.test(nif) ? "A NIF has 9 digits." : undefined;
  const totalCents = (BigInt(price || "0") * 100n * BigInt(rate || "0")) / 10_000n;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
      className="grid gap-5 sm:grid-cols-2"
    >
      <Field label="Sale price" hint="Whole euros." required>
        <NumberInput value={price} onValueChange={setPrice} prefix="€" name="salePrice" />
      </Field>
      <Field label="Commission rate">
        <Select value={rate} onChange={(e) => setRate(e.target.value)}>
          <option value="400">4%</option>
          <option value="450">4.5%</option>
          <option value="500">5%</option>
        </Select>
      </Field>
      <Field label="Buyer NIF" error={nifError} required>
        <Input value={nif} onChange={(e) => setNif(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={9} />
      </Field>
      <Field label="Escrow account" optional hint="Shown with a suffix adornment.">
        <Input placeholder="0.00" suffix="tEURC" />
      </Field>
      <Field label="Property address" className="sm:col-span-2">
        <Textarea placeholder="Rua Augusta 100, 1100-053 Lisboa" rows={2} />
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          Total commission <span className="font-semibold text-heading">{formatEur(totalCents, { unit: "cents" })}</span> · agent{" "}
          {formatEur(totalCents / 2n, { unit: "cents" })} · credit limit {formatEur(totalCents / 4n, { unit: "cents" })}
        </p>
        <Button type="submit" arrow>
          Create CPCV
        </Button>
      </div>
    </form>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

export function TabsDemo() {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Tabs defaultValue="deposit">
        <TabsList aria-label="Vault action">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="deposit" className="text-sm text-muted">
          Deposit tEURC into the senior vault and receive eaSR shares.
        </TabsContent>
        <TabsContent value="withdraw" className="text-sm text-muted">
          Withdraw up to the available liquidity.
        </TabsContent>
      </Tabs>
      <Tabs defaultValue="overview">
        <TabsList variant="underline" aria-label="Agent sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deals">Deals</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="text-sm text-muted">
          Underline tabs for page-level sections.
        </TabsContent>
        <TabsContent value="deals" className="text-sm text-muted">
          One card per CPCV Note.
        </TabsContent>
        <TabsContent value="activity" className="text-sm text-muted">
          Card transactions, settlements, cancellations.
        </TabsContent>
        <TabsContent value="settings" className="text-sm text-muted">
          Email, passkeys, smart account.
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Stepper: proof pipeline ─────────────────────────────────────────────────

const PIPELINE = [
  { id: "validating", label: "Validating", description: "Checks the CPCV fields and the protocol date." },
  { id: "signing", label: "Signing attestation", description: "explorador's BabyJubJub key signs the deal." },
  { id: "proving", label: "Generating ZK proof", description: "Groth16 over BN254 with snarkjs (a few seconds)." },
  { id: "verifying", label: "Verifying proof locally" },
  { id: "minting", label: "Minting note on Stellar", description: "cpcv_note.mint verifies the proof on-chain." },
  { id: "done", label: "Done" },
] as const;

export function PipelineDemo() {
  const [current, setCurrent] = useState(-1);
  const [fail, setFail] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = () => {
    if (timer.current) clearTimeout(timer.current);
    setFailed(false);
    const tick = (i: number) => {
      setCurrent(i);
      if (fail && PIPELINE[i]?.id === "proving") {
        timer.current = setTimeout(() => setFailed(true), 900);
        return;
      }
      if (i < PIPELINE.length) timer.current = setTimeout(() => tick(i + 1), i === 2 ? 1600 : 700);
    };
    tick(0);
  };

  const steps =
    current < 0
      ? stepsFrom(PIPELINE, -1)
      : stepsFrom(PIPELINE, current, failed).map((s) =>
          s.status === "error" ? { ...s, description: "Proof generation failed: witness does not satisfy the constraints." } : s,
        );
  const done = current >= PIPELINE.length - 1 && !failed;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
      <Stepper steps={done ? stepsFrom(PIPELINE, PIPELINE.length) : steps} label="CPCV pipeline" />
      <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
        <Button icon={<Play className="size-4" />} onClick={run}>
          Run pipeline
        </Button>
        <Button
          variant="secondary"
          icon={<RotateCcw className="size-4" />}
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setCurrent(-1);
            setFailed(false);
          }}
        >
          Reset
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Fail at proving
        </label>
      </div>
    </div>
  );
}

// ── Live values ─────────────────────────────────────────────────────────────

// When this module loaded in the browser: stands in for an API response's fetchedAtMs.
const LOADED_AT_MS = Date.now();

/** Interest ticking client-side from the protocol clock (spec §10.2 agent app). */
export function LiveInterestDemo() {
  const now = useProtocolNow(SAMPLE_NOW, LOADED_AT_MS);
  const principal = 3000;
  const elapsed = now - (SAMPLE_NOW - 90 * 86_400); // drawn 90 protocol days ago
  const interest = (principal * 0.12 * elapsed) / 31_536_000;
  const text = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(interest);
  return (
    <Card variant="muted" padding="sm">
      <p className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Interest so far (12% APR)</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-heading tabular-nums">{text}</p>
      <p className="mt-1 text-xs text-muted">On €3,000.00 drawn 90 protocol days ago · ticks every second</p>
    </Card>
  );
}

/** Countdown to the next midnight (UTC), on the wall clock. */
export function MidnightCountdown() {
  const wall = useNow(60_000);
  if (wall === null) return <span className="text-muted">…</span>;
  const midnight = Math.ceil(wall / 86_400_000) * 86_400;
  return <Countdown to={midnight} variant="precise" />;
}

// ── Charts ──────────────────────────────────────────────────────────────────

const eurCompact = (v: number) => (Math.abs(v) >= 1000 ? `€${Math.round(v / 1000)}k` : `€${Math.round(v)}`);
const eurFull = (v: number) => formatEur(v.toFixed(2), { unit: "eur" });

export function ChartsDemo() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <p className="text-sm font-semibold text-heading">Share price (eaSR)</p>
        <p className="mb-4 text-xs text-muted">Last 30 protocol days</p>
        <AreaChart
          title="eaSR share price, last 30 days"
          data={SHARE_PRICE_SERIES}
          x="t"
          series={[{ key: "price", label: "Share price" }]}
          formatX={(t) => formatShortDate(t as number)}
          formatY={(v) => `€${v.toFixed(3)}`}
          formatValue={(v) => `€${v.toFixed(4)}`}
          yDomain={["auto", "auto"]}
          height={220}
        />
      </Card>
      <Card>
        <p className="text-sm font-semibold text-heading">TVL vs outstanding debt</p>
        <p className="mb-4 text-xs text-muted">Both in euros, one axis</p>
        <LineChart
          title="Pool TVL and outstanding debt, last 30 days"
          data={TVL_DEBT_SERIES}
          x="t"
          series={[
            { key: "tvl", label: "TVL" },
            { key: "debt", label: "Outstanding debt" },
          ]}
          formatX={(t) => formatShortDate(t as number)}
          formatY={eurCompact}
          formatValue={eurFull}
          height={220}
        />
      </Card>
      <Card>
        <p className="mb-4 text-sm font-semibold text-heading">Loading</p>
        <AreaChart title="Loading example" data={[]} x="t" series={[{ key: "v", label: "Value" }]} loading height={160} />
      </Card>
      <Card>
        <p className="mb-4 text-sm font-semibold text-heading">Empty</p>
        <LineChart title="Empty example" data={[]} x="t" series={[{ key: "v", label: "Value" }]} height={160} empty="No snapshots yet: the indexer records one per hour." />
      </Card>
    </div>
  );
}
