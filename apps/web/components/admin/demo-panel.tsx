"use client";

import { CircleCheck, CircleX, Clock, FastForward, LoaderCircle, RefreshCw, RotateCcw, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatClockOffset, refreshDemoClock } from "@/components/shell/demo-clock";
import { Address } from "@/components/ui/address";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardRow } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/typography";
import { isEventStream, readSseEvents } from "@/lib/admin/sse-parser";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import type { AdminAgentsResponse, AdminOverviewResponse, AdvanceClockResponse, ResetLogEvent } from "@/lib/types/api";

import { adminFetch, errorFromResponse, postAdmin, redirectToLogin, toAdminApiError } from "./api";
import { ConfirmDialog, LoadError, WarningsBanner } from "./confirm-dialog";
import { useAdminResource } from "./use-admin-resource";

const FAST_FORWARD_DAYS = [1, 7, 30, 90] as const;

function ClockCard({ overview, agents, onMoved }: { overview: AdminOverviewResponse; agents: AdminAgentsResponse | null; onMoved: () => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const { clock } = overview;
  const chainClock = overview.stats !== null;
  const inGrace = (agents?.agents ?? []).filter((a) => a.graceDeadline !== null && BigInt(a.carriedDebt) > 0n && a.graceDeadline > clock.protocolNow);
  const selected = inGrace.find((a) => a.id === agentId) ?? inGrace[0];
  const disabled = !clock.demoMode || !chainClock || pending !== null;

  const advance = async (key: string, body: { days: number } | { toGraceDeadlineOf: string }, label: string) => {
    setPending(key);
    try {
      const res = await postAdmin<AdvanceClockResponse>("/api/admin/demo/advance-clock", body);
      toast.success(`Protocol clock moved ${label}`, {
        description: `Protocol date is now ${formatDate(res.clock.protocolNow)}.`,
        action: { label: "View transaction", href: res.explorerUrl },
      });
      void refreshDemoClock();
      onMoved();
    } catch (err) {
      toast.error("Couldn't move the protocol clock", { description: toAdminApiError(err).message });
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="flex flex-col gap-5">
      <CardHeader
        eyebrow="Demo clock"
        title={
          <span className="inline-flex items-center gap-2">
            <Clock aria-hidden className="size-5 text-primary-text" /> Protocol clock
          </span>
        }
        description="Interest, escritura dates and grace periods run on advance_pool's clock. Fast-forwarding accrues interest at once and only ever moves forward."
        action={clock.demoMode ? <Badge tone="blue">Demo mode</Badge> : <Badge tone="neutral">Demo mode off</Badge>}
      />
      <div className="rounded-2xl bg-card-muted px-5 py-4">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Protocol date</p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-heading tabular-nums">{chainClock ? formatDate(clock.protocolNow) : "—"}</p>
        <p className="mt-1 text-sm text-muted">
          {chainClock ? (
            <>
              {formatDateTime(clock.protocolNow)} Lisbon · {clock.offsetSecs > 0 ? `${formatClockOffset(clock.offsetSecs)} ahead of real time` : "in sync with real time"}
            </>
          ) : (
            "The pool can't be read right now."
          )}
        </p>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-heading">Fast-forward</p>
        <div className="flex flex-wrap gap-2">
          {FAST_FORWARD_DAYS.map((days) => (
            <Button
              key={days}
              variant="secondary"
              size="sm"
              icon={<FastForward className="size-4" />}
              loading={pending === `d${days}`}
              disabled={disabled}
              onClick={() => void advance(`d${days}`, { days }, `+${days} ${days === 1 ? "day" : "days"}`)}
            >
              +{days} {days === 1 ? "day" : "days"}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-end">
        <Field label="To the grace deadline of" className="flex-1" hint={inGrace.length === 0 ? "No agent has carried debt in a grace period." : undefined}>
          <Select value={selected?.id ?? ""} onChange={(e) => setAgentId(e.target.value)} disabled={inGrace.length === 0 || disabled}>
            {inGrace.length === 0 && <option value="">No agent in a grace period</option>}
            {inGrace.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email} · {formatDate(a.graceDeadline!)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          icon={<FastForward className="size-4" />}
          loading={pending === "grace"}
          disabled={disabled || !selected}
          onClick={() => selected && void advance("grace", { toGraceDeadlineOf: selected.id }, `past the grace deadline of ${selected.email}`)}
        >
          Skip to deadline
        </Button>
      </div>
      {!clock.demoMode && <p className="text-xs text-muted">Fast-forward is only available on demo deployments (DEMO_MODE=true and the pool deployed in demo mode).</p>}
    </Card>
  );
}

interface LogLine extends ResetLogEvent {
  at: number;
}

function ResetCard({ demoMode }: { demoMode: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [lines, setLines] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const run = async () => {
    setStatus("running");
    setLines([]);
    const outcome: { status: "done" | "error" | null } = { status: null };
    const append = (event: ResetLogEvent) => {
      setLines((ls) => [...ls, { ...event, at: Date.now() }]);
      if (event.level === "done") outcome.status = "done";
      if (event.level === "error") outcome.status = "error";
    };
    try {
      const res = await adminFetch("/api/admin/demo/reset", { method: "POST" });
      if (res.status === 401) return redirectToLogin();
      if (!isEventStream(res)) {
        append({ level: "error", message: (await errorFromResponse(res)).message });
      } else {
        await readSseEvents<ResetLogEvent>(res, append);
      }
    } catch (err) {
      append({ level: "error", message: `Connection lost: ${toAdminApiError(err).message}` });
    }
    if (outcome.status === null) append({ level: "error", message: "The server stopped reporting progress before the reset finished." });
    setStatus(outcome.status === "done" ? "done" : "error");
    // No automatic refetch: a reseed may recreate the admin user, and the
    // redirect to /login would hide this log. "Reload" does it on demand.
    void refreshDemoClock();
  };

  return (
    <Card className="flex flex-col gap-5">
      <CardHeader
        eyebrow="Demo data"
        title={
          <span className="inline-flex items-center gap-2">
            <RotateCcw aria-hidden className="size-5 text-primary-text" /> Reset demo
          </span>
        }
        description="Redeploys the three contracts from the stored wasm and reseeds agents, investors, notes and card spends. Takes a few minutes; the current deployment is abandoned."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="danger" icon={<RotateCcw className="size-4" />} loading={status === "running"} disabled={!demoMode || status === "running"} onClick={() => setConfirming(true)}>
          {status === "running" ? "Resetting…" : "Reset demo"}
        </Button>
        {status === "done" && (
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => window.location.reload()}>
            Reload the admin panel
          </Button>
        )}
        {!demoMode && <span className="text-xs text-muted">Only available when DEMO_MODE=true.</span>}
      </div>
      {lines.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-card-muted">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs font-semibold text-muted">
            {status === "running" && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
            {status === "done" && <CircleCheck aria-hidden className="size-3.5 text-emerald-500" />}
            {status === "error" && <CircleX aria-hidden className="size-3.5 text-red-500" />}
            Progress log
          </div>
          <ol ref={logRef} aria-live="polite" className="max-h-80 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
            {lines.map((line, i) => (
              <li
                key={i}
                className={cn(
                  "flex gap-3",
                  line.level === "error" && "text-red-600 dark:text-red-400",
                  line.level === "done" && "font-semibold text-emerald-700 dark:text-emerald-400",
                )}
              >
                <time className="shrink-0 text-subtle">{formatTime(line.at, { seconds: true })}</time>
                <span className="min-w-0 break-words">{line.message}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title="Reset the demo?"
        description="Every agent, note, card spend and investor position of the current deployment is replaced by fresh seed data on newly deployed contracts. You may need to sign in again afterwards."
        confirmLabel="Reset demo"
        onConfirm={async () => {
          void run();
        }}
      />
    </Card>
  );
}

function DeploymentCard({ overview }: { overview: AdminOverviewResponse }) {
  const d = overview.deployment;
  return (
    <Card className="flex flex-col gap-5">
      <CardHeader
        eyebrow="Deployment"
        title={
          <span className="inline-flex items-center gap-2">
            <Server aria-hidden className="size-5 text-primary-text" /> Current contracts
          </span>
        }
        description="Stellar testnet. Contract ids come from the active deployment, so a reset needs no config change."
      />
      {d ? (
        <div className="rounded-xl border border-line px-4 py-1">
          <CardRow label="Network" value={<Badge tone="blue">{d.network}</Badge>} />
          <CardRow label="advance_pool" value={<Address address={d.advancePool} label="contract" explorerBase={d.explorerBase} />} />
          <CardRow label="cpcv_note" value={<Address address={d.cpcvNote} label="contract" explorerBase={d.explorerBase} />} />
          <CardRow label="tEURC" value={<Address address={d.teurc} label="contract" explorerBase={d.explorerBase} />} />
          <CardRow label="RPC" value={<span className="font-mono text-xs break-all">{d.rpcUrl}</span>} />
        </div>
      ) : (
        <p className="text-sm text-muted">No active deployment could be read.</p>
      )}
    </Card>
  );
}

/** /admin/demo: protocol clock fast-forward, Reset demo with a live log, and the deployment (spec §5.7, §11). */
export function DemoPanel() {
  const overview = useAdminResource<AdminOverviewResponse>("/api/admin/overview");
  const agents = useAdminResource<AdminAgentsResponse>("/api/admin/agents");
  const refreshAll = () => {
    overview.refresh();
    agents.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Demo"
        title="Demo controls:"
        accent="time and data"
        description="Move the protocol clock forward to show interest and grace periods, or start over with fresh seed data."
      />
      {overview.loading ? (
        <div aria-busy className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-card" />
          <Skeleton className="h-96 rounded-card" />
        </div>
      ) : !overview.data ? (
        overview.error && <LoadError error={overview.error} onRetry={overview.refresh} />
      ) : (
        <>
          <WarningsBanner warnings={overview.data.warnings} />
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <ClockCard overview={overview.data} agents={agents.data} onMoved={refreshAll} />
            <div className="flex flex-col gap-6">
              <ResetCard demoMode={overview.data.clock.demoMode} />
              <DeploymentCard overview={overview.data} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
