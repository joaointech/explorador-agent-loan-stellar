"use client";

import { CircleCheck, CircleX, FileText, RotateCcw, ShieldCheck, WandSparkles } from "lucide-react";
import { useState } from "react";

import { TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/typography";
import { previewCommission } from "@/lib/admin/commission";
import { adminCpcvInputSchema, dayToIsoDate, fieldErrors, isoDateToDay, protocolDateIssues, type CpcvField } from "@/lib/admin/cpcv-input";
import { isEventStream, readSseEvents } from "@/lib/admin/sse-parser";
import { formatBps, formatDate, formatRelativeDays, parseEurToCents, truncateAddress } from "@/lib/format";
import type { AdminAgentsResponse, AdminCpcvInput, PipelineEvent } from "@/lib/types/api";
import { DAY_SECS } from "@/lib/units";

import { adminFetch, errorFromResponse, redirectToLogin, toAdminApiError } from "./api";
import { LoadError } from "./confirm-dialog";
import { demoDeal } from "./demo-data";
import { applyPipelineEvent, currentStep, idlePipeline, PIPELINE, PipelineSteps, type PipelineState } from "./pipeline-steps";
import { useAdminResource } from "./use-admin-resource";

interface FormState {
  agentId: string;
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  /** Raw euros, e.g. "300000" or "300000.50". */
  salePrice: string;
  /** Raw percentage, e.g. "5" or "4.75". */
  ratePct: string;
  /** null = untouched: show the default (protocol today / +90 days). */
  cpcvDate: string | null;
  escrituraDate: string | null;
}

const EMPTY: FormState = {
  agentId: "",
  buyerName: "",
  buyerNif: "",
  sellerName: "",
  sellerNif: "",
  propertyAddress: "",
  salePrice: "",
  ratePct: "",
  cpcvDate: null,
  escrituraDate: null,
};

/** Form input → the API field its errors are reported on. */
const FIELD_OF: Record<keyof FormState, CpcvField> = {
  agentId: "agentId",
  buyerName: "buyerName",
  buyerNif: "buyerNif",
  sellerName: "sellerName",
  sellerNif: "sellerNif",
  propertyAddress: "propertyAddress",
  salePrice: "salePriceCents",
  ratePct: "commissionRateBps",
  cpcvDate: "cpcvDate",
  escrituraDate: "escrituraDate",
};

type Phase = "form" | "running" | "done" | "failed";

interface Outcome {
  cpcvId?: string;
  noteId?: number;
  txHash?: string;
  explorerUrl?: string;
  registryUrl?: string;
  message?: string;
}

const rateToBps = (pct: string): number | null => {
  if (pct.trim() === "") return null;
  const n = Number(pct);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 9);

function LivePreview({ salePrice, ratePct, escrituraDate, protocolDay }: { salePrice: string; ratePct: string; escrituraDate: string; protocolDay: number | null }) {
  const cents = parseEurToCents(salePrice);
  const bps = rateToBps(ratePct);
  const preview = cents !== null && cents > 0n && bps !== null && bps > 0 ? previewCommission(cents, bps) : null;
  const escrituraDay = isoDateToDay(escrituraDate);
  return (
    <Card variant="brand" radius="3xl" className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold tracking-[0.2em] text-blue-100/80 uppercase">Total commission</p>
        <p className="mt-1 text-4xl leading-none font-bold tracking-tight tabular-nums">{preview ? <Amount value={preview.total} /> : "—"}</p>
        <p className="mt-2 text-sm text-blue-100/90">
          {preview && bps !== null ? `${formatBps(bps)} of the sale price, paid at the escritura` : "Sale price × commission rate"}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-white/20 pt-4 text-sm">
        <div>
          <dt className="text-blue-100/80">Agent (50%)</dt>
          <dd className="text-lg font-bold tabular-nums">{preview ? <Amount value={preview.agent} /> : "—"}</dd>
        </div>
        <div>
          <dt className="text-blue-100/80">explorador (50%)</dt>
          <dd className="text-lg font-bold tabular-nums">{preview ? <Amount value={preview.explorador} /> : "—"}</dd>
        </div>
        <div className="col-span-2 rounded-xl bg-white/10 px-3 py-2.5">
          <dt className="text-blue-100/80">Credit limit (50% of the agent&apos;s half)</dt>
          <dd className="text-2xl font-bold tabular-nums">{preview ? <Amount value={preview.creditLimit} /> : "—"}</dd>
        </div>
      </dl>
      {escrituraDay !== null && (
        <p className="text-sm text-blue-100/90">
          Escritura {formatDate(escrituraDay)}
          {protocolDay !== null && <> · {formatRelativeDays(escrituraDay, protocolDay)} on the protocol clock</>}
        </p>
      )}
    </Card>
  );
}

/** /admin/cpcvs/new: the New CPCV form with a live split preview and the step-by-step proof pipeline (spec §4.3). */
export function NewCpcvPanel() {
  const agents = useAdminResource<AdminAgentsResponse>("/api/admin/agents");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<CpcvField, string>>>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [pipeline, setPipeline] = useState<PipelineState>(idlePipeline);
  const [outcome, setOutcome] = useState<Outcome>({});
  const [demoCount, setDemoCount] = useState(0);
  const [lastInput, setLastInput] = useState<AdminCpcvInput | null>(null);

  const clock = agents.data?.clock ?? null;
  // Protocol "today" (spec §5.7) for the default dates and the date checks;
  // without a chain read the dates start empty and the server checks them.
  const protocolDay = clock ? Math.floor(clock.protocolNow / DAY_SECS) : null;
  const cpcvDate = form.cpcvDate ?? (protocolDay !== null ? dayToIsoDate(protocolDay) : "");
  const escrituraDate = form.escrituraDate ?? (protocolDay !== null ? dayToIsoDate(protocolDay + 90) : "");
  const readyAgents = agents.data?.agents.filter((a) => a.smartAccount) ?? [];
  const pendingAgents = agents.data?.agents.filter((a) => !a.smartAccount) ?? [];
  const running = phase === "running";

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    const field = FIELD_OF[key];
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const candidate = (): unknown => ({
    agentId: form.agentId,
    buyerName: form.buyerName,
    buyerNif: form.buyerNif,
    sellerName: form.sellerName,
    sellerNif: form.sellerNif,
    propertyAddress: form.propertyAddress,
    salePriceCents: (() => {
      const cents = parseEurToCents(form.salePrice);
      return cents === null ? NaN : Number(cents);
    })(),
    commissionRateBps: rateToBps(form.ratePct) ?? NaN,
    cpcvDate,
    escrituraDate,
  });

  const fillDemo = () => {
    const deal = demoDeal(demoCount);
    // The protocol date, or today's date if the chain can't be read (the server re-checks).
    const day = protocolDay ?? Math.floor(Date.now() / 1000 / DAY_SECS);
    setDemoCount((n) => n + 1);
    setErrors({});
    setForm((f) => ({
      ...f,
      ...deal,
      agentId: f.agentId || readyAgents[0]?.id || "",
      cpcvDate: dayToIsoDate(day),
      escrituraDate: dayToIsoDate(day + 90),
    }));
  };

  const run = async (input: AdminCpcvInput) => {
    setLastInput(input);
    setPhase("running");
    setOutcome({});
    let state = idlePipeline();
    // Mutated by `apply` while the stream is read.
    const result: { finished: "done" | "failed" | null } = { finished: null };
    const apply = (event: PipelineEvent) => {
      state = applyPipelineEvent(state, event, performance.now());
      setPipeline(state);
      if (event.step === "done" && event.status === "completed") {
        result.finished = "done";
        setOutcome({ ...(event.data as Outcome), message: event.message });
      } else if (event.status === "failed") {
        result.finished = "failed";
        setOutcome({ cpcvId: event.data?.cpcvId, message: event.message });
      }
    };
    setPipeline(state);
    try {
      const res = await adminFetch("/api/admin/cpcv", { method: "POST", body: input });
      if (res.status === 401) return redirectToLogin();
      if (!isEventStream(res)) {
        const err = await errorFromResponse(res);
        apply({ step: "validating", status: "failed", message: err.message });
      } else {
        await readSseEvents<PipelineEvent>(res, apply);
      }
    } catch (err) {
      if (!result.finished) {
        apply({ step: currentStep(state), status: "failed", message: `Connection lost (${toAdminApiError(err).message}). Check the CPCVs list for the outcome.` });
      }
    }
    if (!result.finished) {
      apply({ step: currentStep(state), status: "failed", message: "The server stopped reporting progress. Check the CPCVs list for the outcome." });
    }
    setPhase(result.finished === "done" ? "done" : "failed");
  };

  const submit = () => {
    const parsed = adminCpcvInputSchema.safeParse(candidate());
    const next: Partial<Record<CpcvField, string>> = parsed.success ? {} : fieldErrors(parsed.error);
    if (parsed.success && protocolDay !== null) {
      for (const issue of protocolDateIssues(parsed.data, protocolDay)) next[issue.path] ??= issue.message;
    }
    setErrors(next);
    if (!parsed.success || Object.keys(next).length > 0) return;
    void run(parsed.data);
  };

  const reset = () => {
    setForm(EMPTY);
    setErrors({});
    setPhase("form");
    setPipeline(idlePipeline());
    setOutcome({});
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="New CPCV"
        title="Turn a signed CPCV into"
        accent="a note on Stellar"
        description="explorador attests the deal, a zero-knowledge proof hides the personal data, and cpcv_note mints the agent's soulbound note with a credit line."
        actions={
          <Button variant="secondary" size="sm" icon={<WandSparkles className="size-4" />} onClick={fillDemo} disabled={running || agents.loading}>
            Fill with demo data
          </Button>
        }
      />

      {agents.error && !agents.data && <LoadError error={agents.error} onRetry={agents.refresh} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card padding="lg">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <fieldset disabled={running} className="grid gap-5 sm:grid-cols-2">
              <legend className="sr-only">CPCV details</legend>
              <Field
                label="Agent"
                required
                error={errors.agentId}
                className="sm:col-span-2"
                hint={
                  !agents.loading && readyAgents.length === 0
                    ? "No agent has a smart account yet: they appear here once they finish onboarding."
                    : "The note is minted to this agent's smart account."
                }
              >
                {agents.loading ? (
                  <Skeleton className="h-11 w-full rounded-xl" />
                ) : (
                  <Select value={form.agentId} onChange={(e) => set("agentId", e.target.value)}>
                    <option value="">Choose an agent…</option>
                    {readyAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName ? `${a.displayName} · ` : ""}
                        {a.email} · {truncateAddress(a.smartAccount!)}
                      </option>
                    ))}
                    {pendingAgents.map((a) => (
                      <option key={a.id} value={a.id} disabled>
                        {a.email} (no smart account yet)
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Buyer name" required error={errors.buyerName}>
                <Input value={form.buyerName} onChange={(e) => set("buyerName", e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Buyer NIF" required error={errors.buyerNif}>
                <Input value={form.buyerNif} onChange={(e) => set("buyerNif", onlyDigits(e.target.value))} inputMode="numeric" maxLength={9} placeholder="9 digits" autoComplete="off" />
              </Field>
              <Field label="Seller name" required error={errors.sellerName}>
                <Input value={form.sellerName} onChange={(e) => set("sellerName", e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Seller NIF" required error={errors.sellerNif}>
                <Input value={form.sellerNif} onChange={(e) => set("sellerNif", onlyDigits(e.target.value))} inputMode="numeric" maxLength={9} placeholder="9 digits" autoComplete="off" />
              </Field>
              <Field label="Property address" required error={errors.propertyAddress} className="sm:col-span-2">
                <Textarea value={form.propertyAddress} onChange={(e) => set("propertyAddress", e.target.value)} rows={2} placeholder="Rua Augusta 100, 1100-053 Lisboa" />
              </Field>
              <Field label="Sale price" required error={errors.salePriceCents}>
                <NumberInput value={form.salePrice} onValueChange={(v) => set("salePrice", v)} decimals={2} prefix="€" placeholder="300,000" />
              </Field>
              <Field label="Commission rate" required error={errors.commissionRateBps} hint="Between 1% and 10%.">
                <NumberInput value={form.ratePct} onValueChange={(v) => set("ratePct", v)} decimals={2} suffix="%" placeholder="5" />
              </Field>
              <Field label="CPCV date" required error={errors.cpcvDate}>
                <Input type="date" value={cpcvDate} onChange={(e) => set("cpcvDate", e.target.value)} />
              </Field>
              <Field label="Escritura date" required error={errors.escrituraDate} hint={protocolDay !== null ? `Protocol date today: ${formatDate(protocolDay)}` : undefined}>
                <Input type="date" value={escrituraDate} onChange={(e) => set("escrituraDate", e.target.value)} />
              </Field>
            </fieldset>

            <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-text" />
                Names, NIFs, price, rate, address and CPCV date stay encrypted in explorador&apos;s database; only the commission, the agent&apos;s address and the escritura date go on-chain.
              </p>
              <Button type="submit" size="lg" arrow loading={running} disabled={phase !== "form" && phase !== "failed"}>
                Generate proof &amp; mint
              </Button>
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-6 lg:sticky lg:top-24">
          <LivePreview salePrice={form.salePrice} ratePct={form.ratePct} escrituraDate={escrituraDate} protocolDay={protocolDay} />

          <Card>
            <CardHeader title="Pipeline" description={phase === "form" ? "Runs when you submit; each step reports here live." : undefined} />
            <div className="mt-5">
              <PipelineSteps
                state={pipeline}
                meta={outcome.txHash && phase === "done" ? { minting: <TxLink hash={outcome.txHash}>tx</TxLink> } : {}}
              />
            </div>

            {phase === "done" && (
              <div className="mt-6 flex flex-col gap-4 rounded-xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
                <p className="flex items-start gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
                  <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
                  CPCV Note #{outcome.noteId} minted: verified on-chain and listed in the registry.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {outcome.registryUrl && (
                    <Button href={outcome.registryUrl} size="sm" arrow>
                      View note #{outcome.noteId}
                    </Button>
                  )}
                  {outcome.txHash && <TxLink hash={outcome.txHash}>View transaction on stellar.expert</TxLink>}
                </div>
                <Button variant="ghost" size="sm" className="self-start" icon={<RotateCcw className="size-4" />} onClick={reset}>
                  Create another CPCV
                </Button>
              </div>
            )}

            {phase === "failed" && (
              <div role="alert" className="mt-6 flex flex-col gap-3 rounded-xl bg-red-50 p-4 dark:bg-red-500/10">
                <p className="flex items-start gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                  <CircleX aria-hidden className="mt-0.5 size-5 shrink-0" />
                  <span>
                    Stopped at “{PIPELINE.find((s) => s.id === currentStep(pipeline))?.label}”
                    {outcome.cpcvId ? ": the CPCV is recorded as failed." : ": nothing was recorded."} Fix the cause above, then try again.
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {lastInput && (
                    <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => void run(lastInput)}>
                      Try again
                    </Button>
                  )}
                  {outcome.cpcvId && (
                    <Button size="sm" variant="secondary" href="/admin/cpcvs" icon={<FileText className="size-4" />}>
                      See it in CPCVs
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
