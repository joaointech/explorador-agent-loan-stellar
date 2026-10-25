"use client";
import * as React from "react";
import { Clock, FastForward, RotateCcw, Server } from "lucide-react";
import type { AdminAgentDto, AdminOverviewResponse, AdvanceClockRequest, DemoResetEvent, TxResponse } from "@/lib/api-types";
import { Address, ErrorNote, HexValue, InfoNote, TxLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/input";
import { apiPost, errorMessage } from "@/lib/client/api";
import { postSSE } from "@/lib/client/sse";
import { formatDateTime, formatProtocolDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DemoPanel({ overview, agents, onChanged }: { overview: AdminOverviewResponse | null; agents: AdminAgentDto[] | null; onChanged: () => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <DemoClock overview={overview} agents={agents} onChanged={onChanged} />
      <ResetDemo onChanged={onChanged} />
      <Deployment overview={overview} />
    </div>
  );
}

function DemoClock({ overview, agents, onChanged }: { overview: AdminOverviewResponse | null; agents: AdminAgentDto[] | null; onChanged: () => void }) {
  const demo = overview?.pool.demo;
  const enabled = !!demo?.demoMode;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tx, setTx] = React.useState<string | null>(null);
  const graceAgents = (agents ?? []).filter((a) => a.graceDeadline !== null);
  const [agentId, setAgentId] = React.useState("");
  const selected = graceAgents.find((a) => a.userId === agentId) ?? graceAgents[0];

  async function advance(key: string, body: AdvanceClockRequest) {
    setBusy(key);
    setError(null);
    setTx(null);
    try {
      const r = await apiPost<TxResponse>("/api/admin/demo/advance-clock", body);
      setTx(r.txHash);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const offsetDays = demo ? Math.round(demo.offsetSecs / 86_400) : 0;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2 font-bold">
        <Clock className="size-5 text-primary" /> Demo clock
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums">{demo ? formatProtocolDate(demo.protocolNow) : "…"}</div>
      <p className="text-sm text-muted">
        Protocol date · {offsetDays > 0 ? `+${offsetDays} days ahead of real time` : "in sync with real time"}
      </p>
      {!enabled && demo && <InfoNote className="mt-3">Fast-forward is only available on demo deployments (DEMO_MODE=true).</InfoNote>}
      <div className="mt-4 flex flex-wrap gap-2">
        {[1, 7, 30, 90].map((d) => (
          <Button key={d} size="sm" variant="secondary" disabled={!enabled || busy !== null} loading={busy === `d${d}`} onClick={() => advance(`d${d}`, { days: d })}>
            <FastForward /> +{d} {d === 1 ? "day" : "days"}
          </Button>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm font-semibold">Jump to an agent&apos;s grace deadline</p>
        {graceAgents.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No agent has carried debt in grace right now.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Select value={selected?.userId ?? ""} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
              {graceAgents.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.displayName ?? a.email} · {formatProtocolDate(a.graceDeadline!)}
                </option>
              ))}
            </Select>
            <Button
              variant="warning"
              disabled={!enabled || busy !== null || !selected}
              loading={busy === "grace"}
              onClick={() => selected && advance("grace", { toGraceOf: selected.userId })}
            >
              To grace deadline
            </Button>
          </div>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">
        Moving the clock accrues interest immediately and can make write-offs available. It only ever moves forward.
      </p>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      {tx && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
          Clock advanced. <TxLink hash={tx} label="View transaction" />
        </p>
      )}
    </Card>
  );
}

function ResetDemo({ onChanged }: { onChanged: () => void }) {
  const [confirming, setConfirming] = React.useState(false);
  const [lines, setLines] = React.useState<string[]>([]);
  const [state, setState] = React.useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const logRef = React.useRef<HTMLPreElement>(null);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  async function run() {
    setLines([]);
    setError(null);
    setState("running");
    let finished = false;
    try {
      await postSSE<DemoResetEvent>("/api/admin/demo/reset", {}, (ev) => {
        if (ev.line) setLines((l) => [...l, ev.line]);
        if (ev.error) {
          finished = true;
          setError(ev.error);
          setState("error");
        } else if (ev.done) {
          finished = true;
          setState("done");
        }
      });
      if (!finished) setState("done");
    } catch (e) {
      setError(errorMessage(e));
      setState("error");
    } finally {
      onChanged();
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2 font-bold">
        <RotateCcw className="size-5 text-primary" /> Reset demo
      </div>
      <p className="mt-1 text-sm text-muted">
        Redeploys the three contracts from the stored wasm hashes and reseeds agents, investors and five CPCVs. Takes a few minutes.
      </p>
      <Button className="mt-4" variant="danger" onClick={() => setConfirming(true)} disabled={state === "running"} loading={state === "running"}>
        {state === "running" ? "Resetting…" : "Reset demo"}
      </Button>
      {lines.length > 0 && (
        <pre
          ref={logRef}
          className={cn(
            "mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 font-mono text-[12px] leading-relaxed text-slate-200",
          )}
        >
          {lines.join("\n")}
        </pre>
      )}
      {state === "done" && <p className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">Demo reset complete.</p>}
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Reset the whole demo?"
        confirmLabel="Reset demo"
        confirmVariant="danger"
        description="All notes, positions and balances on the current deployment are abandoned and a fresh deployment is seeded. Agents and investors will see new data."
        onConfirm={() => {
          void run();
        }}
      />
    </Card>
  );
}

function Deployment({ overview }: { overview: AdminOverviewResponse | null }) {
  const d = overview?.deployment ?? null;
  const c = overview?.pool.contracts;
  return (
    <Card className="p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-center gap-2 font-bold">
        <Server className="size-5 text-primary" /> Current deployment
      </div>
      {!c ? (
        <p className="mt-2 text-sm text-muted">Loading…</p>
      ) : (
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          <dl className="divide-y divide-line text-sm">
            <Row label="Network">{c.network}</Row>
            <Row label="tEURC (SEP-41)">
              <Address value={c.teurc} head={6} tail={6} />
            </Row>
            <Row label="CPCV Note (SEP-50)">
              <Address value={c.cpcvNote} head={6} tail={6} />
            </Row>
            <Row label="Advance pool (SEP-56)">
              <Address value={c.advancePool} head={6} tail={6} />
            </Row>
            {d && <Row label="Deployed">{formatDateTime(d.createdAt)}</Row>}
          </dl>
          {d && Object.keys(d.wasmHashes).length > 0 && (
            <dl className="divide-y divide-line text-sm">
              {Object.entries(d.wasmHashes).map(([k, v]) => (
                <Row key={k} label={`${k} wasm`}>
                  <HexValue value={v} />
                </Row>
              ))}
            </dl>
          )}
        </div>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
