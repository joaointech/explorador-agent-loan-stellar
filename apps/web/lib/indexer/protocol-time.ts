// Protocol timestamps for indexed events (spec §5.7): protocol time =
// ledger close time + demo offset in effect at that event. Each
// `ClockAdvanced { secs, protocol_now }` pins the offset exactly
// (after = protocol_now − close time; before = after − secs), so events are
// timed precisely even when older history has aged out of RPC retention.

import { compareEvents, dataBigInt, EventType, type DecodedEvent } from "./events";

export interface ClockAnchor {
  /** Offset in effect right after the anchor (seconds). */
  offsetAfter: number;
}

/** Offset implied by a stored ClockAdvanced event (its protocolTs is protocol_now; data holds the close time). */
export function anchorFromClockEvent(e: { closedAt: number; data: unknown }): ClockAnchor | null {
  const protocolNow = dataBigInt(e.data, "protocolNow");
  if (protocolNow === null || !e.closedAt) return null;
  return { offsetAfter: Number(protocolNow) - e.closedAt };
}

/** True when neither a stored nor an in-batch ClockAdvanced pins the offset (the caller then estimates it from the chain). */
export const needsCurrentOffset = (events: DecodedEvent[], prior: ClockAnchor | null): boolean =>
  prior === null && !events.some((e) => e.type === EventType.ClockAdvanced);

/**
 * Returns the protocol timestamp of each event (same order as `events`, which
 * must belong to one deployment). `prior` is the last anchor stored before
 * this batch; `currentOffset` (protocol_now − latest close time) is used only
 * when no anchor is known at all.
 */
export function assignProtocolTimes(events: DecodedEvent[], prior: ClockAnchor | null, currentOffset: number): number[] {
  const order = events.map((e, i) => ({ e, i })).sort((a, b) => compareEvents(a.e, b.e));
  const out = new Array<number>(events.length);

  let offset: number | null = prior?.offsetAfter ?? null;
  if (offset === null) {
    const first = order.find(({ e }) => e.type === EventType.ClockAdvanced);
    if (first) {
      const protocolNow = dataBigInt(first.e.data, "protocolNow");
      const secs = dataBigInt(first.e.data, "secs");
      if (protocolNow !== null && secs !== null) offset = Number(protocolNow) - first.e.closedAt - Number(secs);
    }
  }
  if (offset === null) offset = currentOffset;

  for (const { e, i } of order) {
    if (e.type === EventType.ClockAdvanced) {
      const protocolNow = dataBigInt(e.data, "protocolNow");
      if (protocolNow !== null) {
        offset = Number(protocolNow) - e.closedAt;
        out[i] = Number(protocolNow);
        continue;
      }
    }
    out[i] = e.closedAt + offset;
  }
  return out;
}
