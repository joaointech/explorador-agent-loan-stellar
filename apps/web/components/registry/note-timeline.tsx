import { Ban, CircleCheck, CreditCard, FileCheck, History, Landmark, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { TxLink } from "@/components/ui/address";
import { cn } from "@/components/ui/cn";
import { DateText } from "@/components/ui/date-text";
import { formatNumber } from "@/lib/format";
import type { TimelineEvent } from "@/lib/types/api";

import { describeTimeline, type TimelineIcon, type TimelineTone } from "./timeline";

const ICONS: Record<TimelineIcon, ReactNode> = {
  mint: <FileCheck />,
  line: <Landmark />,
  draw: <CreditCard />,
  settle: <CircleCheck />,
  cancel: <Ban />,
  writeoff: <TriangleAlert />,
  event: <History />,
};

const TONES: Record<TimelineTone, string> = {
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-500/15 dark:text-blue-300",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/15 dark:text-red-300",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300",
};

/** Contract events for one note, oldest first, with protocol dates and tx links. */
export function NoteTimeline({ events }: { events: TimelineEvent[] }) {
  const items = describeTimeline(events);
  if (items.length === 0) {
    return <p className="text-sm text-muted">No indexed events yet. They appear a few seconds after each transaction.</p>;
  }
  return (
    <ol className="flex flex-col">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li key={item.key} className="relative flex gap-3.5">
            <div className="flex flex-col items-center">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:size-4", TONES[item.tone])}>
                {ICONS[item.icon]}
              </span>
              {!last && <span aria-hidden className="my-1 w-0.5 flex-1 rounded-full bg-slate-200 dark:bg-slate-700" />}
            </div>
            <div className={cn("min-w-0 flex-1 pt-1", last ? "pb-0" : "pb-5")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold text-heading">{item.title}</p>
                <p className="text-xs text-muted tabular-nums">
                  {item.at !== null ? <DateText value={item.at} format="datetime" /> : `Ledger ${formatNumber(item.ledger)}`}
                </p>
              </div>
              {item.description && <p className="mt-0.5 text-sm leading-relaxed text-muted">{item.description}</p>}
              {item.txHash && <TxLink hash={item.txHash} className="mt-1 text-xs" />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
