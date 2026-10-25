import { Ban, TriangleAlert } from "lucide-react";
import type { AgentOverviewResponse } from "@/lib/api-types";
import { formatProtocolDate, formatStroops } from "@/lib/format";
import { toBig } from "./money";

export function CarriedDebtBanner({ data }: { data: AgentOverviewResponse }) {
  const p = data.position;
  if (!p) return null;
  const carried = toBig(p.carriedDebt);
  return (
    <>
      {p.blocked && (
        <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <Ban className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-bold">New credit is paused on your account</p>
            <p className="mt-0.5">A carried debt was written off. Your card balance still works; contact explorador to restore credit.</p>
          </div>
        </div>
      )}
      {carried > 0n && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold">
              {formatStroops(carried)} carried from a cancelled deal
            </p>
            <p className="mt-0.5 leading-relaxed">
              A buyer walked away, so the amount you had used on that deal moved to your account. Your next settlements repay it first, and it
              reduces the credit available on your other deals. Interest keeps running.
            </p>
            {p.graceDeadline && (
              <p className="mt-2 font-semibold tabular-nums">
                Grace period ends {formatProtocolDate(p.graceDeadline)} · {graceCountdown(p.graceDeadline, data.demo.protocolNow)}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function graceCountdown(deadline: number, now: number): string {
  const days = Math.ceil((deadline - now) / 86_400);
  if (days <= 0) return "grace period over";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
