"use client";
import { Clock } from "lucide-react";
import type { DemoClockDto } from "@/lib/api-types";
import { formatProtocolDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function demoOffsetDays(demo: DemoClockDto): number {
  return Math.round(demo.offsetSecs / 86_400);
}

/** "Demo clock · 14 Jan 2027 (+81 days)" — only when the protocol clock is fast-forwarded. */
export function DemoClockChip({ demo, className }: { demo: DemoClockDto | null | undefined; className?: string }) {
  if (!demo || demo.offsetSecs <= 0) return null;
  const days = demoOffsetDays(demo);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-400/95 px-2.5 py-1 text-[11px] font-semibold text-amber-950 shadow-sm",
        className,
      )}
      title="The protocol clock has been fast-forwarded for the demo"
    >
      <Clock className="size-3.5" />
      <span className="tabular-nums">
        Demo clock · {formatProtocolDate(demo.protocolNow)} (+{days} {days === 1 ? "day" : "days"})
      </span>
    </span>
  );
}
