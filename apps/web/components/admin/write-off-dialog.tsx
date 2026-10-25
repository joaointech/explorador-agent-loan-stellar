"use client";

import { Amount } from "@/components/ui/amount";
import { CardRow } from "@/components/ui/card";
import { DateText } from "@/components/ui/date-text";
import { useToast } from "@/components/ui/toast";
import type { AdminAgentRow, AdminWriteOffResponse } from "@/lib/types/api";

import { postAdmin } from "./api";
import { ConfirmDialog } from "./confirm-dialog";

/** "Write off" (spec §4.6): carried debt past its grace deadline leaves the book, junior absorbs it first. */
export function WriteOffDialog({
  agent,
  onOpenChange,
  onDone,
}: {
  /** The agent to write off; null keeps the dialog closed. */
  agent: AdminAgentRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  return (
    <ConfirmDialog
      open={agent !== null}
      onOpenChange={onOpenChange}
      tone="danger"
      title="Write off carried debt?"
      description="The debt leaves the book. The loss is taken from explorador's junior (first-loss) tranche first, and from senior investors only if junior runs out. The agent is blocked from new credit."
      confirmLabel="Write off"
      onConfirm={async () => {
        if (!agent) return;
        const res = await postAdmin<AdminWriteOffResponse>(`/api/admin/agents/${agent.id}/write-off`);
        toast.success(`Carried debt of ${agent.email} written off`, {
          description: res.writtenOff > 0 ? `${res.writtenOff} cancelled ${res.writtenOff === 1 ? "deal is" : "deals are"} now marked written off.` : undefined,
          action: { label: "View transaction", href: res.explorerUrl },
        });
        onDone();
      }}
    >
      {agent && (
        <div className="rounded-xl border border-line px-4 py-1">
          <CardRow label="Agent" value={agent.email} />
          <CardRow label="Carried debt (principal + interest)" value={<Amount value={agent.carriedDebt} className="text-red-600 dark:text-red-400" />} />
          <CardRow label="Grace deadline" value={<DateText value={agent.graceDeadline} format="datetime" />} />
        </div>
      )}
    </ConfirmDialog>
  );
}
