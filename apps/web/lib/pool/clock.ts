// Demo clock (spec §5.7) for the header chip: protocol time and the offset
// that `advance_clock` added. There is no view for `demo_offset`, so it is
// estimated as protocol_now − wall clock (ledger time trails the wall clock by
// a few seconds) and rounded to the minute; the chip only shows days.

import type { DemoClock } from "@/lib/types/api";
import type { PoolStats } from "@/lib/types/chain";
import { DAY_SECS } from "@/lib/units";

export function demoClock(stats: Pick<PoolStats, "protocolNow" | "params">, nowMs = Date.now()): DemoClock {
  const protocolNow = Number(stats.protocolNow);
  const drift = protocolNow - Math.floor(nowMs / 1000);
  return {
    protocolNow,
    offsetSecs: drift <= 0 ? 0 : Math.round(drift / 60) * 60,
    demoMode: stats.params.demoMode,
  };
}

/** Protocol day number (days since the Unix epoch on the protocol clock). */
export const protocolDay = (protocolNow: bigint | number): number => Math.floor(Number(protocolNow) / DAY_SECS);

/** A note is overdue when it is still active and the protocol date is past its escritura date (spec §2). */
export const isOverdue = (status: string, escrituraDay: number, protocolNow: bigint | number): boolean =>
  status === "Active" && protocolDay(protocolNow) > escrituraDay;
