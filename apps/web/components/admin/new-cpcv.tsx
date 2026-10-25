"use client";
import * as React from "react";
import Link from "next/link";
import { CircleCheck, CircleX, LoaderCircle, Lock, Sparkles } from "lucide-react";
import type { AdminAgentDto, CpcvCreateRequest, CpcvPipelineEvent, CpcvPipelineStep, PoolStatsResponse } from "@/lib/api-types";
import { ErrorNote, TxLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { FieldHint, Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/client/api";
import { postSSE } from "@/lib/client/sse";
import { formatCents, truncateAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS: { key: CpcvPipelineStep; label: string }[] = [
  { key: "validating", label: "Validating" },
  { key: "signing", label: "Signing attestation" },
  { key: "proving", label: "Generating ZK proof" },
  { key: "verifying", label: "Verifying proof locally" },
  { key: "minting", label: "Minting note on Stellar" },
  { key: "done", label: "Done" },
];

type StepState = { state: "idle" | "running" | "ok" | "error"; ms?: number; message?: string };

interface FormState {
  agentId: string;
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  salePriceEur: string;
  commissionRatePct: string;
  cpcvDate: string;
  escrituraDate: string;
}

function isoDay(secs: number, plusDays = 0): string {
  return new Date((secs + plusDays * 86_400) * 1000).toISOString().slice(0, 10);
}

/** "300000.50" → 30000050 cents; null if not a positive amount with ≤ 2 decimals. */
function parseCents(s: string): bigint | null {
  const t = s.replace(/[\s,€]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w) * 100n + BigInt((f + "00").slice(0, 2));
}

/** "4.75" → 475 bps; null unless 1–10 % with ≤ 2 decimals. */
function parseRateBps(s: string): number | null {
  const t = s.replace(/[\s%]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  const bps = Number(w) * 100 + Number((f + "00").slice(0, 2));
  return bps >= 100 && bps <= 1000 ? bps : null;
}

/** Valid Portuguese personal NIF (check digit mod 11). */
function randomNif(): string {
  const d = [1 + Math.floor(Math.random() * 3), ...Array.from({ length: 7 }, () => Math.floor(Math.random() * 10))];
  const sum = d.reduce((acc, v, i) => acc + v * (9 - i), 0);
  const check = 11 - (sum % 11);
  return d.join("") + String(check >= 10 ? 0 : check);
}

const DEMO = {
  first: ["João", "Maria", "Pedro", "Inês", "Rui", "Sofia", "Tiago", "Beatriz", "Miguel", "Catarina"],
  last: ["Silva", "Santos", "Oliveira", "Pereira", "Rodrigues", "Martins", "Sousa", "Fernandes", "Gonçalves", "Lopes"],
  addresses: [
    "Rua Garrett 42, 3.º Esq., 1200-204 Lisboa",
    "Rua de Cedofeita 118, 4050-174 Porto",
    "Avenida da Liberdade 77, 4710-251 Braga",
    "Rua Frederico Arouca 15, 2750-353 Cascais",
    "Rua de Santo António 61, 8000-283 Faro",
    "Rua do Brasil 230, 3030-175 Coimbra",
  ],
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export function NewCpcvForm({ agents, pool, onCreated }: { agents: AdminAgentDto[] | null; pool: PoolStatsResponse | null; onCreated: () => void }) {
  const now = pool?.demo.protocolNow ?? Math.floor(Date.now() / 1000);
  const empty = React.useCallback(
    (): FormState => ({
      agentId: "",
      buyerName: "",
      buyerNif: "",
      sellerName: "",
      sellerNif: "",
      propertyAddress: "",
      salePriceEur: "",
      commissionRatePct: "5",
      cpcvDate: isoDay(now),
      escrituraDate: isoDay(now, 90),
    }),
    [now],
  );
  const [f, setF] = React.useState<FormState>(empty);
  const [touched, setTouched] = React.useState(false);
  const [steps, setSteps] = React.useState<Record<string, StepState> | null>(null);
  const [result, setResult] = React.useState<{ noteId?: number; txHash?: string; cpcvId?: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const datesTouched = React.useRef(false);

  // Default the dates to the protocol "today" once the demo clock is known.
  React.useEffect(() => {
    if (!datesTouched.current) setF((s) => ({ ...s, cpcvDate: isoDay(now), escrituraDate: isoDay(now, 90) }));
  }, [now]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (k === "cpcvDate" || k === "escrituraDate") datesTouched.current = true;
    setF((s) => ({ ...s, [k]: e.target.value }));
  };

  const priceCents = parseCents(f.salePriceEur);
  const rateBps = parseRateBps(f.commissionRatePct);
  const ltvBps = BigInt(pool?.stats.params.ltvBps ?? 5000);
  const split =
    priceCents !== null && rateBps !== null
      ? (() => {
          const total = (priceCents * BigInt(rateBps)) / 10_000n;
          const agent = total / 2n;
          return { total, agent, explorador: total - agent, credit: (agent * ltvBps) / 10_000n };
        })()
      : null;

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!f.agentId) errors.agentId = "Choose the agent";
  if (f.buyerName.trim().length < 2) errors.buyerName = "Required";
  if (!/^\d{9}$/.test(f.buyerNif)) errors.buyerNif = "9 digits";
  if (f.sellerName.trim().length < 2) errors.sellerName = "Required";
  if (!/^\d{9}$/.test(f.sellerNif)) errors.sellerNif = "9 digits";
  if (f.propertyAddress.trim().length < 5) errors.propertyAddress = "Required";
  if (priceCents === null || priceCents <= 0n) errors.salePriceEur = "Enter the sale price in euros";
  if (rateBps === null) errors.commissionRatePct = "Between 1% and 10%, up to 2 decimals";
  if (!f.cpcvDate) errors.cpcvDate = "Required";
  if (!f.escrituraDate || f.escrituraDate <= f.cpcvDate) errors.escrituraDate = "Must be after the CPCV date";
  const valid = Object.keys(errors).length === 0;
  const show = (k: keyof FormState) => (touched ? errors[k] : undefined);

  function fillDemo() {
    const name = () => `${pick(DEMO.first)} ${pick(DEMO.last)} ${pick(DEMO.last)}`;
    setF((s) => ({
      ...s,
      agentId: s.agentId || agents?.[0]?.userId || "",
      buyerName: name(),
      buyerNif: randomNif(),
      sellerName: name(),
      sellerNif: randomNif(),
      propertyAddress: pick(DEMO.addresses),
      salePriceEur: String(185_000 + Math.round(Math.random() * 87) * 5_000),
      commissionRatePct: pick(["4", "4.5", "5"]),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || priceCents === null || rateBps === null) return;
    const body: CpcvCreateRequest = {
      agentId: f.agentId,
      buyerName: f.buyerName.trim(),
      buyerNif: f.buyerNif,
      sellerName: f.sellerName.trim(),
      sellerNif: f.sellerNif,
      propertyAddress: f.propertyAddress.trim(),
      salePriceEur: Number(priceCents) / 100,
      commissionRatePct: rateBps / 100,
      cpcvDate: f.cpcvDate,
      escrituraDate: f.escrituraDate,
    };
    setRunning(true);
    setError(null);
    setResult(null);
    const st: Record<string, StepState> = Object.fromEntries(STEPS.map((s) => [s.key, { state: "idle" } as StepState]));
    setSteps({ ...st });
    let failed = false;
    try {
      await postSSE<CpcvPipelineEvent>("/api/admin/cpcv", body, (ev) => {
        if (ev.step === "error" || ev.status === "error") {
          failed = true;
          const runningKey = ev.step !== "error" ? ev.step : STEPS.find((s) => st[s.key].state === "running")?.key;
          if (runningKey) st[runningKey] = { state: "error", message: ev.message };
          setError(ev.message ?? "The pipeline failed.");
        } else if (ev.status === "start") {
          st[ev.step] = { state: "running" };
        } else {
          st[ev.step] = { state: "ok", ms: ev.ms, message: ev.message };
          if (ev.step === "done") {
            st.done = { state: "ok", ms: ev.ms };
            setResult({ noteId: ev.noteId, txHash: ev.txHash, cpcvId: ev.cpcvId });
          }
        }
        if (ev.noteId !== undefined || ev.txHash) setResult((r) => ({ ...r, noteId: ev.noteId ?? r?.noteId, txHash: ev.txHash ?? r?.txHash, cpcvId: ev.cpcvId ?? r?.cpcvId }));
        setSteps({ ...st });
      });
      if (!failed && st.done.state !== "ok") {
        // Stream closed without an explicit "done": treat a completed mint as done.
        if (st.minting.state === "ok") st.done = { state: "ok" };
        setSteps({ ...st });
      }
    } catch (err) {
      setError(errorMessage(err));
      const runningKey = STEPS.find((s) => st[s.key].state === "running")?.key;
      if (runningKey) {
        st[runningKey] = { state: "error", message: errorMessage(err) };
        setSteps({ ...st });
      }
    } finally {
      setRunning(false);
      onCreated();
    }
  }

  const done = steps?.done.state === "ok";

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card className="p-5 sm:p-6 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">New CPCV</h2>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Lock className="size-3.5" /> Personal data is encrypted in the database and never goes on-chain.
            </p>
          </div>
          <Button type="button" size="xs" variant="ghost" onClick={fillDemo} disabled={running}>
            <Sparkles /> Fill demo data
          </Button>
        </div>
        <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <Label htmlFor="agentId">Agent</Label>
            <Select id="agentId" value={f.agentId} onChange={set("agentId")} disabled={running}>
              <option value="">{agents === null ? "Loading agents…" : agents.length ? "Choose an agent" : "No agents yet"}</option>
              {agents?.map((a) => (
                <option key={a.userId} value={a.userId} disabled={a.blocked}>
                  {a.displayName ?? a.email} · {a.email} · {truncateAddress(a.smartAccount)}
                  {a.blocked ? " (blocked)" : ""}
                </option>
              ))}
            </Select>
            <Err msg={show("agentId")} />
          </div>
          <Field id="buyerName" label="Buyer name" value={f.buyerName} onChange={set("buyerName")} err={show("buyerName")} disabled={running} />
          <Field id="buyerNif" label="Buyer NIF" value={f.buyerNif} onChange={set("buyerNif")} err={show("buyerNif")} disabled={running} inputMode="numeric" maxLength={9} />
          <Field id="sellerName" label="Seller name" value={f.sellerName} onChange={set("sellerName")} err={show("sellerName")} disabled={running} />
          <Field id="sellerNif" label="Seller NIF" value={f.sellerNif} onChange={set("sellerNif")} err={show("sellerNif")} disabled={running} inputMode="numeric" maxLength={9} />
          <div className="sm:col-span-2">
            <Field id="propertyAddress" label="Property address" value={f.propertyAddress} onChange={set("propertyAddress")} err={show("propertyAddress")} disabled={running} />
          </div>
          <Field id="salePriceEur" label="Sale price (€)" value={f.salePriceEur} onChange={set("salePriceEur")} err={show("salePriceEur")} disabled={running} inputMode="decimal" placeholder="300000" />
          <Field id="commissionRatePct" label="Commission rate (%)" value={f.commissionRatePct} onChange={set("commissionRatePct")} err={show("commissionRatePct")} disabled={running} inputMode="decimal" hint="1–10%" />
          <Field id="cpcvDate" label="CPCV date" type="date" value={f.cpcvDate} onChange={set("cpcvDate")} err={show("cpcvDate")} disabled={running} hint="protocol calendar" />
          <Field id="escrituraDate" label="Escritura date" type="date" value={f.escrituraDate} onChange={set("escrituraDate")} err={show("escrituraDate")} disabled={running} />
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
            <Button type="submit" size="lg" className="flex-1" loading={running} disabled={running || (touched && !valid)}>
              Prove &amp; mint note →
            </Button>
            {done && (
              <Button
                type="button"
                size="lg"
                variant="secondary"
                onClick={() => {
                  setF(empty());
                  datesTouched.current = false;
                  setSteps(null);
                  setResult(null);
                  setTouched(false);
                  setError(null);
                }}
              >
                Start another
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-5 lg:col-span-5">
        <Card className="p-5 sm:p-6">
          <p className="eyebrow">Split preview</p>
          <dl className="mt-3 divide-y divide-line text-sm">
            <Row label="Total commission" value={split ? formatCents(split.total) : "—"} strong />
            <Row label="Agent (50%)" value={split ? formatCents(split.agent) : "—"} />
            <Row label="explorador (50%) → first-loss" value={split ? formatCents(split.explorador) : "—"} />
            <Row label={`Credit limit (${Number(ltvBps) / 100}% of agent)`} value={split ? formatCents(split.credit) : "—"} strong />
          </dl>
          <p className="mt-3 text-xs text-muted">Same integer maths as the circuit: total = ⌊price × rate⌋, agent = ⌊total ÷ 2⌋.</p>
        </Card>

        {steps && (
          <Card className="p-5 sm:p-6">
            <p className="eyebrow">Pipeline</p>
            <ol className="mt-3 space-y-2.5">
              {STEPS.map((s) => {
                const v = steps[s.key];
                return (
                  <li key={s.key} className="flex gap-2.5 text-sm">
                    <span className="mt-0.5 shrink-0">
                      {v.state === "running" ? (
                        <LoaderCircle className="size-4 animate-spin text-primary" />
                      ) : v.state === "ok" ? (
                        <CircleCheck className="size-4 text-emerald-600" />
                      ) : v.state === "error" ? (
                        <CircleX className="size-4 text-red-600" />
                      ) : (
                        <span className="block size-4 rounded-full border border-line" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("font-semibold", v.state === "idle" && "font-normal text-muted")}>{s.label}</span>
                      {v.message && <span className="block break-words text-xs text-muted">{v.message}</span>}
                    </span>
                    {v.ms !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted">{(v.ms / 1000).toFixed(1)} s</span>}
                  </li>
                );
              })}
            </ol>
            {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
            {done && result && (
              <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                <p className="font-bold">Note {result.noteId !== undefined ? `#${result.noteId}` : ""} minted to the agent</p>
                <p className="mt-1 flex flex-wrap items-center gap-3">
                  {result.txHash && <TxLink hash={result.txHash} label="Mint transaction" />}
                  {result.noteId !== undefined && (
                    <Link href={`/registry/${result.noteId}`} className="font-semibold text-primary hover:underline">
                      View in registry →
                    </Link>
                  )}
                </p>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  err,
  hint,
  ...props
}: { id: string; label: string; err?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={!!err} className={cn(err && "border-red-400")} {...props} />
      {err ? <Err msg={err} /> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs font-semibold text-red-600">{msg}</p> : null;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-base font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}
