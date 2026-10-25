// Response builders shared by the public, agent and admin routes (§9.7).
import { unformatProof } from "@advance/zk";
import type {
  ChainEventDto,
  ContractsDto,
  DemoClockDto,
  NoteCountsDto,
  NoteMetadataResponse,
  PoolStatsDto,
  PoolStatsResponse,
  RegistryDetailResponse,
  RegistryNote,
  SnapshotPoint,
} from "@/lib/api-types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { ChainEvent } from "@/lib/generated/prisma/client";
import { HttpError } from "@/lib/http";
import {
  DAY,
  projectedApy,
  readLine,
  readNote,
  readNoteCount,
  readNotes,
  readStats,
  registryNoteDto,
  statsDto,
  tag,
  trailingApy,
  type RawNote,
} from "@/lib/pool";
import { readContract } from "@/lib/stellar/client";
import { getContracts } from "@/lib/stellar/contracts";
import { ContractCallError } from "@/lib/stellar/errors";

export const STROOPS_PER_CENT = 100_000n;

// ---------------------------------------------------------------- shared bits

export async function contractsDto(): Promise<ContractsDto> {
  const c = await getContracts();
  return { network: env.network, teurc: c.teurc, cpcvNote: c.cpcvNote, advancePool: c.advancePool };
}

export async function demoClock(protocolNow?: number): Promise<DemoClockDto> {
  const [offset, now] = await Promise.all([
    readContract<bigint>("advancePool", "demo_offset").catch(() => 0n),
    protocolNow ?? readContract<bigint>("advancePool", "protocol_now").then(Number),
  ]);
  return { demoMode: env.demoMode, offsetSecs: Number(offset), protocolNow: Number(now) };
}

export async function noteCounts(): Promise<NoteCountsDto> {
  const rows = await db.cpcv.groupBy({ by: ["status"], where: { noteId: { not: null } }, _count: { _all: true } });
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const counts = { active: n("MINTED"), settled: n("SETTLED"), cancelled: n("CANCELLED"), writtenOff: n("WRITTEN_OFF"), total: 0 };
  counts.total = counts.active + counts.settled + counts.cancelled + counts.writtenOff;
  return counts;
}

export function eventDto(e: ChainEvent): ChainEventDto {
  return {
    type: e.type,
    contract: e.contract,
    ledger: e.ledger,
    txHash: e.txHash,
    protocolTs: e.protocolTs === null ? null : Number(e.protocolTs),
    createdAt: e.createdAt.toISOString(),
    data: (e.data ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------- pool

async function trailing7d(st: PoolStatsDto): Promise<number | null> {
  const target = BigInt(st.protocolNow - 7 * DAY);
  const then =
    (await db.poolSnapshot.findFirst({ where: { protocolTs: { lte: target } }, orderBy: { protocolTs: "desc" } })) ??
    (await db.poolSnapshot.findFirst({ orderBy: { protocolTs: "asc" } }));
  if (!then) return null;
  const dt = st.protocolNow - Number(then.protocolTs);
  if (dt < 3600) return null;
  return trailingApy(st.sharePrice, Number(BigInt(then.sharePrice)) / 1e18, dt);
}

async function totalAdvanced(): Promise<string> {
  const rows = await db.$queryRaw<{ total: string | null }[]>`
    SELECT COALESCE(SUM((data->>'from_credit')::numeric), 0)::text AS total FROM "ChainEvent" WHERE type = 'card_draw'`;
  return (rows[0]?.total ?? "0").split(".")[0];
}

export async function poolStatsResponse(): Promise<PoolStatsResponse> {
  const st = statsDto(await readStats());
  const [trailing, advanced, notes, demo, contracts] = await Promise.all([
    trailing7d(st),
    totalAdvanced(),
    noteCounts(),
    demoClock(st.protocolNow),
    contractsDto(),
  ]);
  const senior = BigInt(st.seniorAssets);
  const junior = BigInt(st.juniorAssets);
  const tvl = senior + junior;
  return {
    stats: st,
    apy: { ...projectedApy(st), trailing7d: trailing },
    tvl: tvl.toString(),
    coverage: tvl > 0n ? Number(junior) / Number(tvl) : 0,
    totalAdvanced: advanced,
    notes,
    demo,
    contracts,
  };
}

export async function snapshotPoints(range: "7d" | "30d" | "all"): Promise<SnapshotPoint[]> {
  const st = statsDto(await readStats());
  const since = range === "all" ? null : BigInt(st.protocolNow - (range === "7d" ? 7 : 30) * DAY);
  const rows = await db.poolSnapshot.findMany({
    where: since === null ? {} : { protocolTs: { gte: since } },
    orderBy: [{ protocolTs: "asc" }, { createdAt: "asc" }],
    take: 2000,
  });
  const eur = (s: bigint | string) => Number(BigInt(s)) / 1e7;
  const points: SnapshotPoint[] = rows.map((r) => ({
    t: Number(r.protocolTs),
    realT: Math.floor(r.createdAt.getTime() / 1000),
    sharePrice: Number(BigInt(r.sharePrice)) / 1e18,
    tvlEur: eur(r.seniorAssets) + eur(r.juniorAssets),
    debtEur: eur(r.totalDebt),
    seniorEur: eur(r.seniorAssets),
    juniorEur: eur(r.juniorAssets),
  }));
  points.push({
    t: st.protocolNow,
    realT: Math.floor(Date.now() / 1000),
    sharePrice: st.sharePrice,
    tvlEur: eur(st.seniorAssets) + eur(st.juniorAssets),
    debtEur: eur(st.totalDebt),
    seniorEur: eur(st.seniorAssets),
    juniorEur: eur(st.juniorAssets),
  });
  // A snapshot taken in the same request has the same timestamps as the live point; keep the latest.
  return points.filter((p, i) => i === points.length - 1 || p.t !== points[i + 1].t || p.realT !== points[i + 1].realT);
}

// ---------------------------------------------------------------- registry

let notesCache: { at: number; notes: RawNote[] } | null = null;

/** All notes from the chain (cached 5 s per process). */
export async function allNotes(): Promise<RawNote[]> {
  if (notesCache && Date.now() - notesCache.at < 5000) return notesCache.notes;
  const count = Number(await readNoteCount());
  const pages: Promise<RawNote[]>[] = [];
  for (let start = 1; start <= count; start += 50) pages.push(readNotes(start, 50));
  const notes = (await Promise.all(pages)).flat();
  notesCache = { at: Date.now(), notes };
  return notes;
}

export function invalidateNotes() {
  notesCache = null;
}

async function noteExtras(ids: number[]) {
  const rows = await db.cpcv.findMany({ where: { noteId: { in: ids } }, select: { noteId: true, status: true, mintTxHash: true } });
  const minted = await db.chainEvent.findMany({ where: { type: "note_minted" }, select: { txHash: true, data: true } });
  const byId = new Map<number, { writtenOff: boolean; mintTxHash: string | null }>();
  for (const m of minted) {
    const id = Number((m.data as { id?: unknown }).id);
    byId.set(id, { writtenOff: false, mintTxHash: m.txHash });
  }
  for (const r of rows) {
    const prev = byId.get(r.noteId!);
    byId.set(r.noteId!, { writtenOff: r.status === "WRITTEN_OFF", mintTxHash: r.mintTxHash ?? prev?.mintTxHash ?? null });
  }
  return byId;
}

export async function registryNotes(): Promise<RegistryNote[]> {
  const [notes, st] = await Promise.all([allNotes(), readStats()]);
  const extras = await noteExtras(notes.map((n) => Number(n.id)));
  return notes.map((n) =>
    registryNoteDto(n, {
      ltvBps: Number(st.params.ltv_bps),
      protocolNow: Number(st.protocol_now),
      mintTxHash: extras.get(Number(n.id))?.mintTxHash,
      writtenOff: extras.get(Number(n.id))?.writtenOff,
    }),
  );
}

const PUBLIC_SIGNAL_LABELS = [
  "agent_field",
  "total_commission_cents",
  "agent_commission_cents",
  "escritura_day",
  "commitment",
  "nullifier",
  "attester_ax",
  "attester_ay",
  "nullifier_secret_commitment",
];

const HIDDEN = [
  "Buyer and seller names",
  "Buyer and seller NIFs (tax numbers)",
  "Sale price",
  "Commission rate",
  "Property address",
  "CPCV signing date",
];

const hexToDec = (h: string | Buffer | Uint8Array) => BigInt("0x" + (typeof h === "string" ? h : Buffer.from(h).toString("hex"))).toString();

/** On-chain proof (A negated, G2 as c1‖c0) → hex + snarkjs JSON (A un-negated). */
function toSnarkjs(proof: { a: Buffer; b: Buffer; c: Buffer }) {
  const hex = { a: Buffer.from(proof.a).toString("hex"), b: Buffer.from(proof.b).toString("hex"), c: Buffer.from(proof.c).toString("hex") };
  return { ...hex, snarkjs: unformatProof(hex) };
}

function attributes(n: RegistryNote) {
  return [
    { trait_type: "Status", value: n.status },
    { trait_type: "Total commission (EUR)", value: Number(BigInt(n.totalCommission) / 100_000n) / 100 },
    { trait_type: "Agent commission (EUR)", value: Number(BigInt(n.agentCommission) / 100_000n) / 100 },
    { trait_type: "Credit limit (EUR)", value: Number(BigInt(n.creditLimit) / 100_000n) / 100 },
    { trait_type: "Escritura date", value: new Date(n.escrituraDay * DAY * 1000).toISOString().slice(0, 10) },
    { trait_type: "Soulbound", value: "yes" },
  ];
}

export function noteMetadata(n: RegistryNote): NoteMetadataResponse {
  return {
    name: `CPCV Note #${n.id}`,
    description:
      "Soulbound note proving, with a zero-knowledge proof verified on Stellar, that explorador attested a real promissory contract (CPCV) for this agent. Personal data is never published.",
    external_url: `${env.appUrl}/registry/${n.id}`,
    attributes: attributes(n),
  };
}

export async function registryNote(id: number): Promise<{ raw: RawNote; dto: RegistryNote }> {
  let raw: RawNote;
  try {
    raw = await readNote(id);
  } catch (e) {
    if (e instanceof ContractCallError && e.code === "UnknownNote") throw new HttpError(404, "NOT_FOUND", `Note ${id} does not exist`);
    throw e;
  }
  const [st, extras] = await Promise.all([readStats(), noteExtras([id])]);
  const dto = registryNoteDto(raw, {
    ltvBps: Number(st.params.ltv_bps),
    protocolNow: Number(st.protocol_now),
    mintTxHash: extras.get(id)?.mintTxHash,
    writtenOff: extras.get(id)?.writtenOff,
  });
  return { raw, dto };
}

export async function registryDetail(id: number): Promise<RegistryDetailResponse> {
  const { raw, dto } = await registryNote(id);
  const [attester, agentField, lineView, contracts, demo] = await Promise.all([
    readContract<Buffer[]>("cpcvNote", "attester"),
    readContract<Buffer>("cpcvNote", "agent_field", { addr: raw.agent }),
    readLine(id).catch(() => null),
    contractsDto(),
    demoClock(),
  ]);
  const publicSignals = [
    hexToDec(agentField),
    (BigInt(raw.total_commission) / STROOPS_PER_CENT).toString(),
    (BigInt(raw.agent_commission) / STROOPS_PER_CENT).toString(),
    String(raw.escritura_day),
    hexToDec(raw.commitment),
    hexToDec(raw.nullifier),
    hexToDec(attester[0]),
    hexToDec(attester[1]),
    hexToDec(attester[2]),
  ];
  const proof = toSnarkjs(raw.proof);

  const events = await db.chainEvent.findMany({
    where: {
      OR: [
        { contract: "cpcvNote", data: { path: ["id"], equals: id } },
        { contract: "advancePool", data: { path: ["note_id"], equals: id } },
      ],
    },
    orderBy: [{ ledger: "asc" }, { eventIdx: "asc" }],
  });

  let drawsTotal = 0n;
  if (lineView) {
    if (tag(lineView.line.status) === "Active") drawsTotal = BigInt(lineView.line.principal);
    else {
      const settled = events.find((e) => e.type === "note_settled")?.data as Record<string, string> | undefined;
      const cancelled = events.find((e) => e.type === "note_cancelled")?.data as Record<string, string> | undefined;
      if (settled) drawsTotal = BigInt(settled.debt_repaid ?? 0) - BigInt(settled.interest_paid ?? 0);
      else if (cancelled) drawsTotal = BigInt(cancelled.debt_carried ?? 0);
    }
  }

  const meta = noteMetadata(dto);
  return {
    name: meta.name,
    description: meta.description,
    attributes: meta.attributes,
    note: dto,
    proof: { a: proof.a, b: proof.b, c: proof.c },
    snarkjsProof: proof.snarkjs,
    publicSignals,
    publicSignalLabels: PUBLIC_SIGNAL_LABELS,
    line: lineView
      ? {
          creditLimit: lineView.line.credit_limit.toString(),
          principal: lineView.line.principal.toString(),
          debt: lineView.debt.toString(),
          interest: lineView.interest.toString(),
          available: lineView.available.toString(),
        }
      : null,
    drawsTotal: (drawsTotal > 0n ? drawsTotal : 0n).toString(),
    events: events.map(eventDto),
    hidden: HIDDEN,
    contracts,
    demo,
  };
}
