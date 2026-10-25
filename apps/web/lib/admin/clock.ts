// The protocol clock as the admin panel sees it (spec §5.7), and the demo
// fast-forward: `advance_pool.advance_clock(secs)` by whole days, or to the
// grace deadline of an agent so write-off becomes available.

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { demoClock } from "@/lib/pool/clock";
import { advanceClock, explorerUrl, readAgentPosition, readPoolStats } from "@/lib/stellar/contracts";
import type { AdvanceClockRequest, AdvanceClockResponse, DemoClock } from "@/lib/types/api";
import type { PoolStats } from "@/lib/types/chain";
import { DAY_SECS } from "@/lib/units";

import { chainHttpError } from "./chain-errors";

/** advance_pool caps one advance_clock call at 400 days. */
export const MAX_ADVANCE_SECS = 400 * DAY_SECS;
/** Lands a little past the deadline so `now ≥ grace_deadline` holds when the write-off runs. */
const DEADLINE_MARGIN_SECS = 60;

/**
 * The header chip's clock (lib/pool/clock: `demo_offset` estimated against the
 * wall clock), with `demoMode` also requiring DEMO_MODE=true on this server,
 * since the admin routes refuse to move the clock otherwise.
 */
export function adminClock(stats: Pick<PoolStats, "protocolNow" | "params">): DemoClock {
  const clock = demoClock(stats);
  return { ...clock, demoMode: env().DEMO_MODE && clock.demoMode };
}

/** The protocol clock from `stats()`, or null when the chain can't be read. */
export async function readDemoClock(): Promise<DemoClock | null> {
  try {
    return adminClock(await readPoolStats());
  } catch (err) {
    console.warn(`[admin] protocol clock unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export const protocolDayOf = (clock: Pick<DemoClock, "protocolNow"> | null): number | null =>
  clock ? Math.floor(clock.protocolNow / DAY_SECS) : null;

function assertDemoMode() {
  if (!env().DEMO_MODE) {
    throw new HttpError(409, "DEMO_MODE_DISABLED", "The demo clock can only be moved when DEMO_MODE=true");
  }
}

/** Seconds from the protocol clock to just past an agent's grace deadline. */
async function secsToGraceDeadline(agentUserId: string): Promise<number> {
  const agent = await db.agent.findUnique({ where: { userId: agentUserId }, select: { smartAccount: true, user: { select: { email: true } } } });
  if (!agent) throw new HttpError(404, "NOT_FOUND", "No agent with a smart account has this id");
  const [position, stats] = await Promise.all([readAgentPosition(agent.smartAccount), readPoolStats()]).catch((err: unknown) => {
    throw chainHttpError(err);
  });
  if (position.graceDeadline === null || position.carriedDebt <= 0n) {
    throw new HttpError(409, "NO_GRACE_PERIOD", `${agent.user.email} has no carried debt in a grace period`);
  }
  const secs = Number(position.graceDeadline - stats.protocolNow);
  if (secs <= 0) throw new HttpError(409, "GRACE_ALREADY_OVER", `The grace deadline of ${agent.user.email} has already passed`);
  return secs + DEADLINE_MARGIN_SECS;
}

/** Fast-forwards the protocol clock (admin key, demo mode only). Calls above 400 days are split. */
export async function advanceDemoClock(request: AdvanceClockRequest): Promise<AdvanceClockResponse> {
  assertDemoMode();
  let remaining = "days" in request ? request.days * DAY_SECS : await secsToGraceDeadline(request.toGraceDeadlineOf);

  let txHash = "";
  try {
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_ADVANCE_SECS);
      ({ txHash } = await advanceClock(step));
      remaining -= step;
    }
  } catch (err) {
    throw chainHttpError(err);
  }

  const clock = await readDemoClock();
  return {
    txHash,
    explorerUrl: explorerUrl("tx", txHash),
    clock: clock ?? { protocolNow: Math.floor(Date.now() / 1000), offsetSecs: 0, demoMode: env().DEMO_MODE },
  };
}
