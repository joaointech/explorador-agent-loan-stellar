// Read models for the public pool endpoints (spec §5.5, §9.7):
// GET /api/pool/stats and GET /api/pool/snapshots.

import { db } from "@/lib/db";
import { loadTotalAdvanced } from "@/lib/indexer/queries";
import { emptyCounts, getStatusCounts } from "@/lib/indexer/registry";
import { jsonify } from "@/lib/json";
import { requireDeployment, resolveDeployment, type ResolvedDeployment } from "@/lib/stellar/deployment";
import type { PoolSnapshotPoint, PoolSnapshotsResponse, PoolStatsResponse, StatusCounts } from "@/lib/types/api";
import { DAY_SECS } from "@/lib/units";

import { projectedApy, sharePriceNumber, trailingApy, TRAILING_WINDOW_SECS, type SharePricePoint } from "./apy";
import { demoClock } from "./clock";
import { getPoolStatsCached } from "./stats-cache";

/** Snapshots of the current deployment only: a demo reset starts a new history. */
const snapshotScope = (d: ResolvedDeployment) => (d.createdAt ? { createdAt: { gte: d.createdAt } } : {});

/** The snapshots trailingApy can use: newest one ≥ 7 protocol days old, and the oldest one. */
async function trailingCandidates(d: ResolvedDeployment, protocolNow: number): Promise<SharePricePoint[]> {
  const scope = snapshotScope(d);
  const [weekOld, oldest] = await Promise.all([
    db.poolSnapshot.findFirst({ where: { ...scope, protocolTs: { lte: BigInt(protocolNow - TRAILING_WINDOW_SECS) } }, orderBy: [{ protocolTs: "desc" }, { createdAt: "desc" }] }),
    db.poolSnapshot.findFirst({ where: scope, orderBy: [{ protocolTs: "asc" }, { createdAt: "asc" }] }),
  ]);
  return [weekOld, oldest].filter((s) => s !== null).map((s) => ({ t: Number(s.protocolTs), priceScaled: BigInt(s.sharePrice) }));
}

export async function getPoolStatsResponse(): Promise<PoolStatsResponse> {
  const deployment = await requireDeployment();
  const stats = await getPoolStatsCached();
  const protocolNow = Number(stats.protocolNow);
  const [notes, totalAdvanced, history] = await Promise.all([
    getStatusCounts().catch((err): StatusCounts => {
      console.warn(`[pool] note counts unavailable: ${err instanceof Error ? err.message : err}`);
      return emptyCounts();
    }),
    loadTotalAdvanced(deployment.info.advancePool),
    trailingCandidates(deployment, protocolNow),
  ]);
  const projected = projectedApy(stats);
  return {
    stats: jsonify(stats),
    apy: {
      target: stats.params.seniorTargetBps / 10_000,
      projectedSenior: projected.senior,
      projectedJunior: projected.junior,
      trailing7dSenior: trailingApy({ t: protocolNow, priceScaled: stats.sharePriceScaled }, history),
    },
    notes,
    totalAdvanced: totalAdvanced.toString(),
    clock: demoClock(stats),
  };
}

export const SNAPSHOT_RANGES = { "7d": 7, "30d": 30, all: null } as const;
export type SnapshotRange = keyof typeof SNAPSHOT_RANGES;
export const MAX_SNAPSHOT_POINTS = 500;

/** Evenly spaced subset that keeps the first and last rows. */
export function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]);
}

interface SnapshotRow {
  protocolTs: bigint;
  seniorAssets: bigint;
  juniorAssets: bigint;
  totalDebt: bigint;
  sharePrice: string;
}

export function toSnapshotPoint(r: SnapshotRow): PoolSnapshotPoint {
  return {
    t: Number(r.protocolTs),
    sharePrice: sharePriceNumber(BigInt(r.sharePrice)),
    tvl: (r.seniorAssets + r.juniorAssets).toString(),
    debt: r.totalDebt.toString(),
    seniorAssets: r.seniorAssets.toString(),
    juniorAssets: r.juniorAssets.toString(),
  };
}

/** Share price + TVL series over the last 7/30 protocol days (or everything), one point per protocol timestamp. */
export async function getSnapshotsResponse(range: SnapshotRange): Promise<PoolSnapshotsResponse> {
  const deployment = await resolveDeployment();
  if (!deployment) return { range, points: [] };
  const scope = snapshotScope(deployment);
  const latest = await db.poolSnapshot.findFirst({ where: scope, orderBy: [{ protocolTs: "desc" }, { createdAt: "desc" }], select: { protocolTs: true } });
  if (!latest) return { range, points: [] };
  const days = SNAPSHOT_RANGES[range];
  const rows = await db.poolSnapshot.findMany({
    where: { ...scope, ...(days === null ? {} : { protocolTs: { gte: latest.protocolTs - BigInt(days * DAY_SECS) } }) },
    orderBy: [{ protocolTs: "asc" }, { createdAt: "asc" }],
  });
  // The share price only moves with protocol time: keep the latest row per timestamp.
  const perTimestamp = rows.filter((r, i) => i === rows.length - 1 || rows[i + 1].protocolTs !== r.protocolTs);
  return { range, points: downsample(perTimestamp, MAX_SNAPSHOT_POINTS).map(toSnapshotPoint) };
}
