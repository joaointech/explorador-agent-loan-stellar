"use client";

import { FastForward, RotateCw, Users } from "lucide-react";
import { useState } from "react";

import { refreshDemoClock } from "@/components/shell/demo-clock";
import { Address } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { DateText } from "@/components/ui/date-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/typography";
import type { AdminAgentRow, AdminAgentsResponse, AdvanceClockResponse } from "@/lib/types/api";

import { postAdmin, toAdminApiError } from "./api";
import { LoadError } from "./confirm-dialog";
import { useAdminResource } from "./use-admin-resource";
import { WriteOffDialog } from "./write-off-dialog";

/** Why "Write off" is disabled for this agent, or null when it's allowed. */
function writeOffBlocker(agent: AdminAgentRow): string | null {
  if (agent.canWriteOff) return null;
  if (BigInt(agent.carriedDebt) === 0n) return "No carried debt to write off";
  return "Available once the grace deadline has passed (protocol clock)";
}

/** /admin/agents: agents, their cards and on-chain positions; write-off after the grace deadline (spec §10.2). */
export function AgentsPanel() {
  const toast = useToast();
  const { data, error, loading, refreshing, refresh } = useAdminResource<AdminAgentsResponse>("/api/admin/agents");
  const [writeOff, setWriteOff] = useState<AdminAgentRow | null>(null);
  const [skipping, setSkipping] = useState<string | null>(null);
  const clock = data?.clock ?? null;

  const skipToDeadline = async (agent: AdminAgentRow) => {
    setSkipping(agent.id);
    try {
      const res = await postAdmin<AdvanceClockResponse>("/api/admin/demo/advance-clock", { toGraceDeadlineOf: agent.id });
      toast.success(`Protocol clock moved past the grace deadline of ${agent.email}`, {
        description: "Write-off is now available.",
        action: { label: "View transaction", href: res.explorerUrl },
      });
      void refreshDemoClock();
      refresh();
    } catch (err) {
      toast.error("Couldn't move the clock", { description: toAdminApiError(err).message });
    } finally {
      setSkipping(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Agents"
        title="Agents and"
        accent="their credit"
        description="Live positions from advance_pool. Carried debt from cancelled deals can be written off once its 180-day grace period is over."
        actions={
          <Button variant="secondary" size="sm" icon={<RotateCw className="size-4" />} loading={refreshing && !loading} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {loading ? (
        <div aria-busy className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : !data && error ? (
        <LoadError error={error} onRetry={refresh} />
      ) : (
        <DataTable
          rows={data?.agents ?? []}
          rowKey={(a) => a.id}
          empty={<EmptyState variant="plain" icon={<Users />} title="No agents yet" description="Agents appear here after they sign up with their email." />}
          columns={[
            {
              key: "agent",
              header: "Agent",
              cell: (a) => (
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-heading">{a.email}</span>
                  {a.displayName && <span className="text-xs text-muted">{a.displayName}</span>}
                </div>
              ),
            },
            {
              key: "account",
              header: "Smart account",
              cell: (a) => (a.smartAccount ? <Address address={a.smartAccount} label="smart account" /> : <Badge tone="neutral">Onboarding</Badge>),
            },
            {
              key: "card",
              header: "Card",
              hideBelow: "md",
              cell: (a) =>
                a.cardLast4 ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-sm">•••• {a.cardLast4}</span>
                    <span className={a.cardEnabledOnChain ? "text-xs font-medium text-emerald-600 dark:text-emerald-400" : "text-xs text-muted"}>
                      {a.cardEnabledOnChain ? "Enabled on-chain" : "Not enabled"}
                    </span>
                  </div>
                ) : (
                  <span className="text-subtle">—</span>
                ),
            },
            {
              key: "notes",
              header: "Notes",
              align: "right",
              hideBelow: "sm",
              cell: (a) => (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="tabular-nums">{a.notes}</span>
                  {a.activeNotes > 0 && <span className="text-xs text-muted">{a.activeNotes} active</span>}
                </div>
              ),
            },
            {
              key: "debt",
              header: "Debt / carried",
              align: "right",
              cell: (a) =>
                a.positionSource === "none" ? (
                  <span className="text-subtle">—</span>
                ) : (
                  <div className="flex flex-col items-end gap-0.5">
                    <Amount value={a.debt} />
                    {BigInt(a.carriedDebt) > 0n ? (
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">
                        carried <Amount value={a.carriedDebt} />
                      </span>
                    ) : (
                      <span className="text-xs text-muted">no carried debt</span>
                    )}
                    {a.positionSource === "cache" && (
                      <span className="text-[11px] text-muted" title="The live read failed: this is the last known position">
                        cached
                      </span>
                    )}
                  </div>
                ),
            },
            {
              key: "grace",
              header: "Grace deadline",
              cell: (a) =>
                a.graceDeadline !== null ? (
                  <div className="flex flex-col gap-0.5">
                    <DateText value={a.graceDeadline} />
                    {clock && <Countdown to={a.graceDeadline} now={clock.protocolNow} className="text-xs" />}
                  </div>
                ) : (
                  <span className="text-subtle">—</span>
                ),
            },
            {
              key: "blocked",
              header: "Blocked",
              cell: (a) => (a.blocked ? <Badge tone="red">Blocked</Badge> : <span className="text-subtle">No</span>),
            },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right",
              cell: (a) => {
                // Write off only concerns agents with carried debt; it is enabled once their grace deadline has passed.
                if (BigInt(a.carriedDebt) === 0n) return null;
                const blocker = writeOffBlocker(a);
                const canSkip = Boolean(clock?.demoMode) && !a.canWriteOff && a.graceDeadline !== null;
                return (
                  <div className="flex flex-col items-end gap-1.5">
                    <span title={blocker ?? undefined}>
                      <Button size="sm" variant="danger" disabled={blocker !== null} onClick={() => setWriteOff(a)}>
                        Write off
                      </Button>
                    </span>
                    {canSkip && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        icon={<FastForward className="size-3.5" />}
                        loading={skipping === a.id}
                        disabled={skipping !== null}
                        onClick={() => void skipToDeadline(a)}
                      >
                        Skip to deadline
                      </Button>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <WriteOffDialog agent={writeOff} onOpenChange={(open) => !open && setWriteOff(null)} onDone={refresh} />
    </div>
  );
}
